package api

// The tests of the flow route. Each test opens a fresh store and
// seeds hand-built events with fixed at values (the supervision
// tests shape). The route reads the events, it does not verify the
// hash chain.

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// flowStep is one hand-built event: a type, an actor and a payload.
// The type "e" is an edge_taken event and the type "n" is a
// step_entered event, with the id in the payload.
type flowStep struct{ typ, actor, arg string }

// edge and enter build the two short steps.
func edge(id string) flowStep  { return flowStep{"e", "", id} }
func enter(id string) flowStep { return flowStep{"n", "", id} }

// flowAppend appends the steps to a case, from seq first, all at at.
func flowAppend(t *testing.T, st *store.Store, caseID string, first int,
	at time.Time, steps ...flowStep) {
	t.Helper()
	events := make([]engine.Event, len(steps))
	for i, s := range steps {
		typ, payload, actor := s.typ, s.arg, s.actor
		switch s.typ {
		case "e":
			typ, payload = engine.EventEdgeTaken, `{"edge_id":"`+s.arg+`"}`
		case "n":
			typ, payload = engine.EventStepEntered, `{"node_id":"`+s.arg+`"}`
		}
		if actor == "" {
			actor = "system"
		}
		events[i] = engine.Event{CaseID: caseID, Seq: first + i, Type: typ,
			At: at, Actor: actor, Payload: json.RawMessage(payload),
			PrevHash: "p", Hash: "h"}
	}
	if err := st.AppendEvents(context.Background(), caseID, events); err != nil {
		t.Fatalf("append events of %s: %v", caseID, err)
	}
}

func created(data string) flowStep {
	return flowStep{engine.EventCaseCreated, "",
		`{"version_id":"` + seedVersionID + `","data":` + data + `}`}
}

func assigned(node, user string) flowStep {
	return flowStep{engine.EventStepAssigned, user,
		`{"node_id":"` + node + `","user_id":"` + user + `"}`}
}

func submitted(node, user string) flowStep {
	return flowStep{engine.EventDataSubmitted, user,
		`{"node_id":"` + node + `","values":{}}`}
}

// seedCaseR seeds the released case: lead time 30 h.
func seedCaseR(t *testing.T, st *store.Store, now time.Time) {
	t.Helper()
	c := createCase(t, seedVersionID, false)
	flowAppend(t, st, c, 1, now.Add(-100*time.Hour),
		created(`{"amount":80000}`), edge("e01"), enter("entry"))
	flowAppend(t, st, c, 4, now.Add(-70*time.Hour),
		assigned("entry", "u-advisor"), submitted("entry", "u-advisor"),
		edge("e02"), enter("complete"), edge("e03"), enter("analysis"),
		flowStep{engine.EventDecisionMade, "u-analyst",
			`{"node_id":"analysis","decision":"favorable"}`},
		edge("e05"), enter("threshold"), edge("e08"), enter("offer"),
		edge("e12"), enter("signing"), edge("e13"), enter("release"),
		edge("e14"), enter("released"),
		flowStep{engine.EventCaseClosed, "",
			`{"node_id":"released","result":"approved"}`})
}

// seedCaseF seeds the refused case: lead time 20 h.
func seedCaseF(t *testing.T, st *store.Store, now time.Time) {
	t.Helper()
	c := createCase(t, seedVersionID, false)
	events := supClosedEvents(c, seedVersionID, now.Add(-60*time.Hour))
	events[0].At = now.Add(-80 * time.Hour)
	if err := st.AppendEvents(context.Background(), c, events); err != nil {
		t.Fatalf("append case F: %v", err)
	}
}

// seedCaseX seeds the open case with one return (e04). With full
// false, it stops after seq 7, on entry.
func seedCaseX(t *testing.T, st *store.Store, now time.Time, full bool) string {
	t.Helper()
	c := createCase(t, seedVersionID, false)
	flowAppend(t, st, c, 1, now.Add(-60*time.Hour),
		created(`{}`), edge("e01"), enter("entry"), edge("e02"), enter("complete"))
	flowAppend(t, st, c, 6, now.Add(-50*time.Hour), edge("e04"), enter("entry"))
	if full {
		flowAppend(t, st, c, 8, now,
			assigned("entry", "u-advisor"), submitted("entry", "u-advisor"),
			edge("e02"), enter("complete"), edge("e03"), enter("analysis"))
	}
	return c
}

// getFlow reads the flow route with the query and decodes a 200.
func getFlow(t *testing.T, query string) flowAnswer {
	t.Helper()
	rec := do(t, "GET", "/api/versions/"+seedVersionID+"/flow"+query, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var body flowAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal answer: %v: %s", err, rec.Body.String())
	}
	return body
}

// checkFlow compares the answer with the expected values. passes
// holds the edges with a non-zero count; all other edges must be 0.
func checkFlow(t *testing.T, got flowAnswer, days, closed int, ends []flowEnd,
	passes map[string]int, returns int, today flowToday) {
	t.Helper()
	if got.Days != days || got.Closed != closed || got.Returns != returns ||
		got.Today != today {
		t.Errorf("days %d closed %d returns %d today %+v, want %d %d %d %+v",
			got.Days, got.Closed, got.Returns, got.Today,
			days, closed, returns, today)
	}
	if len(got.Ends) != len(ends) {
		t.Fatalf("ends = %+v, want %+v", got.Ends, ends)
	}
	for i := range ends {
		if got.Ends[i] != ends[i] {
			t.Errorf("ends[%d] = %+v, want %+v", i, got.Ends[i], ends[i])
		}
	}
	if len(got.Edges) != 14 {
		t.Fatalf("edges = %d rows, want 14", len(got.Edges))
	}
	for _, e := range got.Edges {
		if e.Passes != passes[e.EdgeID] {
			t.Errorf("edge %s passes = %d, want %d", e.EdgeID, e.Passes,
				passes[e.EdgeID])
		}
	}
	if got.Edges[0].EdgeID != "e01" || got.Edges[13].EdgeID != "e14" {
		t.Errorf("edge order: first %s, last %s, want e01, e14",
			got.Edges[0].EdgeID, got.Edges[13].EdgeID)
	}
}

func flowNow() time.Time { return time.Now().UTC().Truncate(time.Second) }

// 1.
func TestFlowReleasedCase(t *testing.T) {
	st := newSupTestAPI(t)
	seedCaseR(t, st, flowNow())
	checkFlow(t, getFlow(t, ""), 30, 1,
		[]flowEnd{{"released", 1, 30}, {"refused", 0, 0}},
		map[string]int{"e01": 1, "e02": 1, "e03": 1, "e05": 1, "e08": 1,
			"e12": 1, "e13": 1, "e14": 1},
		0, flowToday{})
}

// 2.
func TestFlowRefusedCase(t *testing.T) {
	st := newSupTestAPI(t)
	seedCaseF(t, st, flowNow())
	checkFlow(t, getFlow(t, ""), 30, 1,
		[]flowEnd{{"released", 0, 0}, {"refused", 1, 20}},
		map[string]int{"e01": 1, "e02": 1, "e03": 1, "e06": 1},
		0, flowToday{})
}

// 3: the loop counts one return, not two.
func TestFlowReturnCase(t *testing.T) {
	st := newSupTestAPI(t)
	seedCaseX(t, st, flowNow(), true)
	checkFlow(t, getFlow(t, ""), 30, 0,
		[]flowEnd{{"released", 0, 0}, {"refused", 0, 0}},
		map[string]int{"e01": 1, "e02": 2, "e03": 1, "e04": 1},
		1, flowToday{People: 2, Rules: 1})
}

// 4a, 4b, 4c.
func TestFlowPeriod(t *testing.T) {
	st := newSupTestAPI(t)
	now := flowNow()
	seedCaseR(t, st, now)
	seedCaseF(t, st, now)
	seedCaseX(t, st, now, true)

	all := map[string]int{"e01": 3, "e02": 4, "e03": 3, "e04": 1, "e05": 1,
		"e06": 1, "e08": 1, "e12": 1, "e13": 1, "e14": 1}
	ends := []flowEnd{{"released", 1, 30}, {"refused", 1, 20}}
	today := flowToday{People: 2, Rules: 1}
	checkFlow(t, getFlow(t, "?days=30"), 30, 2, ends, all, 1, today)
	checkFlow(t, getFlow(t, "?days="), 30, 2, ends, all, 1, today)
	checkFlow(t, getFlow(t, "?days=1"), 1, 0,
		[]flowEnd{{"released", 0, 0}, {"refused", 0, 0}},
		map[string]int{"e02": 1, "e03": 1}, 0, today)
}

// 5.
func TestFlowEmptyPeriod(t *testing.T) {
	newSupTestAPI(t)
	createCase(t, seedVersionID, false)
	checkFlow(t, getFlow(t, "?days=90"), 90, 0,
		[]flowEnd{{"released", 0, 0}, {"refused", 0, 0}},
		map[string]int{}, 0, flowToday{})
}

// The back edges of the seed definition.
func TestFlowBackEdges(t *testing.T) {
	st := newSupTestAPI(t)
	v, err := st.GetVersion(context.Background(), seedVersionID)
	if err != nil {
		t.Fatalf("get version: %v", err)
	}
	def, err := process.Decode(v.Definition)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := backEdges(def)
	if len(got) != 2 || !got["e04"] || !got["e11"] {
		t.Errorf("back edges = %v, want e04 and e11", got)
	}
}

// 6.
func TestFlowInvalidDays(t *testing.T) {
	newSupTestAPI(t)
	for _, q := range []string{"0", "91", "abc", "1.5"} {
		rec := do(t, "GET", "/api/versions/"+seedVersionID+"/flow?days="+q, "", "")
		checkError(t, rec, http.StatusBadRequest, "invalid_query",
			"days must hold 1 to 90")
	}
}

// 7a, 7b.
func TestFlowUnknownVersion(t *testing.T) {
	newSupTestAPI(t)
	for _, path := range []string{"/api/versions/ghost/flow",
		"/api/versions/ghost/flow?days=0"} {
		rec := do(t, "GET", path, "", "")
		checkError(t, rec, http.StatusNotFound, "not_found", "no version ghost")
	}
}

// T3: a closed test case stays out of the closed count and the passes.
func TestFlowSkipsTestCase(t *testing.T) {
	st := newSupTestAPI(t)
	now := flowNow()
	seedCaseR(t, st, now)
	test := createCase(t, seedVersionID, true)
	if err := st.AppendEvents(context.Background(), test,
		supClosedEvents(test, seedVersionID, now.Add(-time.Hour))); err != nil {
		t.Fatalf("append test case: %v", err)
	}
	checkFlow(t, getFlow(t, "?days=30"), 30, 1,
		[]flowEnd{{"released", 1, 30}, {"refused", 0, 0}},
		map[string]int{"e01": 1, "e02": 1, "e03": 1, "e05": 1, "e08": 1,
			"e12": 1, "e13": 1, "e14": 1},
		0, flowToday{})
}
