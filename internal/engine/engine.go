package engine

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"time"

	"cel.dev/cel-go/cel"

	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/rules"
)

// Command is one state change request on a case. Handle validates it
// against the state and returns the new events.
type Command interface{ command() }

// Start opens a case. Data holds the first values, if any.
type Start struct {
	CaseID    string
	VersionID string
	Actor     string
	Data      map[string]any
}

func (Start) command() {}

// Take assigns the current step to the actor.
type Take struct{ Actor string }

func (Take) command() {}

// Submit stores values on the current step.
type Submit struct {
	Actor  string
	Values map[string]any
}

func (Submit) command() {}

// Decide records a decision on the current step.
type Decide struct {
	Actor    string
	Decision string
}

func (Decide) command() {}

// Sign adds a signature to the current step.
type Sign struct {
	Actor        string
	DocumentHash string
}

func (Sign) command() {}

// actorOf returns the actor of a command.
func actorOf(cmd Command) string {
	switch c := cmd.(type) {
	case Start:
		return c.Actor
	case Take:
		return c.Actor
	case Submit:
		return c.Actor
	case Decide:
		return c.Actor
	case Sign:
		return c.Actor
	}
	return ""
}

// SourceFetcher returns the values of one source. The api layer
// owns the case context (a test case serves the simulated values)
// through the closure.
type SourceFetcher func(ctx context.Context, src process.Source) (map[string]any, error)

// SourceFetchError is the error of a fetcher, with the id of the
// source. The caller maps it to its own answer.
type SourceFetchError struct {
	SourceID string
	Err      error
}

func (e *SourceFetchError) Error() string {
	return "source " + e.SourceID + ": " + e.Err.Error()
}

func (e *SourceFetchError) Unwrap() error { return e.Err }

// Handle validates a command against the state and returns the new
// events, with their hashes. It does not write anything and it does
// not modify st, st.Data or st.Sources. It trusts a definition that
// passed rules.ValidateDocument. On error it returns no event. It
// fetches no source.
func Handle(def process.Definition, st State, cmd Command, at time.Time) ([]Event, error) {
	return HandleWithSources(context.Background(), def, st, cmd, at, nil)
}

// HandleWithSources runs Handle with a source fetcher: when the walk
// enters a task node whose source_ids list sources, the engine calls
// the fetcher once per source, in source_ids order, and emits one
// source_fetched event after step_entered (the values as given, the
// actor "system"). A nil fetcher fetches nothing. A fetcher error
// aborts the command: no event of the command is kept, and the error
// is a *SourceFetchError.
func HandleWithSources(ctx context.Context, def process.Definition,
	st State, cmd Command, at time.Time, fetch SourceFetcher,
) ([]Event, error) {
	env, err := newEnv(def)
	if err != nil {
		return nil, err
	}
	// The working state chains the events of this command. Data and
	// Sources are fresh copies, so the caller maps are never modified.
	ws := st
	ws.Data = copyData(st.Data)
	ws.Sources = make(map[string]map[string]any, len(st.Sources))
	for id, values := range st.Sources {
		ws.Sources[id] = values
	}
	var events []Event
	emit := func(actor, typ string, payload any) {
		ev := newEvent(ws, at, actor, typ, payload)
		events = append(events, ev)
		ws.Seq = ev.Seq
		ws.PrevHash = ev.Hash
	}

	// runChecks evaluates the checks of the node in node order, with
	// decision as the decision being made. It stops at the first
	// failed check and reports whether all checks passed.
	runChecks := func(node process.Node, actor, decision string) (bool, error) {
		for _, chk := range node.Checks {
			res, err := evalCheck(env, def, ws, chk, at, decision)
			if err != nil {
				return false, err
			}
			emit(actor, EventCheckEvaluated, CheckEvaluatedPayload{
				NodeID:  node.ID,
				CheckID: chk.ID,
				Result:  res.Passed,
				Error:   res.Error,
			})
			if !res.Passed {
				return false, nil
			}
		}
		return true, nil
	}

	// advance takes one edge: it emits edge_taken and step_entered,
	// fetches the sources of a task node, resets the assignee, and
	// closes the case on an end node. It returns the target node.
	advance := func(edge process.Edge) (process.Node, error) {
		target, err := findNode(def, edge.To)
		if err != nil {
			return process.Node{}, err
		}
		emit("system", EventEdgeTaken, EdgeTakenPayload{EdgeID: edge.ID})
		emit("system", EventStepEntered, StepEnteredPayload{NodeID: target.ID})
		ws.NodeID = target.ID
		ws.Assignee = ""
		if fetch != nil && target.Type == "task" {
			for _, id := range target.SourceIDs {
				src, err := findSource(def, id)
				if err != nil {
					return process.Node{}, err
				}
				values, err := fetch(ctx, src)
				if err != nil {
					return process.Node{}, &SourceFetchError{SourceID: id, Err: err}
				}
				if values == nil {
					values = map[string]any{}
				}
				emit("system", EventSourceFetched, SourceFetchedPayload{
					NodeID: target.ID, SourceID: id, Values: values,
				})
				ws.Sources[id] = values
			}
		}
		if target.Type == "end" {
			result := ""
			if target.EndResult != nil {
				result = *target.EndResult
			}
			emit("system", EventCaseClosed, CaseClosedPayload{NodeID: target.ID, Result: result})
			ws.Status = StatusClosed
			ws.Result = result
		}
		return target, nil
	}

	// firstEdge returns the single outgoing edge of a start or task
	// node (the start node has exactly one outgoing edge, a task
	// without decisions has exactly one).
	firstEdge := func(node process.Node) (process.Edge, error) {
		edges := outgoing(def, node.ID)
		if len(edges) != 1 {
			return process.Edge{}, fmt.Errorf("node %s: want one outgoing edge, have %d", node.ID, len(edges))
		}
		return edges[0], nil
	}

	// decisionEdge returns the outgoing edge that carries the decision.
	decisionEdge := func(node process.Node, decision string) (process.Edge, error) {
		for _, e := range outgoing(def, node.ID) {
			if e.Decision != nil && *e.Decision == decision {
				return e, nil
			}
		}
		return process.Edge{}, fmt.Errorf("node %s: no outgoing edge for decision %s", node.ID, decision)
	}

	// gatewayEdge evaluates the conditions of the outgoing edges in
	// edge order. The first true wins, else the default edge. An
	// evaluation error aborts the command.
	gatewayEdge := func(node process.Node) (process.Edge, error) {
		var deft *process.Edge
		for _, e := range outgoing(def, node.ID) {
			if e.Condition != nil {
				ok, err := evalCondition(env, e, activation(def, ws), at)
				if err != nil {
					return process.Edge{}, fmt.Errorf("edge %s: condition: %w", e.ID, err)
				}
				if ok {
					return e, nil
				}
				continue
			}
			if e.IsDefault {
				edge := e
				deft = &edge
			}
		}
		if deft == nil {
			return process.Edge{}, fmt.Errorf("node %s: no condition matched and no default edge", node.ID)
		}
		return *deft, nil
	}

	// walk is the move loop. It recurses through start and gateway
	// nodes and stops on a task or an end node. The first edge of a
	// completing command is taken by the command case before the walk.
	var walk func(node process.Node) error
	walk = func(node process.Node) error {
		switch node.Type {
		case "start":
			edge, err := firstEdge(node)
			if err != nil {
				return err
			}
			target, err := advance(edge)
			if err != nil {
				return err
			}
			return walk(target)
		case "gateway":
			edge, err := gatewayEdge(node)
			if err != nil {
				return err
			}
			target, err := advance(edge)
			if err != nil {
				return err
			}
			return walk(target)
		case "task", "end":
			return nil
		default:
			return fmt.Errorf("unknown node type %s", node.Type)
		}
	}

	if cmd == nil {
		return nil, errors.New("unknown command")
	}
	_, isStart := cmd.(Start)
	if isStart {
		if st.Seq > 0 {
			return nil, errors.New("case already started")
		}
	} else {
		if st.Seq == 0 {
			return nil, errors.New("case not started")
		}
		if st.Status == StatusClosed {
			return nil, errors.New("case closed")
		}
	}
	if actorOf(cmd) == "" {
		return nil, errors.New("actor is required")
	}

	switch c := cmd.(type) {
	case Start:
		if err := checkFieldKeys(def, c.Data); err != nil {
			return nil, err
		}
		start, err := startNode(def)
		if err != nil {
			return nil, err
		}
		ws.CaseID = c.CaseID
		ws.Status = StatusOpen
		ws.Data = map[string]any{}
		mergeValues(def, ws.Data, c.Data)
		emit(c.Actor, EventCaseCreated, CaseCreatedPayload{
			VersionID: c.VersionID,
			Data:      copyData(c.Data),
		})
		if err := recomputeFields(def, env, &ws, at); err != nil {
			return nil, err
		}
		if err := walk(start); err != nil {
			return nil, err
		}
		return events, nil

	case Take:
		node, err := findNode(def, st.NodeID)
		if err != nil {
			return nil, err
		}
		if node.Type != "task" {
			return nil, errors.New("take is only allowed on a task")
		}
		if ws.Assignee != "" {
			return nil, fmt.Errorf("step already assigned to %s", ws.Assignee)
		}
		emit(c.Actor, EventStepAssigned, StepAssignedPayload{NodeID: node.ID, UserID: c.Actor})
		ws.Assignee = c.Actor
		return events, nil

	case Submit:
		node, err := findNode(def, st.NodeID)
		if err != nil {
			return nil, err
		}
		if node.Type != "task" {
			return nil, errors.New("submit is only allowed on a task")
		}
		if err := checkFieldKeys(def, c.Values); err != nil {
			return nil, err
		}
		emit(c.Actor, EventDataSubmitted, DataSubmittedPayload{NodeID: node.ID, Values: c.Values})
		mergeValues(def, ws.Data, c.Values)
		if err := recomputeFields(def, env, &ws, at); err != nil {
			return nil, err
		}
		if len(node.Decisions) > 0 {
			return events, nil
		}
		passed, err := runChecks(node, c.Actor, "")
		if err != nil {
			return nil, err
		}
		if !passed {
			return events, nil
		}
		edge, err := firstEdge(node)
		if err != nil {
			return nil, err
		}
		target, err := advance(edge)
		if err != nil {
			return nil, err
		}
		if err := walk(target); err != nil {
			return nil, err
		}
		return events, nil

	case Decide:
		node, err := findNode(def, st.NodeID)
		if err != nil {
			return nil, err
		}
		if node.Type != "task" {
			return nil, errors.New("decide is only allowed on a task")
		}
		if len(node.Decisions) == 0 {
			return nil, fmt.Errorf("node %s has no decisions", node.ID)
		}
		if !slices.Contains(node.Decisions, c.Decision) {
			return nil, fmt.Errorf("decision %s is not a decision of node %s", c.Decision, node.ID)
		}
		passed, err := runChecks(node, c.Actor, c.Decision)
		if err != nil {
			return nil, err
		}
		if !passed {
			return events, nil
		}
		emit(c.Actor, EventDecisionMade, DecisionMadePayload{NodeID: node.ID, Decision: c.Decision})
		edge, err := decisionEdge(node, c.Decision)
		if err != nil {
			return nil, err
		}
		target, err := advance(edge)
		if err != nil {
			return nil, err
		}
		if err := walk(target); err != nil {
			return nil, err
		}
		return events, nil

	case Sign:
		node, err := findNode(def, st.NodeID)
		if err != nil {
			return nil, err
		}
		if !node.Signature {
			return nil, fmt.Errorf("node %s has no signature", node.ID)
		}
		if c.DocumentHash == "" {
			return nil, errors.New("document hash is required")
		}
		emit(c.Actor, EventSignatureAdded, SignatureAddedPayload{
			NodeID:       node.ID,
			UserID:       c.Actor,
			DocumentHash: c.DocumentHash,
		})
		return events, nil

	default:
		return nil, errors.New("unknown command")
	}
}

// CheckResult is the preview of one check of a node.
type CheckResult struct {
	ID         string  `json:"id"`
	Message    string  `json:"message"`
	Expression string  `json:"expression"`
	Passed     bool    `json:"passed"`
	Error      *string `json:"error"`
}

// ErrNotATask is the error of PreviewChecks when the case is not open
// on a task node.
var ErrNotATask = errors.New("not_a_task")

// evalCheck evaluates one check on the state. A compile error is
// returned. An eval error gives Passed false and the error text.
func evalCheck(env *rules.Env, def process.Definition, st State,
	chk process.Check, at time.Time, decision string,
) (CheckResult, error) {
	res := CheckResult{ID: chk.ID, Message: chk.Message, Expression: chk.Expression}
	prg, err := env.Compile(chk.Expression, cel.BoolType)
	if err != nil {
		return CheckResult{}, err
	}
	passed, err := prg.EvalBool(activation(def, st), at, decision)
	if err != nil {
		text := err.Error()
		res.Error = &text
		return res, nil
	}
	res.Passed = passed
	return res, nil
}

// PreviewChecks evaluates every check of the current task node on the
// state, in node order, with decision "". It does not stop at the
// first failure and it writes no event. A non-computed field with no
// value gets the empty value of its type. It does not modify st.
func PreviewChecks(def process.Definition, st State, at time.Time) ([]CheckResult, error) {
	if st.Status != StatusOpen {
		return nil, ErrNotATask
	}
	node, err := findNode(def, st.NodeID)
	if err != nil || node.Type != "task" {
		return nil, ErrNotATask
	}
	env, err := newEnv(def)
	if err != nil {
		return nil, err
	}
	ws := st
	ws.Data = copyData(st.Data)
	for _, f := range def.Fields {
		if _, ok := ws.Data[f.Name]; !ok && f.Computed == nil {
			ws.Data[f.Name] = emptyValue(f.Type)
		}
	}
	results := make([]CheckResult, 0, len(node.Checks))
	for _, chk := range node.Checks {
		res, err := evalCheck(env, def, ws, chk, at, "")
		if err != nil {
			return nil, err
		}
		results = append(results, res)
	}
	return results, nil
}

// emptyValue returns the empty value of a field type, in the Go shape
// of coerceValue.
func emptyValue(typ string) any {
	switch typ {
	case "number", "money":
		return 0.0
	case "integer":
		return int64(0)
	case "boolean":
		return false
	case "date":
		return time.Time{}
	case "document":
		return []string{}
	}
	return ""
}

// newEnv returns the CEL environment of the definition.
func newEnv(def process.Definition) (*rules.Env, error) {
	return rules.NewEnv(def.Fields, def.Sources)
}

// findSource returns the source with this id.
func findSource(def process.Definition, id string) (process.Source, error) {
	for _, src := range def.Sources {
		if src.ID == id {
			return src, nil
		}
	}
	return process.Source{}, fmt.Errorf("source %s does not exist", id)
}

// activation returns the CEL values of the state: a copy of the data,
// plus one entry per source of the definition, with the last fetched
// values, or an empty map before the first fetch.
func activation(def process.Definition, st State) map[string]any {
	vars := copyData(st.Data)
	for _, src := range def.Sources {
		values, ok := st.Sources[src.ID]
		if !ok {
			values = map[string]any{}
		}
		vars[src.ID] = values
	}
	return vars
}

// findNode returns the node with this id.
func findNode(def process.Definition, id string) (process.Node, error) {
	for _, n := range def.Nodes {
		if n.ID == id {
			return n, nil
		}
	}
	return process.Node{}, fmt.Errorf("node %s does not exist", id)
}

// startNode returns the start node of the definition.
func startNode(def process.Definition) (process.Node, error) {
	for _, n := range def.Nodes {
		if n.Type == "start" {
			return n, nil
		}
	}
	return process.Node{}, errors.New("no start node")
}

// outgoing returns the edges out of the node, in definition order.
func outgoing(def process.Definition, nodeID string) []process.Edge {
	var edges []process.Edge
	for _, e := range def.Edges {
		if e.From == nodeID {
			edges = append(edges, e)
		}
	}
	return edges
}

// evalCondition compiles and evaluates one edge condition. The values
// are the case data, now is at, decision is "".
func evalCondition(env *rules.Env, edge process.Edge, data map[string]any, at time.Time) (bool, error) {
	prg, err := env.Compile(*edge.Condition, cel.BoolType)
	if err != nil {
		return false, err
	}
	return prg.EvalBool(data, at, "")
}

// recomputeFields walks the computed fields in dependency order and
// evaluates each expression. The values are the activation of the
// state (the case data and the sources), now is at, decision is "". A
// success stores the value in st.Data. A failure removes the field
// from st.Data and the walk continues. No event, no error, unless the
// definition has a cycle (impossible after rules.ValidateDocument).
func recomputeFields(def process.Definition, env *rules.Env, st *State, at time.Time) error {
	names, err := rules.ComputedOrder(def)
	if err != nil {
		return err
	}
	data := st.Data
	vars := activation(def, *st)
	fields := fieldByName(def)
	for _, name := range names {
		f := fields[name]
		t, err := rules.FieldType(f)
		if err != nil {
			return err
		}
		prg, err := env.Compile(*f.Computed, t)
		if err != nil {
			return err
		}
		value, err := prg.Eval(vars, at, "")
		if err != nil {
			delete(data, name)
			delete(vars, name)
			continue
		}
		data[name] = value
		vars[name] = value
	}
	return nil
}

// fieldByName indexes the fields of the definition by name.
func fieldByName(def process.Definition) map[string]process.Field {
	fields := make(map[string]process.Field, len(def.Fields))
	for _, f := range def.Fields {
		fields[f.Name] = f
	}
	return fields
}

// checkFieldKeys refuses a key that names no field of the definition
// and a key that names a computed field. Keys are checked in sorted
// order, so the errors are deterministic.
func checkFieldKeys(def process.Definition, values map[string]any) error {
	known := map[string]bool{}
	computed := map[string]bool{}
	for _, f := range def.Fields {
		known[f.Name] = true
		if f.Computed != nil {
			computed[f.Name] = true
		}
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !known[k] {
			return fmt.Errorf("unknown field %s", k)
		}
		if computed[k] {
			return fmt.Errorf("field %s is computed", k)
		}
	}
	return nil
}

// copyData returns a shallow copy of the data, never nil.
func copyData(data map[string]any) map[string]any {
	out := make(map[string]any, len(data))
	for k, v := range data {
		out[k] = v
	}
	return out
}

// mergeValues copies the values into the data, with the Go shape of
// each field. The shape of a value decides the overload of an
// expression at eval time, and a replay reads the values from JSON,
// where every number is a float64. The coercion keeps the replay on
// the same shapes as the original run.
func mergeValues(def process.Definition, data map[string]any, values map[string]any) {
	fields := fieldByName(def)
	for k, v := range values {
		if f, ok := fields[k]; ok {
			data[k] = coerceValue(f, v)
		} else {
			data[k] = v
		}
	}
}

// coerceValue converts one value to the Go shape of its field:
// int64 for integer, float64 for money and
// number, string for string and enum, bool for boolean, time.Time for
// date (an RFC 3339 string is parsed, a plain YYYY-MM-DD string is
// read as that day, midnight UTC), []string for document. A value
// of another shape passes through unchanged.
func coerceValue(f process.Field, v any) any {
	switch f.Type {
	case "integer":
		switch n := v.(type) {
		case int64:
			return n
		case int:
			return int64(n)
		case float64:
			return int64(n)
		}
	case "money", "number":
		switch n := v.(type) {
		case float64:
			return n
		case int64:
			return float64(n)
		case int:
			return float64(n)
		}
	case "string", "enum":
		if s, ok := v.(string); ok {
			return s
		}
	case "boolean":
		if b, ok := v.(bool); ok {
			return b
		}
	case "date":
		switch t := v.(type) {
		case time.Time:
			return t
		case string:
			if parsed, err := time.Parse(time.RFC3339, t); err == nil {
				return parsed
			}
			if parsed, err := time.Parse("2006-01-02", t); err == nil {
				return parsed
			}
		}
	case "document":
		switch l := v.(type) {
		case []string:
			return l
		case []any:
			out := make([]string, 0, len(l))
			for _, item := range l {
				if s, ok := item.(string); ok {
					out = append(out, s)
				}
			}
			return out
		}
	}
	return v
}
