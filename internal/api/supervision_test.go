package api

// The tests of the supervision route. Each test opens a fresh store,
// seeds its cases through AppendEvents with fixed at values, and
// reads the route. The route folds, it does not verify: the hash
// bytes of the hand-built events stay arbitrary.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"testing/fstest"
	"time"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// supAnswer is the decoded body of the supervision route.
type supAnswer struct {
	VersionID  string      `json:"version_id"`
	TotalOpen  int         `json:"total_open"`
	TotalLate  int         `json:"total_late"`
	Nodes      []supNode   `json:"nodes"`
	People     []supPerson `json:"people"`
	Cases      []supCase   `json:"cases"`
}

// decodeSupervision unmarshals one answer of the supervision route.
func decodeSupervision(t *testing.T, rec *httptest.ResponseRecorder) supAnswer {
	t.Helper()
	var body supAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal answer: %v: %s", err, rec.Body.String())
	}
	return body
}

// newSupTestAPI opens the test store, keeps it for the direct
// AppendEvents calls, and installs the handler (the newTestAPI shape).
func newSupTestAPI(t *testing.T) *store.Store {
	t.Helper()
	st := openTestStore(t)
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<p>index</p>")}}
	testAPIHandler = NewHandler(static, "v-test", st, "")
	return st
}

// supEvents builds the start chain of a supervision case: case_created,
// edge_taken e01, step_entered entry, all at the given time.
func supEvents(caseID, versionID string, at time.Time) []engine.Event {
	return []engine.Event{
		{CaseID: caseID, Seq: 1, Type: "case_created", At: at, Actor: "system",
			Payload: json.RawMessage(
				`{"version_id":"` + versionID + `","data":{}}`),
			PrevHash: "p1", Hash: "h1"},
		{CaseID: caseID, Seq: 2, Type: "edge_taken", At: at, Actor: "system",
			Payload: json.RawMessage(`{"edge_id":"e01"}`),
			PrevHash: "h1", Hash: "h2"},
		{CaseID: caseID, Seq: 3, Type: "step_entered", At: at, Actor: "system",
			Payload: json.RawMessage(`{"node_id":"entry"}`),
			PrevHash: "h2", Hash: "h3"},
	}
}

// supChain appends the start chain of one case.
func supChain(t *testing.T, st *store.Store, caseID, versionID string, at time.Time) {
	t.Helper()
	if err := st.AppendEvents(context.Background(), caseID,
		supEvents(caseID, versionID, at)); err != nil {
		t.Fatalf("append chain: %v", err)
	}
}

// supClosedEvents builds the 12-event walk of a closed case: start,
// entry, complete, analysis, the unfavorable decision, refused, closed.
func supClosedEvents(caseID, versionID string, at time.Time) []engine.Event {
	types := []string{
		"case_created", "edge_taken", "step_entered", "data_submitted",
		"edge_taken", "step_entered", "edge_taken", "step_entered",
		"decision_made", "edge_taken", "step_entered", "case_closed",
	}
	payloads := []string{
		`{"version_id":"` + versionID + `","data":{"amount":240000}}`,
		`{"edge_id":"e01"}`, `{"node_id":"entry"}`,
		`{"node_id":"entry","values":{}}`,
		`{"edge_id":"e02"}`, `{"node_id":"complete"}`,
		`{"edge_id":"e03"}`, `{"node_id":"analysis"}`,
		`{"node_id":"analysis","decision":"unfavorable"}`,
		`{"edge_id":"e06"}`, `{"node_id":"refused"}`,
		`{"node_id":"refused","result":"refused"}`,
	}
	events := make([]engine.Event, len(types))
	for i, typ := range types {
		events[i] = engine.Event{
			CaseID: caseID, Seq: i + 1, Type: typ, At: at, Actor: "system",
			Payload:  json.RawMessage(payloads[i]),
			PrevHash: "p", Hash: "h",
		}
	}
	return events
}

// seedTwoLateCases seeds the S1 pair: two cases on the seeded version,
// aged 25 h 30 m and 26 h 30 m, both past the 24 h deadline of entry.
func seedTwoLateCases(t *testing.T, st *store.Store) (string, string) {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Second)
	a := createCase(t, seedVersionID, true)
	supChain(t, st, a, seedVersionID, now.Add(-25*time.Hour-30*time.Minute))
	b := createCase(t, seedVersionID, true)
	supChain(t, st, b, seedVersionID, now.Add(-26*time.Hour-30*time.Minute))
	return a, b
}

// checkEntryNode asserts the entry row of the nodes array: the first
// non-start node of the seeded definition, with the given counts.
func checkEntryNode(t *testing.T, body supAnswer, open, late, median int) {
	t.Helper()
	if len(body.Nodes) != 10 {
		t.Fatalf("nodes = %d, want 10", len(body.Nodes))
	}
	entry := body.Nodes[0]
	if entry.NodeID != "entry" {
		t.Errorf("first node = %q, want entry", entry.NodeID)
	}
	if entry.Open != open || entry.Late != late || entry.MedianHours != median {
		t.Errorf("entry = %+v, want open %d, late %d, median %d",
			entry, open, late, median)
	}
}

// 1 and 2.
func TestSupervisionStepCounts(t *testing.T) {
	st := newSupTestAPI(t)
	seedTwoLateCases(t, st)

	rec := do(t, "GET", "/api/versions/"+seedVersionID+"/supervision", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeSupervision(t, rec)

	// Row 1: the entry counts, the lower median, the definition order.
	checkEntryNode(t, body, 2, 2, 25)
	if body.TotalOpen != 2 || body.TotalLate != 2 {
		t.Errorf("totals = %d/%d, want 2/2", body.TotalOpen, body.TotalLate)
	}
	if len(body.People) != 0 {
		t.Errorf("people = %v, want none (no assignee)", body.People)
	}

	// Row 2: both cases in the cases array, ages floored.
	if len(body.Cases) != 2 {
		t.Fatalf("cases = %d, want 2", len(body.Cases))
	}
	ages := map[int]bool{}
	for _, c := range body.Cases {
		if c.NodeID != "entry" || !c.Late {
			t.Errorf("case %s: node %q late %v, want entry late true",
				c.CaseID, c.NodeID, c.Late)
		}
		if c.Data == nil {
			t.Errorf("case %s: data is null, want an object", c.CaseID)
		}
		ages[c.AgeHours] = true
	}
	if !ages[25] || !ages[26] {
		t.Errorf("age_hours values %v, want 25 and 26", ages)
	}
}

// 3.
func TestSupervisionSkipsClosedCase(t *testing.T) {
	st := newSupTestAPI(t)
	seedTwoLateCases(t, st)
	now := time.Now().UTC().Truncate(time.Second)
	closed := createCase(t, seedVersionID, true)
	if err := st.AppendEvents(context.Background(), closed,
		supClosedEvents(closed, seedVersionID, now.Add(-27*time.Hour))); err != nil {
		t.Fatalf("append closed walk: %v", err)
	}

	rec := do(t, "GET", "/api/versions/"+seedVersionID+"/supervision", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeSupervision(t, rec)

	// The closed case counts nowhere: the answer equals the S1 answer.
	checkEntryNode(t, body, 2, 2, 25)
	if body.TotalOpen != 2 || body.TotalLate != 2 {
		t.Errorf("totals = %d/%d, want 2/2", body.TotalOpen, body.TotalLate)
	}
	if len(body.Cases) != 2 {
		t.Errorf("cases = %d, want 2", len(body.Cases))
	}
	if len(body.People) != 0 {
		t.Errorf("people = %v, want none", body.People)
	}
}

// 4.
func TestSupervisionPeopleLoad(t *testing.T) {
	st := newSupTestAPI(t)
	now := time.Now().UTC().Truncate(time.Second)
	a := createCase(t, seedVersionID, true)
	events := supEvents(a, seedVersionID, now)
	events = append(events, engine.Event{
		CaseID: a, Seq: 4, Type: "step_assigned", At: now, Actor: "u-advisor",
		Payload: json.RawMessage(`{"node_id":"entry","user_id":"u-advisor"}`),
		PrevHash: "h3", Hash: "h4",
	})
	if err := st.AppendEvents(context.Background(), a, events); err != nil {
		t.Fatalf("append chain A: %v", err)
	}
	b := createCase(t, seedVersionID, true)
	supChain(t, st, b, seedVersionID, now)

	rec := do(t, "GET", "/api/versions/"+seedVersionID+"/supervision", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeSupervision(t, rec)

	want := []supPerson{{UserID: "u-advisor", Open: 1, Late: 0}}
	if len(body.People) != 1 || body.People[0] != want[0] {
		t.Errorf("people = %v, want %v", body.People, want)
	}
	checkEntryNode(t, body, 2, 0, 0)
}

// 5.
func TestSupervisionNullDeadlineNeverLate(t *testing.T) {
	st := newSupTestAPI(t)
	versionID := createProcessVersion(t, nullDeadlineDefinition(t), "No deadline")
	now := time.Now().UTC().Truncate(time.Second)
	c := createCase(t, versionID, true)
	supChain(t, st, c, versionID, now.Add(-30*time.Hour))

	rec := do(t, "GET", "/api/versions/"+versionID+"/supervision", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeSupervision(t, rec)

	checkEntryNode(t, body, 1, 0, 30)
	if len(body.Cases) != 1 || body.Cases[0].Late {
		t.Errorf("cases = %+v, want one row with late false", body.Cases)
	}
}

// nullDeadlineDefinition reads the seed definition and clears the
// deadline of the entry node.
func nullDeadlineDefinition(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../../internal/store/seed/example-process.json")
	if err != nil {
		t.Fatalf("read seed definition: %v", err)
	}
	var def map[string]any
	if err := json.Unmarshal(b, &def); err != nil {
		t.Fatalf("unmarshal seed definition: %v", err)
	}
	nodes, ok := def["nodes"].([]any)
	if !ok {
		t.Fatalf("seed definition: no nodes array")
	}
	for _, n := range nodes {
		node, ok := n.(map[string]any)
		if !ok {
			t.Fatalf("seed definition: a node is not an object")
		}
		if node["id"] == "entry" {
			node["deadline_hours"] = nil
		}
	}
	out, err := json.Marshal(def)
	if err != nil {
		t.Fatalf("marshal variant definition: %v", err)
	}
	return out
}

// 6.
func TestSupervisionUnknownVersion(t *testing.T) {
	newSupTestAPI(t)
	rec := do(t, "GET", "/api/versions/ghost/supervision", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no version ghost")
}

// 7.
func TestSupervisionSkipsEventlessCase(t *testing.T) {
	st := newSupTestAPI(t)
	seedTwoLateCases(t, st)
	createCase(t, seedVersionID, true)

	rec := do(t, "GET", "/api/versions/"+seedVersionID+"/supervision", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeSupervision(t, rec)

	checkEntryNode(t, body, 2, 2, 25)
	if body.TotalOpen != 2 || body.TotalLate != 2 {
		t.Errorf("totals = %d/%d, want 2/2", body.TotalOpen, body.TotalLate)
	}
	if len(body.Cases) != 2 {
		t.Errorf("cases = %d, want 2", len(body.Cases))
	}
}
