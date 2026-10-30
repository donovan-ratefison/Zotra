package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/donovan-ratefison/zotra/internal/process"
)

// Status values of a case.
const (
	StatusOpen   = "open"
	StatusClosed = "closed"
)

// State is the state of one case, after the events that Fold
// replayed.
type State struct {
	CaseID    string                    `json:"case_id"`
	VersionID string                    `json:"version_id"`
	Status    string                    `json:"status"`
	Result    string                    `json:"result"`
	NodeID    string                    `json:"node_id"`
	Data      map[string]any            `json:"data"`
	Sources   map[string]map[string]any `json:"sources"`
	Assignee  string                    `json:"assignee"`
	Seq       int                       `json:"seq"`
	PrevHash  string                    `json:"prev_hash"`
}

// Fold rebuilds the state from events. Replay to N =
// Fold(def, events[:n]). It checks the order and the shape of the
// events, not their hashes: Verify does that. It trusts a definition
// that passed rules.ValidateDocument.
func Fold(def process.Definition, events []Event) (State, error) {
	if len(events) == 0 {
		return State{}, errors.New("no events")
	}
	nodeByID := map[string]process.Node{}
	for _, n := range def.Nodes {
		nodeByID[n.ID] = n
	}
	edgeByID := map[string]process.Edge{}
	for _, e := range def.Edges {
		edgeByID[e.ID] = e
	}
	checkIDs := map[string]bool{}
	for _, n := range def.Nodes {
		for _, c := range n.Checks {
			checkIDs[c.ID] = true
		}
	}
	env, err := newEnv(def)
	if err != nil {
		return State{}, err
	}
	sourceIDs := map[string]bool{}
	for _, src := range def.Sources {
		sourceIDs[src.ID] = true
	}
	ws := State{Data: map[string]any{}, Sources: map[string]map[string]any{}}
	for i, e := range events {
		if i == 0 && e.Type != EventCaseCreated {
			return State{}, errors.New("event 1: first event must be case_created")
		}
		if e.Seq != i+1 {
			return State{}, fmt.Errorf("event %d: wrong seq", e.Seq)
		}
		if e.CaseID != events[0].CaseID {
			return State{}, fmt.Errorf("event %d: case id changed", e.Seq)
		}
		switch e.Type {
		case EventCaseCreated:
			var p CaseCreatedPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			ws.CaseID = e.CaseID
			ws.VersionID = p.VersionID
			ws.Data = map[string]any{}
			mergeValues(def, ws.Data, p.Data)
			ws.Status = StatusOpen
			if err := recomputeFields(def, env, &ws, e.At); err != nil {
				return State{}, err
			}
		case EventStepEntered:
			var p StepEnteredPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			if _, ok := nodeByID[p.NodeID]; !ok {
				return State{}, fmt.Errorf("event %d: node %s does not exist", e.Seq, p.NodeID)
			}
			ws.NodeID = p.NodeID
			ws.Assignee = ""
		case EventEdgeTaken:
			var p EdgeTakenPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			if _, ok := edgeByID[p.EdgeID]; !ok {
				return State{}, fmt.Errorf("event %d: edge %s does not exist", e.Seq, p.EdgeID)
			}
		case EventStepAssigned:
			var p StepAssignedPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			if _, ok := nodeByID[p.NodeID]; !ok {
				return State{}, fmt.Errorf("event %d: node %s does not exist", e.Seq, p.NodeID)
			}
			ws.Assignee = p.UserID
		case EventDataSubmitted:
			var p DataSubmittedPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			if _, ok := nodeByID[p.NodeID]; !ok {
				return State{}, fmt.Errorf("event %d: node %s does not exist", e.Seq, p.NodeID)
			}
			mergeValues(def, ws.Data, p.Values)
			if err := recomputeFields(def, env, &ws, e.At); err != nil {
				return State{}, err
			}
		case EventCheckEvaluated:
			var p CheckEvaluatedPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			if _, ok := nodeByID[p.NodeID]; !ok {
				return State{}, fmt.Errorf("event %d: node %s does not exist", e.Seq, p.NodeID)
			}
			if !checkIDs[p.CheckID] {
				return State{}, fmt.Errorf("event %d: check %s does not exist", e.Seq, p.CheckID)
			}
		case EventDecisionMade:
			var p DecisionMadePayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			node, ok := nodeByID[p.NodeID]
			if !ok {
				return State{}, fmt.Errorf("event %d: node %s does not exist", e.Seq, p.NodeID)
			}
			if !slices.Contains(node.Decisions, p.Decision) {
				return State{}, fmt.Errorf("event %d: decision %s is not a decision of node %s",
					e.Seq, p.Decision, p.NodeID)
			}
		case EventSignatureAdded:
			var p SignatureAddedPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			if _, ok := nodeByID[p.NodeID]; !ok {
				return State{}, fmt.Errorf("event %d: node %s does not exist", e.Seq, p.NodeID)
			}
		case EventCaseClosed:
			var p CaseClosedPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			if _, ok := nodeByID[p.NodeID]; !ok {
				return State{}, fmt.Errorf("event %d: node %s does not exist", e.Seq, p.NodeID)
			}
			ws.Status = StatusClosed
			ws.Result = p.Result
			ws.NodeID = p.NodeID
		case EventSourceFetched:
			var p SourceFetchedPayload
			if err := json.Unmarshal(e.Payload, &p); err != nil {
				return State{}, fmt.Errorf("event %d: payload: %w", e.Seq, err)
			}
			if _, ok := nodeByID[p.NodeID]; !ok {
				return State{}, fmt.Errorf("event %d: node %s does not exist", e.Seq, p.NodeID)
			}
			if !sourceIDs[p.SourceID] {
				return State{}, fmt.Errorf("event %d: source %s does not exist", e.Seq, p.SourceID)
			}
			ws.Sources[p.SourceID] = p.Values
		default:
			return State{}, fmt.Errorf("event %d: unknown type %s", e.Seq, e.Type)
		}
	}
	ws.Seq = events[len(events)-1].Seq
	ws.PrevHash = events[len(events)-1].Hash
	return ws, nil
}
