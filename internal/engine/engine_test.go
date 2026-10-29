package engine

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/donovan-ratefison/zotra/internal/process"
)

const (
	caseID    = "CASE-2026-0001"
	versionID = "v1"
	docHash   = "sha256-1"
)

// exampleDef reads the example definition of the scenario.
func exampleDef(t *testing.T) process.Definition {
	t.Helper()
	raw, err := os.ReadFile("../../examples/home-loan/process.json")
	if err != nil {
		t.Fatalf("read example definition: %v", err)
	}
	def, err := process.Decode(raw)
	if err != nil {
		t.Fatalf("decode example definition: %v", err)
	}
	return def
}

// commandAt returns a command time of 2026-10-27 UTC.
func commandAt(hour, minute int) time.Time {
	return time.Date(2026, 10, 27, hour, minute, 0, 0, time.UTC)
}

var (
	t0 = commandAt(9, 0)   // Start
	t1 = commandAt(9, 30)  // entry Submit
	t2 = commandAt(10, 0)  // Take
	t3 = commandAt(10, 30) // analysis Submit
	t4 = commandAt(11, 0)  // analysis Decide
	t5 = commandAt(11, 30) // Sign
	t6 = commandAt(12, 0)  // decision Decide
	t7 = commandAt(12, 30) // offer Submit
	t8 = commandAt(13, 0)  // signing Submit
	t9 = commandAt(13, 15) // release Submit
)

func startCmd() Start {
	return Start{CaseID: caseID, VersionID: versionID, Actor: "u-advisor", Data: map[string]any{}}
}

func entryData() map[string]any {
	return map[string]any{
		"client_name":     "Ravina Soa",
		"profession":      "Engineer",
		"amount":          240000.0,
		"duration_months": int64(240),
		"down_payment":    40000.0,
		"annual_rate":     0.035,
		"monthly_income":  4500.0,
		"documents":       []string{"ID card", "Salary slips", "Bank statements", "Property title"},
	}
}

func entryDataWithout(keys ...string) map[string]any {
	data := entryData()
	for _, k := range keys {
		delete(data, k)
	}
	return data
}

func analysisData() map[string]any {
	return map[string]any{"analysis_opinion": "favorable", "analysis_comment": ""}
}

func releaseData() map[string]any {
	return map[string]any{"release_date": commandAt(13, 30)}
}

// step is one command of the approved scenario.
type step struct {
	name string
	cmd  Command
	at   time.Time
}

func scenarioSteps() []step {
	return []step{
		{"start", startCmd(), t0},
		{"entry submit", Submit{Actor: "u-advisor", Values: entryData()}, t1},
		{"take", Take{Actor: "u-analyst"}, t2},
		{"analysis submit", Submit{Actor: "u-analyst", Values: analysisData()}, t3},
		{"analysis decide", Decide{Actor: "u-analyst", Decision: "favorable"}, t4},
		{"sign", Sign{Actor: "u-director", DocumentHash: docHash}, t5},
		{"decision decide", Decide{Actor: "u-director", Decision: "approve"}, t6},
		{"offer submit", Submit{Actor: "u-legal", Values: map[string]any{}}, t7},
		{"signing submit", Submit{Actor: "u-advisor", Values: map[string]any{}}, t8},
		{"release submit", Submit{Actor: "u-backoffice", Values: releaseData()}, t9},
	}
}

// foldEvents folds the events, or gives the empty state for no event.
func foldEvents(t *testing.T, def process.Definition, events []Event) State {
	t.Helper()
	if len(events) == 0 {
		return State{}
	}
	st, err := Fold(def, events)
	if err != nil {
		t.Fatalf("Fold: %v", err)
	}
	return st
}

// runSteps runs the commands in order. Each Handle gets the state
// folded from the events so far.
func runSteps(t *testing.T, def process.Definition, steps []step) []Event {
	t.Helper()
	var all []Event
	for _, s := range steps {
		st := foldEvents(t, def, all)
		evs, err := Handle(def, st, s.cmd, s.at)
		if err != nil {
			t.Fatalf("Handle %s: %v", s.name, err)
		}
		all = append(all, evs...)
	}
	return all
}

func runApproved(t *testing.T, def process.Definition) []Event {
	t.Helper()
	return runSteps(t, def, scenarioSteps())
}

func wantPayload(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	return m
}

// wantEvent is one expected event of the scenario.
type wantEvent struct {
	typ     string
	actor   string
	at      time.Time
	payload map[string]any
}

func checkEvaluatedJSON(node, check string, result bool) map[string]any {
	return map[string]any{"node_id": node, "check_id": check, "result": result, "error": nil}
}

// entryDataJSON is the entry data in JSON shapes, as it comes back
// from an unmarshaled payload.
func entryDataJSON() map[string]any {
	return map[string]any{
		"client_name":     "Ravina Soa",
		"profession":      "Engineer",
		"amount":          240000.0,
		"duration_months": float64(240),
		"down_payment":    40000.0,
		"annual_rate":     0.035,
		"monthly_income":  4500.0,
		"documents":       []any{"ID card", "Salary slips", "Bank statements", "Property title"},
	}
}

// wantScenarioEvents is the 32-event table of the brief.
func wantScenarioEvents() []wantEvent {
	return []wantEvent{
		{EventCaseCreated, "u-advisor", t0, map[string]any{"version_id": "v1", "data": map[string]any{}}},
		{EventEdgeTaken, "system", t0, map[string]any{"edge_id": "e01"}},
		{EventStepEntered, "system", t0, map[string]any{"node_id": "entry"}},
		{EventDataSubmitted, "u-advisor", t1, map[string]any{"node_id": "entry", "values": entryDataJSON()}},
		{EventCheckEvaluated, "u-advisor", t1, checkEvaluatedJSON("entry", "entry-amount", true)},
		{EventEdgeTaken, "system", t1, map[string]any{"edge_id": "e02"}},
		{EventStepEntered, "system", t1, map[string]any{"node_id": "complete"}},
		{EventEdgeTaken, "system", t1, map[string]any{"edge_id": "e03"}},
		{EventStepEntered, "system", t1, map[string]any{"node_id": "analysis"}},
		{EventStepAssigned, "u-analyst", t2, map[string]any{"node_id": "analysis", "user_id": "u-analyst"}},
		{EventDataSubmitted, "u-analyst", t3, map[string]any{"node_id": "analysis", "values": analysisData()}},
		{EventCheckEvaluated, "u-analyst", t4, checkEvaluatedJSON("analysis", "analysis-debt-ratio", true)},
		{EventDecisionMade, "u-analyst", t4, map[string]any{"node_id": "analysis", "decision": "favorable"}},
		{EventEdgeTaken, "system", t4, map[string]any{"edge_id": "e05"}},
		{EventStepEntered, "system", t4, map[string]any{"node_id": "threshold"}},
		{EventEdgeTaken, "system", t4, map[string]any{"edge_id": "e07"}},
		{EventStepEntered, "system", t4, map[string]any{"node_id": "decision"}},
		{EventSignatureAdded, "u-director", t5, map[string]any{
			"node_id": "decision", "user_id": "u-director", "document_hash": "sha256-1"}},
		{EventDecisionMade, "u-director", t6, map[string]any{"node_id": "decision", "decision": "approve"}},
		{EventEdgeTaken, "system", t6, map[string]any{"edge_id": "e09"}},
		{EventStepEntered, "system", t6, map[string]any{"node_id": "offer"}},
		{EventDataSubmitted, "u-legal", t7, map[string]any{"node_id": "offer", "values": map[string]any{}}},
		{EventEdgeTaken, "system", t7, map[string]any{"edge_id": "e12"}},
		{EventStepEntered, "system", t7, map[string]any{"node_id": "signing"}},
		{EventDataSubmitted, "u-advisor", t8, map[string]any{"node_id": "signing", "values": map[string]any{}}},
		{EventEdgeTaken, "system", t8, map[string]any{"edge_id": "e13"}},
		{EventStepEntered, "system", t8, map[string]any{"node_id": "release"}},
		{EventDataSubmitted, "u-backoffice", t9, map[string]any{
			"node_id": "release", "values": map[string]any{"release_date": "2026-10-27T13:30:00Z"}}},
		{EventCheckEvaluated, "u-backoffice", t9, checkEvaluatedJSON("release", "release-date", true)},
		{EventEdgeTaken, "system", t9, map[string]any{"edge_id": "e14"}},
		{EventStepEntered, "system", t9, map[string]any{"node_id": "released"}},
		{EventCaseClosed, "system", t9, map[string]any{"node_id": "released", "result": "approved"}},
	}
}

func TestScenarioApproved(t *testing.T) {
	def := exampleDef(t)

	// The state that the caller passes to Handle is not modified.
	// Command 2 computes monthly_payment, the caller state must not
	// gain it.
	startEvs, err := Handle(def, State{}, startCmd(), t0)
	if err != nil {
		t.Fatalf("Handle start: %v", err)
	}
	stAfterStart := foldEvents(t, def, startEvs)
	if _, err := Handle(def, stAfterStart, scenarioSteps()[1].cmd, t1); err != nil {
		t.Fatalf("Handle entry submit: %v", err)
	}
	if len(stAfterStart.Data) != 0 {
		t.Errorf("caller state data was modified: %v", stAfterStart.Data)
	}

	events := runApproved(t, def)
	want := wantScenarioEvents()
	if len(events) != len(want) {
		t.Fatalf("events = %d, want %d", len(events), len(want))
	}
	for i, w := range want {
		e := events[i]
		if e.CaseID != caseID {
			t.Errorf("event %d case id = %q, want %q", i+1, e.CaseID, caseID)
		}
		if e.Seq != i+1 {
			t.Errorf("event %d: seq = %d", i+1, e.Seq)
		}
		if e.Type != w.typ {
			t.Errorf("event %d type = %q, want %q", i+1, e.Type, w.typ)
		}
		if e.Actor != w.actor {
			t.Errorf("event %d actor = %q, want %q", i+1, e.Actor, w.actor)
		}
		if !e.At.Equal(w.at) {
			t.Errorf("event %d at = %v, want %v", i+1, e.At, w.at)
		}
		if got := wantPayload(t, e.Payload); !reflect.DeepEqual(got, w.payload) {
			t.Errorf("event %d payload\ngot  %v\nwant %v", i+1, got, w.payload)
		}
	}

	// Chain: each event chains on the previous one.
	hashRe := regexp.MustCompile(`^[0-9a-f]{64}$`)
	prev := ZeroHash
	for _, e := range events {
		if e.PrevHash != prev {
			t.Errorf("event %d prev hash = %q, want %q", e.Seq, e.PrevHash, prev)
		}
		if e.Hash != HashEvent(e) {
			t.Errorf("event %d hash is not the hash of the event", e.Seq)
		}
		if !hashRe.MatchString(e.Hash) {
			t.Errorf("event %d hash %q is not 64 hex characters", e.Seq, e.Hash)
		}
		prev = e.Hash
	}

	// Fold of all events.
	st := foldEvents(t, def, events)
	if st.Status != StatusClosed {
		t.Errorf("status = %q, want %q", st.Status, StatusClosed)
	}
	if st.Result != "approved" {
		t.Errorf("result = %q, want approved", st.Result)
	}
	if st.NodeID != "released" {
		t.Errorf("node = %q, want released", st.NodeID)
	}
	if st.Assignee != "" {
		t.Errorf("assignee = %q, want empty", st.Assignee)
	}
	if st.Seq != 32 {
		t.Errorf("seq = %d, want 32", st.Seq)
	}
	if st.PrevHash != events[31].Hash {
		t.Errorf("prev hash = %q, want the hash of event 32", st.PrevHash)
	}
	if len(st.Data) != 13 {
		t.Errorf("data has %d fields, want 13: %v", len(st.Data), st.Data)
	}
	if _, ok := st.Data["credit_decision"]; ok {
		t.Error("credit_decision is set, want unset: Decide emits decision_made only")
	}
	if mp, ok := st.Data["monthly_payment"].(float64); !ok || math.Abs(mp-1391.903) > 0.01 {
		t.Errorf("monthly_payment = %v, want 1391.903 within 0.01", st.Data["monthly_payment"])
	}
	if dr, ok := st.Data["debt_ratio"].(float64); !ok || math.Abs(dr-0.3093) > 0.001 {
		t.Errorf("debt_ratio = %v, want 0.3093 within 0.001", st.Data["debt_ratio"])
	}

	// Replay to N.
	st9 := foldEvents(t, def, events[:9])
	if st9.NodeID != "analysis" || st9.Assignee != "" || st9.Seq != 9 {
		t.Errorf("state at 9: node %q assignee %q seq %d, want analysis, empty, 9",
			st9.NodeID, st9.Assignee, st9.Seq)
	}
	st10 := foldEvents(t, def, events[:10])
	if st10.Assignee != "u-analyst" {
		t.Errorf("state at 10: assignee %q, want u-analyst", st10.Assignee)
	}
}

func TestScenarioLoops(t *testing.T) {
	def := exampleDef(t)

	// Row 1: the return loop, from the state after the Sign.
	events := runSteps(t, def, scenarioSteps()[:6])
	if len(events) != 18 {
		t.Fatalf("events to the Sign = %d, want 18", len(events))
	}
	st := foldEvents(t, def, events)
	evs, err := Handle(def, st, Decide{Actor: "u-director", Decision: "return"}, t6)
	if err != nil {
		t.Fatalf("Handle return: %v", err)
	}
	want := []wantEvent{
		{EventDecisionMade, "u-director", t6, map[string]any{"node_id": "decision", "decision": "return"}},
		{EventEdgeTaken, "system", t6, map[string]any{"edge_id": "e11"}},
		{EventStepEntered, "system", t6, map[string]any{"node_id": "analysis"}},
	}
	if len(evs) != len(want) {
		t.Fatalf("return events = %d, want %d", len(evs), len(want))
	}
	for i, w := range want {
		e := evs[i]
		if e.Type != w.typ || e.Actor != w.actor || !e.At.Equal(w.at) {
			t.Errorf("return event %d = %s by %s at %v, want %s by %s at %v",
				i+1, e.Type, e.Actor, e.At, w.typ, w.actor, w.at)
		}
		if got := wantPayload(t, e.Payload); !reflect.DeepEqual(got, w.payload) {
			t.Errorf("return event %d payload\ngot  %v\nwant %v", i+1, got, w.payload)
		}
	}
	all := append(slices.Clone(events), evs...)
	stLoop := foldEvents(t, def, all)
	if stLoop.NodeID != "analysis" || stLoop.Assignee != "" ||
		stLoop.Status != StatusOpen || stLoop.Seq != 21 {
		t.Errorf("loop state: node %q assignee %q status %q seq %d, want analysis, empty, open, 21",
			stLoop.NodeID, stLoop.Assignee, stLoop.Status, stLoop.Seq)
	}

	// Row 2: the incomplete loop through the default edge.
	incomplete := entryData()
	incomplete["documents"] = []string{"ID card", "Salary slips", "Bank statements"}
	startEvs, err := Handle(def, State{}, startCmd(), t0)
	if err != nil {
		t.Fatalf("Handle start: %v", err)
	}
	stStart := foldEvents(t, def, startEvs)
	evs2, err := Handle(def, stStart, Submit{Actor: "u-advisor", Values: incomplete}, t1)
	if err != nil {
		t.Fatalf("Handle incomplete submit: %v", err)
	}
	wantTypes := []string{
		EventDataSubmitted, EventCheckEvaluated, EventEdgeTaken,
		EventStepEntered, EventEdgeTaken, EventStepEntered,
	}
	if len(evs2) != len(wantTypes) {
		t.Fatalf("incomplete events = %d, want %d", len(evs2), len(wantTypes))
	}
	for i, typ := range wantTypes {
		if evs2[i].Type != typ {
			t.Errorf("incomplete event %d type = %q, want %q", i+1, evs2[i].Type, typ)
		}
	}
	if got := wantPayload(t, evs2[2].Payload); got["edge_id"] != "e02" {
		t.Errorf("incomplete event 3 edge = %v, want e02", got["edge_id"])
	}
	if got := wantPayload(t, evs2[4].Payload); got["edge_id"] != "e04" {
		t.Errorf("incomplete event 5 edge = %v, want e04 (default edge)", got["edge_id"])
	}
	if got := wantPayload(t, evs2[1].Payload); got["result"] != true {
		t.Errorf("incomplete check result = %v, want true", got["result"])
	}
	all2 := append(slices.Clone(startEvs), evs2...)
	stIncomplete := foldEvents(t, def, all2)
	if stIncomplete.NodeID != "entry" {
		t.Errorf("incomplete node = %q, want entry", stIncomplete.NodeID)
	}

	// A second Submit with 4 documents moves to analysis.
	evs3, err := Handle(def, stIncomplete, Submit{Actor: "u-advisor", Values: entryData()}, t1)
	if err != nil {
		t.Fatalf("Handle second submit: %v", err)
	}
	foundE03 := false
	for _, e := range evs3 {
		if e.Type == EventEdgeTaken {
			if got := wantPayload(t, e.Payload); got["edge_id"] == "e03" {
				foundE03 = true
			}
		}
	}
	if !foundE03 {
		t.Error("no edge_taken e03 in the second submit events")
	}
	all2 = append(all2, evs3...)
	stAnalysis := foldEvents(t, def, all2)
	if stAnalysis.NodeID != "analysis" {
		t.Errorf("node after the second submit = %q, want analysis", stAnalysis.NodeID)
	}
}

// caseWithoutIncome starts a case and submits the entry data without
// monthly_income. It returns all events and the state on analysis,
// with no debt_ratio.
func caseWithoutIncome(t *testing.T, def process.Definition) ([]Event, State) {
	t.Helper()
	startEvs, err := Handle(def, State{}, startCmd(), t0)
	if err != nil {
		t.Fatalf("Handle start: %v", err)
	}
	st := foldEvents(t, def, startEvs)
	evs, err := Handle(def, st, Submit{Actor: "u-advisor", Values: entryDataWithout("monthly_income")}, t1)
	if err != nil {
		t.Fatalf("Handle submit: %v", err)
	}
	all := append(slices.Clone(startEvs), evs...)
	return all, foldEvents(t, def, all)
}

func TestScenarioFailedCheck(t *testing.T) {
	def := exampleDef(t)

	// Row 1: the entry check fails on amount 0.
	startEvs, err := Handle(def, State{}, startCmd(), t0)
	if err != nil {
		t.Fatalf("Handle start: %v", err)
	}
	st := foldEvents(t, def, startEvs)
	data := entryData()
	data["amount"] = 0.0
	evs, err := Handle(def, st, Submit{Actor: "u-advisor", Values: data}, t1)
	if err != nil {
		t.Fatalf("Handle submit: %v", err)
	}
	if len(evs) != 2 {
		t.Fatalf("events = %d, want 2 (data_submitted, check_evaluated)", len(evs))
	}
	if evs[0].Type != EventDataSubmitted {
		t.Errorf("event 1 type = %q, want %q", evs[0].Type, EventDataSubmitted)
	}
	if got := wantPayload(t, evs[1].Payload); !reflect.DeepEqual(got, checkEvaluatedJSON("entry", "entry-amount", false)) {
		t.Errorf("check payload\ngot  %v\nwant %v", got, checkEvaluatedJSON("entry", "entry-amount", false))
	}
	all := append(slices.Clone(startEvs), evs...)
	st1 := foldEvents(t, def, all)
	if st1.NodeID != "entry" {
		t.Errorf("node = %q, want entry (no move)", st1.NodeID)
	}
	if amt, ok := st1.Data["amount"].(float64); !ok || amt != 0.0 {
		t.Errorf("amount = %v, want 0.0", st1.Data["amount"])
	}

	// Row 2: the same case moves when the amount is fixed.
	evs2, err := Handle(def, st1, Submit{Actor: "u-advisor", Values: map[string]any{"amount": 240000.0}}, t1)
	if err != nil {
		t.Fatalf("Handle fixed submit: %v", err)
	}
	all = append(all, evs2...)
	st2 := foldEvents(t, def, all)
	if st2.NodeID != "analysis" {
		t.Errorf("node = %q, want analysis", st2.NodeID)
	}

	// Row 3: without monthly_income the debt ratio is removed.
	all3, st3 := caseWithoutIncome(t, def)
	if _, ok := st3.Data["monthly_payment"]; !ok {
		t.Error("monthly_payment missing, want present")
	}
	if _, ok := st3.Data["debt_ratio"]; ok {
		t.Error("debt_ratio present, want removed")
	}
	if st3.NodeID != "analysis" {
		t.Errorf("node = %q, want analysis", st3.NodeID)
	}

	// Row 4: with monthly_income back, the ratio is computed again.
	vals := analysisData()
	vals["monthly_income"] = 4500.0
	evs4, err := Handle(def, st3, Submit{Actor: "u-analyst", Values: vals}, t3)
	if err != nil {
		t.Fatalf("Handle analysis submit: %v", err)
	}
	all3 = append(all3, evs4...)
	st4 := foldEvents(t, def, all3)
	if dr, ok := st4.Data["debt_ratio"].(float64); !ok || math.Abs(dr-0.3093) > 0.001 {
		t.Errorf("debt_ratio = %v, want 0.3093 within 0.001", st4.Data["debt_ratio"])
	}

	// Row 5: the decision on the row 3 case fails on the unset
	// variable.
	all5, st5 := caseWithoutIncome(t, def)
	evs5, err := Handle(def, st5, Decide{Actor: "u-analyst", Decision: "favorable"}, t4)
	if err != nil {
		t.Fatalf("Handle decide: %v", err)
	}
	if len(evs5) != 1 {
		t.Fatalf("events = %d, want 1 (check_evaluated)", len(evs5))
	}
	if evs5[0].Type != EventCheckEvaluated {
		t.Errorf("event type = %q, want %q", evs5[0].Type, EventCheckEvaluated)
	}
	got := wantPayload(t, evs5[0].Payload)
	if got["node_id"] != "analysis" || got["check_id"] != "analysis-debt-ratio" {
		t.Errorf("check = %v on %v, want analysis-debt-ratio on analysis", got["check_id"], got["node_id"])
	}
	if got["result"] != false {
		t.Errorf("result = %v, want false", got["result"])
	}
	errText, ok := got["error"].(string)
	if !ok || !strings.Contains(errText, "debt_ratio") {
		t.Errorf("error = %v, want the eval error text about debt_ratio", got["error"])
	}
	_ = all5
}

// TestPlainFormDate checks the plain form date of the step form: the
// engine reads a plain YYYY-MM-DD string as that day, midnight UTC.
func TestPlainFormDate(t *testing.T) {
	def := exampleDef(t)

	// releaseSteps is the approved scenario with the release submit
	// values replaced by one date string (the step form value).
	releaseSteps := func(date string) []step {
		steps := scenarioSteps()
		steps[len(steps)-1].cmd = Submit{
			Actor:  "u-backoffice",
			Values: map[string]any{"release_date": date},
		}
		return steps
	}

	// Row 1: a future plain date passes and closes approved. The last
	// events are edge_taken e14, step_entered released, case_closed
	// approved.
	events := runSteps(t, def, releaseSteps("2026-10-31"))
	last := events[len(events)-3:]
	for i, typ := range []string{EventEdgeTaken, EventStepEntered, EventCaseClosed} {
		if last[i].Type != typ {
			t.Errorf("row 1 event %d type = %q, want %q", i+1, last[i].Type, typ)
		}
	}
	if got := wantPayload(t, last[0].Payload); got["edge_id"] != "e14" {
		t.Errorf("row 1 edge = %v, want e14", got["edge_id"])
	}
	if got := wantPayload(t, last[2].Payload); got["result"] != "approved" {
		t.Errorf("row 1 result = %v, want approved", got["result"])
	}
	st1 := foldEvents(t, def, events)
	if st1.NodeID != "released" || st1.Result != "approved" {
		t.Errorf("row 1 state node = %q, result = %q, want released, approved", st1.NodeID, st1.Result)
	}

	// Row 2: a past plain date fails the release check with result
	// false and a nil error; the case stays on the release step.
	events2 := runSteps(t, def, releaseSteps("2020-01-31"))
	n := len(events2)
	if events2[n-1].Type != EventCheckEvaluated {
		t.Errorf("row 2 last event type = %q, want %q", events2[n-1].Type, EventCheckEvaluated)
	}
	check := wantPayload(t, events2[n-1].Payload)
	if check["result"] != false {
		t.Errorf("row 2 check result = %v, want false", check["result"])
	}
	if check["error"] != nil {
		t.Errorf("row 2 check error = %v, want nil", check["error"])
	}
	st2 := foldEvents(t, def, events2)
	if st2.NodeID != "release" {
		t.Errorf("row 2 node = %q, want release (no move)", st2.NodeID)
	}

	// Row 3: the RFC 3339 form keeps working.
	events3 := runSteps(t, def, releaseSteps("2026-10-31T00:00:00Z"))
	st3 := foldEvents(t, def, events3)
	if st3.NodeID != "released" || st3.Result != "approved" {
		t.Errorf("row 3 state node = %q, result = %q, want released, approved", st3.NodeID, st3.Result)
	}
}

func TestHandleRefusals(t *testing.T) {
	def := exampleDef(t)
	events := runApproved(t, def)
	stStarted := foldEvents(t, def, events[:3])
	stEntry := foldEvents(t, def, events[:3])
	stAnalysis := foldEvents(t, def, events[:9])
	stAssigned := foldEvents(t, def, events[:10])
	stDecision := foldEvents(t, def, events[:17])
	stClosed := foldEvents(t, def, events)
	crafted := State{Status: StatusOpen, Seq: 9, NodeID: "complete", Data: map[string]any{}}

	tests := []struct {
		name   string
		st     State
		cmd    Command
		want   string
		prefix bool
	}{
		{"start twice", stStarted, startCmd(), "case already started", false},
		{"submit before start", State{}, Submit{Actor: "u-advisor", Values: entryData()}, "case not started", false},
		{"take after close", stClosed, Take{Actor: "u-analyst"}, "case closed", false},
		{"submit after close", stClosed, Submit{Actor: "u-advisor", Values: map[string]any{}}, "case closed", false},
		{"take of an assigned step", stAssigned, Take{Actor: "u-director"}, "step already assigned to u-analyst", false},
		// stAssigned is the state after the first Take of the pair,
		// so this command is the second take.
		{"take twice", stAssigned, Take{Actor: "u-analyst"}, "step already assigned to u-analyst", false},
		{"unknown field", stEntry, Submit{Actor: "u-advisor", Values: map[string]any{"ghost": 1.0}}, "unknown field ghost", false},
		{"computed field", stEntry, Submit{Actor: "u-advisor", Values: map[string]any{"monthly_payment": 1000.0}}, "field monthly_payment is computed", false},
		{"start with unknown field", State{}, Start{CaseID: caseID, VersionID: versionID, Actor: "u-advisor", Data: map[string]any{"ghost": 1.0}}, "unknown field ghost", false},
		{"decide without decisions", stEntry, Decide{Actor: "u-advisor", Decision: "approve"}, "node entry has no decisions", false},
		{"unknown decision", stAnalysis, Decide{Actor: "u-analyst", Decision: "maybe"}, "decision maybe is not a decision of node analysis", false},
		{"sign without signature", stEntry, Sign{Actor: "u-advisor", DocumentHash: docHash}, "node entry has no signature", false},
		{"sign without hash", stDecision, Sign{Actor: "u-director", DocumentHash: ""}, "document hash is required", false},
		{"empty actor", stEntry, Submit{Actor: "", Values: map[string]any{"client_name": "Ravina Soa"}}, "actor is required", false},
		{"submit on a gateway", crafted, Submit{Actor: "u-advisor", Values: map[string]any{}}, "submit is only allowed on a task", false},
		{"take on a gateway", crafted, Take{Actor: "u-analyst"}, "take is only allowed on a task", false},
		{"decide on a gateway", crafted, Decide{Actor: "u-director", Decision: "approve"}, "decide is only allowed on a task", false},
		{"nil command", stEntry, nil, "unknown command", false},
		{"missing documents aborts the gateway", stEntry, Submit{Actor: "u-advisor", Values: entryDataWithout("documents")}, "edge e03: condition:", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			evs, err := Handle(def, tt.st, tt.cmd, t1)
			if err == nil {
				t.Fatalf("Handle: no error, want %q", tt.want)
			}
			if tt.prefix {
				if !strings.HasPrefix(err.Error(), tt.want) {
					t.Errorf("error = %q, want prefix %q", err.Error(), tt.want)
				}
			} else if err.Error() != tt.want {
				t.Errorf("error = %q, want %q", err.Error(), tt.want)
			}
			if len(evs) != 0 {
				t.Errorf("events = %d, want 0", len(evs))
			}
		})
	}
}

func TestVerify(t *testing.T) {
	def := exampleDef(t)
	good := runApproved(t, def)
	tests := []struct {
		name   string
		events func() []Event
		want   int
	}{
		{"intact chain", func() []Event { return good }, 0},
		{"payload of event 5 replaced", func() []Event {
			out := slices.Clone(good)
			out[4].Payload = json.RawMessage(`{"x":1}`)
			return out
		}, 5},
		{"hash of event 7 replaced", func() []Event {
			out := slices.Clone(good)
			out[6].Hash = ZeroHash
			return out
		}, 7},
		{"prev hash of event 9 changed", func() []Event {
			out := slices.Clone(good)
			out[8].PrevHash = "ff"
			return out
		}, 9},
		{"seq of event 3 changed", func() []Event {
			out := slices.Clone(good)
			out[2].Seq = 9
			return out
		}, 3},
		{"empty slice", func() []Event { return nil }, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Verify(tt.events()); got != tt.want {
				t.Errorf("Verify = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestFoldErrors(t *testing.T) {
	def := exampleDef(t)
	good := runApproved(t, def)
	withPayload := func(e Event, payload any) Event {
		t.Helper()
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		e.Payload = raw
		return e
	}
	tests := []struct {
		name   string
		events []Event
		want   string
		prefix bool
	}{
		{"empty", nil, "no events", false},
		{"first event is not case_created", func() []Event {
			out := slices.Clone(good[:9])
			out[0] = good[2]
			return out
		}(), "event 1: first event must be case_created", false},
		{"wrong seq", func() []Event {
			out := slices.Clone(good[:9])
			e := good[9]
			e.Seq = 12
			return append(out, e)
		}(), "event 12: wrong seq", false},
		{"unknown type", func() []Event {
			out := slices.Clone(good[:9])
			e := good[9]
			e.Type = "bogus"
			return append(out, e)
		}(), "event 10: unknown type bogus", false},
		{"unknown node", func() []Event {
			out := slices.Clone(good[:9])
			e := withPayload(good[2], StepEnteredPayload{NodeID: "ghost"})
			e.Seq = 10
			return append(out, e)
		}(), "event 10: node ghost does not exist", false},
		{"case id changed", func() []Event {
			out := slices.Clone(good[:9])
			e := good[9]
			e.CaseID = "CASE-9"
			return append(out, e)
		}(), "event 10: case id changed", false},
		{"bad payload", func() []Event {
			out := slices.Clone(good[:9])
			e := good[9]
			e.Payload = json.RawMessage("{bad")
			return append(out, e)
		}(), "event 10: payload: ", true},
		{"unknown edge", func() []Event {
			out := slices.Clone(good[:9])
			e := withPayload(good[5], EdgeTakenPayload{EdgeID: "e99"})
			e.Seq = 10
			return append(out, e)
		}(), "event 10: edge e99 does not exist", false},
		{"unknown check", func() []Event {
			out := slices.Clone(good[:9])
			e := withPayload(good[4], CheckEvaluatedPayload{NodeID: "entry", CheckID: "c9", Result: true})
			e.Seq = 10
			return append(out, e)
		}(), "event 10: check c9 does not exist", false},
		{"undeclared decision", func() []Event {
			out := slices.Clone(good[:9])
			e := withPayload(good[12], DecisionMadePayload{NodeID: "analysis", Decision: "maybe"})
			e.Seq = 10
			return append(out, e)
		}(), "event 10: decision maybe is not a decision of node analysis", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Fold(def, tt.events)
			if err == nil {
				t.Fatalf("Fold: no error, want %q", tt.want)
			}
			if tt.prefix {
				if !strings.HasPrefix(err.Error(), tt.want) {
					t.Errorf("error = %q, want prefix %q", err.Error(), tt.want)
				}
			} else if err.Error() != tt.want {
				t.Errorf("error = %q, want %q", err.Error(), tt.want)
			}
		})
	}
}
