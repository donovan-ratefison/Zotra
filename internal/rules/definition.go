package rules

import (
	"fmt"
	"strings"

	"cel.dev/cel-go/cel"

	"github.com/donovan-ratefison/zotra/internal/process"
)

// CheckDefinition applies rule 5 and rule 8 of local/plan.md section
// 2 to a definition that process.Validate accepted. Rule 5: each
// computed expression compiles to the CEL type of its field, each
// check expression and each non-null edge condition compiles to bool.
// Rule 8: no computed field uses itself, directly or through other
// computed fields. It returns all errors, never nil: first the
// computed fields (field order), then the checks (node order, then
// check order), then the edge conditions (edge order), then the
// cycles (field order). A valid definition gives an empty slice.
func CheckDefinition(def process.Definition) []process.Error {
	errors := []process.Error{}
	e, err := NewEnv(def.Fields)
	if err != nil {
		return append(errors, process.Error{Path: "/fields", Message: err.Error()})
	}
	for i, field := range def.Fields {
		if field.Computed == nil {
			continue
		}
		t, typeErr := FieldType(field)
		if typeErr != nil {
			errors = append(errors, process.Error{
				Path:    fmt.Sprintf("/fields/%d/computed", i),
				Message: typeErr.Error(),
			})
			continue
		}
		if _, compileErr := e.Compile(*field.Computed, t); compileErr != nil {
			errors = append(errors, process.Error{
				Path:    fmt.Sprintf("/fields/%d/computed", i),
				Message: compileErr.Error(),
			})
		}
	}
	for i, node := range def.Nodes {
		for j, check := range node.Checks {
			if _, checkErr := e.Compile(check.Expression, cel.BoolType); checkErr != nil {
				errors = append(errors, process.Error{
					Path:    fmt.Sprintf("/nodes/%d/checks/%d/expression", i, j),
					Message: checkErr.Error(),
				})
			}
		}
	}
	for k, edge := range def.Edges {
		if edge.Condition == nil {
			continue
		}
		if _, condErr := e.Compile(*edge.Condition, cel.BoolType); condErr != nil {
			errors = append(errors, process.Error{
				Path:    fmt.Sprintf("/edges/%d/condition", k),
				Message: condErr.Error(),
			})
		}
	}
	nodes, _ := computedGraph(e, def)
	onCycle := findCycles(nodes)
	for i, field := range def.Fields {
		if onCycle[field.Name] {
			errors = append(errors, process.Error{
				Path:    fmt.Sprintf("/fields/%d/computed", i),
				Message: fmt.Sprintf("computed field %s is in a cycle", field.Name),
			})
		}
	}
	return errors
}

// ComputedOrder returns the names of the computed fields in
// evaluation order: each field comes after the computed fields that
// its expression uses. Fields that do not depend on each other keep
// the field order of the definition. It returns an error if an
// expression does not compile or if there is a cycle. A definition
// with no computed field gives an empty slice, not nil.
func ComputedOrder(def process.Definition) ([]string, error) {
	e, err := NewEnv(def.Fields)
	if err != nil {
		return nil, err
	}
	nodes, compileErrs := computedGraph(e, def)
	if len(compileErrs) > 0 {
		return nil, compileErrs[0]
	}
	onCycle := findCycles(nodes)
	if len(onCycle) > 0 {
		return nil, fmt.Errorf("cycle in computed fields: %s", strings.Join(cycleNames(def, onCycle), ", "))
	}
	order := make([]string, 0, len(nodes))
	emitted := map[string]bool{}
	done := 0
	for done < len(nodes) {
		progressed := false
		for _, node := range nodes {
			if emitted[node.name] || !allEmitted(node, emitted) {
				continue
			}
			emitted[node.name] = true
			order = append(order, node.name)
			done++
			progressed = true
			break
		}
		if !progressed {
			// Cannot happen after findCycles. Kept for safety: the
			// not-emitted nodes are the fields on a cycle.
			var stuck []string
			for _, node := range nodes {
				if !emitted[node.name] {
					stuck = append(stuck, node.name)
				}
			}
			return nil, fmt.Errorf("cycle in computed fields: %s", strings.Join(stuck, ", "))
		}
	}
	return order, nil
}

// ValidateDocument is the validation entry point of local/plan.md
// section 2. It runs process.Validate. If that gives errors, it
// returns them. Else it decodes the document and returns
// CheckDefinition. It never returns nil.
func ValidateDocument(data []byte) []process.Error {
	errors := process.Validate(data)
	if len(errors) > 0 {
		return errors
	}
	def, err := process.Decode(data)
	if err != nil {
		return append(errors, process.Error{Path: "", Message: err.Error()})
	}
	return append(errors, CheckDefinition(def)...)
}

// computedField is one node of the dependency graph of the computed
// fields: the field name, and the names of the computed fields that
// its expression uses.
type computedField struct {
	name string
	deps []string
}

// usedNames compiles the expression and returns the names that it
// uses: the non-empty reference names of the checked AST, once each.
// A compile error has the same shape as the error of Env.Compile.
func usedNames(e *Env, expression string) ([]string, error) {
	ast, issues := e.env.Compile(expression)
	if issues != nil && issues.Err() != nil {
		return nil, fmt.Errorf("compile %q: %w", expression, issues.Err())
	}
	var names []string
	seen := map[string]bool{}
	for _, ref := range ast.NativeRep().ReferenceMap() {
		if ref.Name == "" || seen[ref.Name] {
			continue
		}
		seen[ref.Name] = true
		names = append(names, ref.Name)
	}
	return names, nil
}

// computedGraph returns the dependency graph of the computed fields,
// in field order, and one error per expression that does not compile,
// in field order. A field whose expression does not compile is not a
// node of the graph: rule 5 reports it, and no field can depend on
// its value. The deps of a node are the used names that are names of
// the nodes of the graph, so now, decision and plain fields are not
// deps.
func computedGraph(e *Env, def process.Definition) ([]computedField, []error) {
	type rawNode struct {
		name  string
		names []string
	}
	var raws []rawNode
	var errs []error
	for _, field := range def.Fields {
		if field.Computed == nil {
			continue
		}
		names, err := usedNames(e, *field.Computed)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		raws = append(raws, rawNode{name: field.Name, names: names})
	}
	nodeOf := map[string]bool{}
	for _, raw := range raws {
		nodeOf[raw.name] = true
	}
	nodes := make([]computedField, 0, len(raws))
	for _, raw := range raws {
		deps := []string{}
		for _, name := range raw.names {
			if nodeOf[name] {
				deps = append(deps, name)
			}
		}
		nodes = append(nodes, computedField{name: raw.name, deps: deps})
	}
	return nodes, errs
}

// findCycles walks the graph depth first, in field order, and returns
// the names of the fields that are on a cycle. A name is not visited,
// in progress, or done. A back edge to a name in progress marks that
// name and every name of the path after it.
func findCycles(nodes []computedField) map[string]bool {
	const (
		unvisited = iota
		inProgress
		done
	)
	depsOf := map[string][]string{}
	state := map[string]int{}
	for _, node := range nodes {
		depsOf[node.name] = node.deps
		state[node.name] = unvisited
	}
	onCycle := map[string]bool{}
	var path []string
	var visit func(name string)
	visit = func(name string) {
		state[name] = inProgress
		path = append(path, name)
		for _, dep := range depsOf[name] {
			switch state[dep] {
			case unvisited:
				visit(dep)
			case inProgress:
				for i := len(path) - 1; i >= 0; i-- {
					onCycle[path[i]] = true
					if path[i] == dep {
						break
					}
				}
			}
		}
		path = path[:len(path)-1]
		state[name] = done
	}
	for _, node := range nodes {
		if state[node.name] == unvisited {
			visit(node.name)
		}
	}
	return onCycle
}

// cycleNames lists the names on a cycle, in field order of the
// definition.
func cycleNames(def process.Definition, onCycle map[string]bool) []string {
	var names []string
	for _, field := range def.Fields {
		if onCycle[field.Name] {
			names = append(names, field.Name)
		}
	}
	return names
}

// allEmitted says whether every dep of the node is emitted.
func allEmitted(node computedField, emitted map[string]bool) bool {
	for _, dep := range node.deps {
		if !emitted[dep] {
			return false
		}
	}
	return true
}
