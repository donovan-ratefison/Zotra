package coverage

import (
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
)

// t0 is the time of the first command of a case.
var t0 = time.Date(2026, 10, 27, 9, 0, 0, 0, time.UTC)

// commandAt returns the time of command i: t0 plus i minutes. The
// times have no part under a second.
func commandAt(i int) time.Time {
	return t0.Add(time.Duration(i) * time.Minute)
}

// exampleDef reads the example definition.
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

// runCase runs the commands in order through Handle and Fold, as the
// engine tests do. Command i runs at commandAt(i).
func runCase(t *testing.T, def process.Definition, cmds []engine.Command) []engine.Event {
	t.Helper()
	var all []engine.Event
	for i, cmd := range cmds {
		var st engine.State
		if len(all) > 0 {
			var err error
			st, err = engine.Fold(def, all)
			if err != nil {
				t.Fatalf("Fold: %v", err)
			}
		}
		evs, err := engine.Handle(def, st, cmd, commandAt(i))
		if err != nil {
			t.Fatalf("Handle command %d: %v", i, err)
		}
		all = append(all, evs...)
	}
	return all
}

// The fixture values are copies from internal/engine/engine_test.go.

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

// entryData3Docs is the 3-document variant: the complete gateway
// takes the default edge back to entry.
func entryData3Docs() map[string]any {
	data := entryData()
	data["documents"] = []string{"ID card", "Salary slips", "Bank statements"}
	return data
}

func analysisData() map[string]any {
	return map[string]any{"analysis_opinion": "favorable", "analysis_comment": ""}
}

func releaseData() map[string]any {
	return map[string]any{"release_date": time.Date(2026, 10, 27, 13, 30, 0, 0, time.UTC)}
}

// approvedRun is the 10-command approved run of the engine scenario.
func approvedRun(caseID string) []engine.Command {
	return []engine.Command{
		engine.Start{CaseID: caseID, VersionID: "v1", Actor: "u-advisor", Data: map[string]any{}},
		engine.Submit{Actor: "u-advisor", Values: entryData()},
		engine.Take{Actor: "u-analyst"},
		engine.Submit{Actor: "u-analyst", Values: analysisData()},
		engine.Decide{Actor: "u-analyst", Decision: "favorable"},
		engine.Sign{Actor: "u-director", DocumentHash: "sha256-1"},
		engine.Decide{Actor: "u-director", Decision: "approve"},
		engine.Submit{Actor: "u-legal", Values: map[string]any{}},
		engine.Submit{Actor: "u-advisor", Values: map[string]any{}},
		engine.Submit{Actor: "u-backoffice", Values: releaseData()},
	}
}

// wantFullEdges is the report of row 1: the full approved run of one
// case. The ids are in definition order.
func wantFullEdges() []EdgeCount {
	return []EdgeCount{
		{"e01", 1}, {"e02", 1}, {"e03", 1}, {"e04", 0}, {"e05", 1},
		{"e06", 0}, {"e07", 1}, {"e08", 0}, {"e09", 1}, {"e10", 0},
		{"e11", 0}, {"e12", 1}, {"e13", 1}, {"e14", 1},
	}
}

// wantFullRed is the Red list of the report of row 1.
func wantFullRed() []string {
	return []string{"e04", "e06", "e08", "e10", "e11"}
}

// countOf returns the count of one edge of the report.
func countOf(t *testing.T, rep Report, edgeID string) int {
	t.Helper()
	for _, e := range rep.Edges {
		if e.EdgeID == edgeID {
			return e.Count
		}
	}
	t.Fatalf("edge %s is not in the report", edgeID)
	return 0
}

func TestFullRun(t *testing.T) {
	def := exampleDef(t)
	events := runCase(t, def, approvedRun("case-1"))
	rep := OfCases(def, map[string][]engine.Event{"case-1": events})
	if len(rep.Edges) != 14 {
		t.Fatalf("edges = %d, want 14", len(rep.Edges))
	}
	// DeepEqual checks the ids, the definition order and the
	// counts in one walk.
	if !reflect.DeepEqual(rep.Edges, wantFullEdges()) {
		t.Errorf("edges\ngot  %v\nwant %v", rep.Edges, wantFullEdges())
	}
	if got := rep.Taken(); got != 9 {
		t.Errorf("Taken = %d, want 9", got)
	}
	if red := rep.Red(); !reflect.DeepEqual(red, wantFullRed()) {
		t.Errorf("Red = %v, want %v", red, wantFullRed())
	}
}

func TestIncompleteLoop(t *testing.T) {
	def := exampleDef(t)
	cmds := []engine.Command{
		engine.Start{CaseID: "case-1", VersionID: "v1", Actor: "u-advisor", Data: map[string]any{}},
		engine.Submit{Actor: "u-advisor", Values: entryData3Docs()},
		engine.Submit{Actor: "u-advisor", Values: entryData()},
		engine.Take{Actor: "u-analyst"},
		engine.Decide{Actor: "u-analyst", Decision: "favorable"},
	}
	rep := OfCases(def, map[string][]engine.Event{"case-1": runCase(t, def, cmds)})
	if got := countOf(t, rep, "e03"); got != 1 {
		t.Errorf("e03 = %d, want 1", got)
	}
	if got := countOf(t, rep, "e04"); got != 1 {
		t.Errorf("e04 = %d, want 1", got)
	}
	red := rep.Red()
	if slices.Contains(red, "e03") {
		t.Error("Red holds e03, want not")
	}
	if slices.Contains(red, "e04") {
		t.Error("Red holds e04, want not")
	}
}

func TestUnfavorable(t *testing.T) {
	def := exampleDef(t)
	cmds := []engine.Command{
		engine.Start{CaseID: "case-1", VersionID: "v1", Actor: "u-advisor", Data: map[string]any{}},
		engine.Submit{Actor: "u-advisor", Values: entryData()},
		engine.Take{Actor: "u-analyst"},
		engine.Decide{Actor: "u-analyst", Decision: "unfavorable"},
	}
	rep := OfCases(def, map[string][]engine.Event{"case-1": runCase(t, def, cmds)})
	if got := rep.Taken(); got != 4 {
		t.Errorf("Taken = %d, want 4", got)
	}
	if got := countOf(t, rep, "e06"); got != 1 {
		t.Errorf("e06 = %d, want 1", got)
	}
	wantRed := []string{"e04", "e05", "e07", "e08", "e09", "e10", "e11", "e12", "e13", "e14"}
	if red := rep.Red(); !reflect.DeepEqual(red, wantRed) {
		t.Errorf("Red = %v, want %v", red, wantRed)
	}
}

func TestReturnLoop(t *testing.T) {
	def := exampleDef(t)
	// The first 6 commands bring the case to decision, signature
	// done. The return brings it back to analysis, the
	// unfavorable decide closes it.
	cmds := slices.Concat(approvedRun("case-1")[:6],
		[]engine.Command{
			engine.Decide{Actor: "u-director", Decision: "return"},
			engine.Decide{Actor: "u-analyst", Decision: "unfavorable"},
		})
	rep := OfCases(def, map[string][]engine.Event{"case-1": runCase(t, def, cmds)})
	if got := countOf(t, rep, "e11"); got != 1 {
		t.Errorf("e11 = %d, want 1", got)
	}
}

func TestCountPerCase(t *testing.T) {
	def := exampleDef(t)
	cmds := []engine.Command{
		engine.Start{CaseID: "case-1", VersionID: "v1", Actor: "u-advisor", Data: map[string]any{}},
		engine.Submit{Actor: "u-advisor", Values: entryData3Docs()},
		engine.Submit{Actor: "u-advisor", Values: entryData3Docs()},
		engine.Submit{Actor: "u-advisor", Values: entryData()},
	}
	rep := OfCases(def, map[string][]engine.Event{"case-1": runCase(t, def, cmds)})
	if got := countOf(t, rep, "e04"); got != 1 {
		t.Errorf("e04 = %d, want 1 (once per case, not per take)", got)
	}
}

func TestTwoCases(t *testing.T) {
	def := exampleDef(t)
	rep := OfCases(def, map[string][]engine.Event{
		"case-1": runCase(t, def, approvedRun("case-1")),
		"case-2": runCase(t, def, approvedRun("case-2")),
	})
	if got := countOf(t, rep, "e01"); got != 2 {
		t.Errorf("e01 = %d, want 2", got)
	}
	if got := rep.Taken(); got != 9 {
		t.Errorf("Taken = %d, want 9", got)
	}
	if red := rep.Red(); !reflect.DeepEqual(red, wantFullRed()) {
		t.Errorf("Red = %v, want %v", red, wantFullRed())
	}
}

func TestEmpty(t *testing.T) {
	def := exampleDef(t)
	rep := OfCases(def, map[string][]engine.Event{})
	if rep.Edges == nil {
		t.Fatal("Edges is nil, want one count per edge")
	}
	if len(rep.Edges) != 14 {
		t.Fatalf("edges = %d, want 14", len(rep.Edges))
	}
	for _, e := range rep.Edges {
		if e.Count != 0 {
			t.Errorf("%s = %d, want 0", e.EdgeID, e.Count)
		}
	}
	if got := rep.Taken(); got != 0 {
		t.Errorf("Taken = %d, want 0", got)
	}
	wantRed := []string{
		"e01", "e02", "e03", "e04", "e05", "e06", "e07",
		"e08", "e09", "e10", "e11", "e12", "e13", "e14",
	}
	if red := rep.Red(); !reflect.DeepEqual(red, wantRed) {
		t.Errorf("Red = %v, want %v", red, wantRed)
	}
}

func TestUnknownEdgeIgnored(t *testing.T) {
	def := exampleDef(t)
	events := runCase(t, def, approvedRun("case-1"))
	// Row 1 gives 32 events, so the crafted event carries Seq 33
	// and the time one minute after the last command (9:09).
	crafted := engine.Event{
		CaseID:   "case-1",
		Seq:      33,
		Type:     engine.EventEdgeTaken,
		At:       commandAt(10),
		Actor:    "system",
		Payload:  json.RawMessage(`{"edge_id":"e99"}`),
		PrevHash: engine.ZeroHash,
		Hash:     engine.ZeroHash,
	}
	rep := OfCases(def, map[string][]engine.Event{
		"case-1": append(slices.Clone(events), crafted),
	})
	// The report of row 1 is unchanged, so e99 appears nowhere
	// and no count moves.
	if !reflect.DeepEqual(rep.Edges, wantFullEdges()) {
		t.Errorf("edges\ngot  %v\nwant %v", rep.Edges, wantFullEdges())
	}
}
