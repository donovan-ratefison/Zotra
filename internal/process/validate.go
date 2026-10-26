package process

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// Error is one validation error. Path is a JSON Pointer (RFC 6901)
// to the offending value. Path is "" for the whole document.
type Error struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

//go:embed schema.json
var schemaJSON []byte

var compiledSchema = sync.OnceValue(func() *jsonschema.Schema {
	var raw any
	if err := json.Unmarshal(schemaJSON, &raw); err != nil {
		panic(fmt.Sprintf("process: embedded schema: %v", err))
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("schema.json", raw); err != nil {
		panic(fmt.Sprintf("process: embedded schema: %v", err))
	}
	sch, err := compiler.Compile("schema.json")
	if err != nil {
		panic(fmt.Sprintf("process: embedded schema: %v", err))
	}
	return sch
})

// pointer builds the JSON Pointer (RFC 6901) of one instance location.
func pointer(location []string) string {
	var b strings.Builder
	for _, segment := range location {
		b.WriteString("/")
		b.WriteString(strings.ReplaceAll(strings.ReplaceAll(segment, "~", "~0"), "/", "~1"))
	}
	return b.String()
}

// schemaErrors flattens the validation error tree into one Error per
// leaf cause.
func schemaErrors(err error) []Error {
	var out []Error
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) == 0 {
			keyword := "schema"
			if keywords := e.ErrorKind.KeywordPath(); len(keywords) > 0 {
				keyword = keywords[len(keywords)-1]
			}
			out = append(out, Error{
				Path:    pointer(e.InstanceLocation),
				Message: fmt.Sprintf("%s: %s", keyword, e.Error()),
			})
			return
		}
		for _, cause := range e.Causes {
			walk(cause)
		}
	}
	if validationErr, ok := err.(*jsonschema.ValidationError); ok {
		walk(validationErr)
		return out
	}
	return []Error{{Path: "", Message: err.Error()}}
}

// Validate checks one process document: JSON syntax, the JSON Schema,
// and the semantic rules. It returns all errors that it finds, schema
// errors first, then semantic errors in document order. A valid
// document gives an empty slice. It never fails: an internal failure
// is a bug.
func Validate(data []byte) []Error {
	errors := []Error{}

	var doc any
	if err := json.Unmarshal(data, &doc); err != nil {
		return append(errors, Error{Path: "", Message: fmt.Sprintf("invalid JSON: %v", err)})
	}

	if err := compiledSchema().Validate(doc); err != nil {
		return append(errors, schemaErrors(err)...)
	}

	var def Definition
	if err := json.Unmarshal(data, &def); err != nil {
		panic(fmt.Sprintf("process: schema passed but decode failed: %v", err))
	}
	normalize(&def)

	errors = append(errors, checkStartEnd(&def)...)
	errors = append(errors, checkTasks(&def)...)
	errors = append(errors, checkGateways(&def)...)
	errors = append(errors, checkReachability(&def)...)
	errors = append(errors, checkIdentifiers(&def)...)
	return errors
}

// Decode parses a document that Validate accepted. It returns an
// error only for a document that Validate refuses.
func Decode(data []byte) (Definition, error) {
	var def Definition
	if err := json.Unmarshal(data, &def); err != nil {
		return Definition{}, fmt.Errorf("decode process: %w", err)
	}
	normalize(&def)
	return def, nil
}

// nodePath returns the JSON Pointer of one node of the array.
func nodePath(def *Definition, i int) string {
	return fmt.Sprintf("/nodes/%d", i)
}

// checkStartEnd is semantic rule 1: exactly one start, at least one
// end, each end has a non-null end_result.
func checkStartEnd(def *Definition) []Error {
	var errors []Error
	var starts, ends []int
	for i, node := range def.Nodes {
		switch node.Type {
		case "start":
			starts = append(starts, i)
		case "end":
			ends = append(ends, i)
		}
	}
	if len(starts) == 0 {
		errors = append(errors, Error{Path: "/nodes", Message: "exactly one start node is required, found 0"})
	}
	if len(starts) > 1 {
		for _, i := range starts[1:] {
			errors = append(errors, Error{
				Path:    nodePath(def, i),
				Message: fmt.Sprintf("exactly one start node is required, found %d", len(starts)),
			})
		}
	}
	if len(ends) == 0 {
		errors = append(errors, Error{Path: "/nodes", Message: "at least one end node is required, found 0"})
	}
	for _, i := range ends {
		if def.Nodes[i].EndResult == nil {
			errors = append(errors, Error{
				Path:    nodePath(def, i) + "/end_result",
				Message: "end node must have a non-null end_result",
			})
		}
	}
	return errors
}

// checkTasks is semantic rule 2: each task has a role, and its
// decisions have exactly one outgoing edge each.
func checkTasks(def *Definition) []Error {
	var errors []Error
	for i, node := range def.Nodes {
		if node.Type != "task" {
			continue
		}
		if node.Role == nil {
			errors = append(errors, Error{
				Path:    nodePath(def, i) + "/role",
				Message: "task must have a role",
			})
		}
		var outgoing []Edge
		for _, edge := range def.Edges {
			if edge.From == node.ID {
				outgoing = append(outgoing, edge)
			}
		}
		if len(node.Decisions) == 0 {
			if len(outgoing) != 1 {
				errors = append(errors, Error{
					Path:    nodePath(def, i),
					Message: fmt.Sprintf("task without decisions must have exactly one outgoing edge, found %d", len(outgoing)),
				})
			}
			continue
		}
		for _, decision := range node.Decisions {
			count := 0
			for _, edge := range outgoing {
				if edge.Decision != nil && *edge.Decision == decision {
					count++
				}
			}
			if count != 1 {
				errors = append(errors, Error{
					Path:    nodePath(def, i),
					Message: fmt.Sprintf("decision %s must have exactly one outgoing edge, found %d", decision, count),
				})
			}
		}
	}
	return errors
}

// checkGateways is semantic rule 3: each gateway has exactly one
// outgoing edge with is_default true.
func checkGateways(def *Definition) []Error {
	var errors []Error
	for i, node := range def.Nodes {
		if node.Type != "gateway" {
			continue
		}
		count := 0
		for _, edge := range def.Edges {
			if edge.From == node.ID && edge.IsDefault {
				count++
			}
		}
		if count != 1 {
			errors = append(errors, Error{
				Path:    nodePath(def, i),
				Message: fmt.Sprintf("gateway must have exactly one default edge, found %d", count),
			})
		}
	}
	return errors
}

// checkReachability is semantic rule 4: all nodes are reachable from
// start, and each node reaches an end. The traversal uses only edges
// whose endpoints exist.
func checkReachability(def *Definition) []Error {
	var errors []Error
	nodeIndex := make(map[string]bool, len(def.Nodes))
	for _, node := range def.Nodes {
		nodeIndex[node.ID] = true
	}
	forward := make(map[string][]string)
	backward := make(map[string][]string)
	for _, edge := range def.Edges {
		if !nodeIndex[edge.From] || !nodeIndex[edge.To] {
			continue
		}
		forward[edge.From] = append(forward[edge.From], edge.To)
		backward[edge.To] = append(backward[edge.To], edge.From)
	}

	var startID string
	for _, node := range def.Nodes {
		if node.Type == "start" {
			startID = node.ID
			break
		}
	}
	if startID != "" {
		reached := reachable(def, forward, startID)
		for i, node := range def.Nodes {
			if !reached[node.ID] {
				errors = append(errors, Error{
					Path:    nodePath(def, i),
					Message: "node is not reachable from start",
				})
			}
		}
	}

	var endIDs []string
	for _, node := range def.Nodes {
		if node.Type == "end" {
			endIDs = append(endIDs, node.ID)
		}
	}
	reachesEnd := reachable(def, backward, endIDs...)
	for i, node := range def.Nodes {
		if !reachesEnd[node.ID] {
			errors = append(errors, Error{
				Path:    nodePath(def, i),
				Message: "node does not reach an end",
			})
		}
	}
	return errors
}

// reachable walks the graph from the roots over the given adjacency
// and returns the ids that it visits.
func reachable(def *Definition, adjacency map[string][]string, roots ...string) map[string]bool {
	visited := make(map[string]bool)
	queue := make([]string, 0, len(def.Nodes))
	for _, root := range roots {
		if root != "" && !visited[root] {
			visited[root] = true
			queue = append(queue, root)
		}
	}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, next := range adjacency[id] {
			if !visited[next] {
				visited[next] = true
				queue = append(queue, next)
			}
		}
	}
	return visited
}

// checkIdentifiers is semantic rule 5: unique ids and names, and
// references that resolve.
func checkIdentifiers(def *Definition) []Error {
	var errors []Error

	seen := make(map[string]bool)
	for i, node := range def.Nodes {
		if seen[node.ID] {
			errors = append(errors, Error{
				Path:    fmt.Sprintf("/nodes/%d/id", i),
				Message: fmt.Sprintf("duplicate node id %s", node.ID),
			})
		}
		seen[node.ID] = true
	}

	seen = make(map[string]bool)
	for i, edge := range def.Edges {
		if seen[edge.ID] {
			errors = append(errors, Error{
				Path:    fmt.Sprintf("/edges/%d/id", i),
				Message: fmt.Sprintf("duplicate edge id %s", edge.ID),
			})
		}
		seen[edge.ID] = true
	}

	seen = make(map[string]bool)
	for i, role := range def.Roles {
		if seen[role.ID] {
			errors = append(errors, Error{
				Path:    fmt.Sprintf("/roles/%d/id", i),
				Message: fmt.Sprintf("duplicate role id %s", role.ID),
			})
		}
		seen[role.ID] = true
	}

	seen = make(map[string]bool)
	for i, field := range def.Fields {
		if seen[field.Name] {
			errors = append(errors, Error{
				Path:    fmt.Sprintf("/fields/%d/name", i),
				Message: fmt.Sprintf("duplicate field name %s", field.Name),
			})
		}
		seen[field.Name] = true
	}

	for i, edge := range def.Edges {
		if !seenNode(def, edge.From) {
			errors = append(errors, Error{
				Path:    fmt.Sprintf("/edges/%d/from", i),
				Message: fmt.Sprintf("edge references unknown node %s", edge.From),
			})
		}
		if !seenNode(def, edge.To) {
			errors = append(errors, Error{
				Path:    fmt.Sprintf("/edges/%d/to", i),
				Message: fmt.Sprintf("edge references unknown node %s", edge.To),
			})
		}
	}

	roleIDs := make(map[string]bool)
	for _, role := range def.Roles {
		roleIDs[role.ID] = true
	}
	for i, node := range def.Nodes {
		if node.Role != nil && !roleIDs[*node.Role] {
			errors = append(errors, Error{
				Path:    nodePath(def, i) + "/role",
				Message: fmt.Sprintf("node references unknown role %s", *node.Role),
			})
		}
	}
	return errors
}

// seenNode reports whether the definition has a node with this id.
func seenNode(def *Definition, id string) bool {
	for _, node := range def.Nodes {
		if node.ID == id {
			return true
		}
	}
	return false
}
