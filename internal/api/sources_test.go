package api

// The rows of the external sources on the case routes and on the
// test generator.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"testing"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
)

// sourcesFixture is the base fixture of the source rows: the task
// entry lists the sources blacklist and loans, and its check c1 reads
// blacklist.
const sourcesFixture = `{
  "schema_version": "1", "name": "Sources", "currency": "EUR", "policy_document_id": null,
  "theme": {"brand_name": "Sources", "primary_color": "#111111", "logo_url": null},
  "roles": [{"id": "advisor", "name": "Advisor", "department": "Branch"}],
  "fields": [{"name": "amount", "label": "Amount", "type": "money", "options": [], "computed": null}],
  "scope": [{"field": "amount", "role": "advisor", "access": "write"}],
  "nodes": [
    {"id": "start", "type": "start", "name": "Start", "role": null, "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": [], "end_result": null,
     "scope_overrides": [], "source_ids": [], "citations": []},
    {"id": "entry", "type": "task", "name": "Entry", "role": "advisor", "deadline_hours": null,
     "documents": [], "signature": false,
     "checks": [{"id": "c1", "expression": "blacklist.listed == false",
       "message": "The client is on the blacklist.", "plain_text": null, "citations": []}],
     "decisions": [], "end_result": null,
     "scope_overrides": [], "source_ids": ["blacklist", "loans"], "citations": []},
    {"id": "end", "type": "end", "name": "End", "role": null, "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": [], "end_result": "approved",
     "scope_overrides": [], "source_ids": [], "citations": []}
  ],
  "edges": [
    {"id": "e1", "from": "start", "to": "entry", "label": null, "decision": null, "condition": null, "is_default": false},
    {"id": "e2", "from": "entry", "to": "end", "label": null, "decision": null, "condition": null, "is_default": false}
  ],
  "sources": [
    {"id": "blacklist", "name": "Credit blacklist", "url": "http://core.example/api/blacklist",
     "test_values": {"listed": false}},
    {"id": "loans", "name": "Existing loans", "url": "http://core.example/api/loans",
     "test_values": {"monthly_total": 0}}
  ]
}`

// sourcesDoc returns the fixture with the mutation applied.
func sourcesDoc(t *testing.T, mutate func(doc map[string]any)) []byte {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(sourcesFixture), &doc); err != nil {
		t.Fatalf("unmarshal sources fixture: %v", err)
	}
	mutate(doc)
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal sources fixture: %v", err)
	}
	return out
}

// oneSource keeps only the blacklist source, on the list of entry.
func oneSource(doc map[string]any) {
	doc["sources"] = doc["sources"].([]any)[:1]
	doc["nodes"].([]any)[1].(map[string]any)["source_ids"] = []any{"blacklist"}
}

// setURLs rewrites the url of each source: base plus /api/<id>.
func setURLs(base string) func(doc map[string]any) {
	return func(doc map[string]any) {
		for _, s := range doc["sources"].([]any) {
			src := s.(map[string]any)
			src["url"] = base + "/api/" + src["id"].(string)
		}
	}
}

// caseCommand posts one command as u-advisor and returns the recorder.
func caseCommand(t *testing.T, caseID, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/cases/"+caseID+"/commands", body, "u-advisor")
}

// commandEvents posts one command that must answer 200 and returns
// the events and the state of the answer.
func commandEvents(t *testing.T, caseID, body string) ([]engine.Event, map[string]any) {
	t.Helper()
	rec := caseCommand(t, caseID, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("command %s: status %d: %s", body, rec.Code, rec.Body.String())
	}
	var ans struct {
		Events []engine.Event `json:"events"`
		State  map[string]any `json:"state"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &ans); err != nil {
		t.Fatalf("decode command answer: %v", err)
	}
	return ans.Events, ans.State
}

// fetchedValues returns the source id and the values of each
// source_fetched event, in order.
func fetchedValues(t *testing.T, events []engine.Event) [][2]any {
	t.Helper()
	var out [][2]any
	for _, e := range events {
		if e.Type != engine.EventSourceFetched {
			continue
		}
		var p map[string]any
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			t.Fatal(err)
		}
		if p["node_id"] != "entry" || e.Actor != "system" {
			t.Errorf("source_fetched = %v by %s, want node entry by system", p, e.Actor)
		}
		out = append(out, [2]any{p["source_id"], p["values"]})
	}
	return out
}

// typesOf returns the type of each event.
func typesOf(events []engine.Event) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i] = e.Type
	}
	return out
}

// lastCheckResult returns the result of the last check_evaluated.
func lastCheckResult(t *testing.T, events []engine.Event) bool {
	t.Helper()
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type == engine.EventCheckEvaluated {
			var p engine.CheckEvaluatedPayload
			if err := json.Unmarshal(events[i].Payload, &p); err != nil {
				t.Fatal(err)
			}
			return p.Result
		}
	}
	t.Fatal("no check_evaluated event")
	return false
}

// A1, A1b, A1c.
func TestSourceCommands(t *testing.T) {
	newTestAPI(t)
	start := `{"type":"start","data":{"amount":240000}}`

	t.Run("A1 test case", func(t *testing.T) {
		versionID := createProcessVersion(t, []byte(sourcesFixture), "Sources")
		caseID := createCase(t, versionID, true)

		rec := do(t, "GET", "/api/cases/"+caseID, "", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("get case: status %d: %s", rec.Code, rec.Body.String())
		}
		zero := decode(t, rec)["state"].(map[string]any)
		if got, ok := zero["sources"].(map[string]any); !ok || len(got) != 0 {
			t.Errorf("zero state sources = %v, want {}", zero["sources"])
		}

		events, _ := commandEvents(t, caseID, start)
		want := []string{engine.EventCaseCreated, engine.EventEdgeTaken, engine.EventStepEntered,
			engine.EventSourceFetched, engine.EventSourceFetched}
		if got := typesOf(events); !slices.Equal(got, want) {
			t.Errorf("start types = %v, want %v", got, want)
		}
		wantFetched := [][2]any{
			{"blacklist", map[string]any{"listed": false}},
			{"loans", map[string]any{"monthly_total": 0.0}},
		}
		if got := fetchedValues(t, events); !reflect.DeepEqual(got, wantFetched) {
			t.Errorf("fetched = %v, want %v", got, wantFetched)
		}

		commandEvents(t, caseID, `{"type":"take"}`)
		events, st := commandEvents(t, caseID, `{"type":"submit","values":{}}`)
		want = []string{engine.EventDataSubmitted, engine.EventCheckEvaluated, engine.EventEdgeTaken,
			engine.EventStepEntered, engine.EventCaseClosed}
		if got := typesOf(events); !slices.Equal(got, want) {
			t.Errorf("submit types = %v, want %v", got, want)
		}
		if !lastCheckResult(t, events) {
			t.Error("check c1 = false, want true")
		}
		if st["status"] != "closed" || st["result"] != "approved" {
			t.Errorf("final state = %v %v, want closed approved", st["status"], st["result"])
		}
		wantSources := map[string]any{
			"blacklist": map[string]any{"listed": false},
			"loans":     map[string]any{"monthly_total": 0.0},
		}
		if !reflect.DeepEqual(st["sources"], wantSources) {
			t.Errorf("final sources = %v, want %v", st["sources"], wantSources)
		}
	})

	t.Run("A1b production case", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/api/blacklist":
				_, _ = w.Write([]byte(`{"listed":true}`))
			case "/api/loans":
				_, _ = w.Write([]byte(`{"monthly_total":100}`))
			default:
				http.NotFound(w, r)
			}
		}))
		t.Cleanup(srv.Close)
		versionID := createProcessVersion(t, sourcesDoc(t, setURLs(srv.URL)), "Sources live")
		caseID := createCase(t, versionID, false)

		events, _ := commandEvents(t, caseID, start)
		wantFetched := [][2]any{
			{"blacklist", map[string]any{"listed": true}},
			{"loans", map[string]any{"monthly_total": 100.0}},
		}
		if got := fetchedValues(t, events); !reflect.DeepEqual(got, wantFetched) {
			t.Errorf("fetched = %v, want %v", got, wantFetched)
		}
		commandEvents(t, caseID, `{"type":"take"}`)
		events, st := commandEvents(t, caseID, `{"type":"submit","values":{}}`)
		if lastCheckResult(t, events) {
			t.Error("check c1 = true, want false")
		}
		if st["status"] != "open" || st["node_id"] != "entry" {
			t.Errorf("state = %v on %v, want open on entry", st["status"], st["node_id"])
		}
	})

	t.Run("A1c source unavailable", func(t *testing.T) {
		doc := sourcesDoc(t, func(doc map[string]any) {
			oneSource(doc)
			setURLs("http://127.0.0.1:1")(doc)
		})
		versionID := createProcessVersion(t, doc, "Sources down")
		caseID := createCase(t, versionID, false)

		rec := caseCommand(t, caseID, start)
		checkError(t, rec, http.StatusBadGateway, "source_unavailable",
			`source blacklist: Get "http://127.0.0.1:1/api/blacklist": `+
				`dial tcp 127.0.0.1:1: connect: connection refused`)

		rec = do(t, "GET", "/api/cases/"+caseID+"/events", "", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("events: status %d: %s", rec.Code, rec.Body.String())
		}
		if n := len(decode(t, rec)["events"].([]any)); n != 0 {
			t.Errorf("events = %d, want 0", n)
		}
		rec = do(t, "GET", "/api/cases/"+caseID, "", "")
		if st := decode(t, rec)["state"].(map[string]any); st["seq"] != float64(0) {
			t.Errorf("state seq = %v, want 0", st["seq"])
		}
	})
}

// G1.
func TestGenerateTestsSources(t *testing.T) {
	dir := aiEnv(t)
	newTestAPI(t)
	doc := sourcesDoc(t, oneSource)
	def, err := process.Decode(doc)
	if err != nil {
		t.Fatal(err)
	}
	versionID := createProcessVersion(t, doc, "Sources")
	answer := `{"cases":[{"target_edge":"e2",` +
		`"data":[{"field":"amount","value":"240000.0"}],` +
		`"steps":[{"type":"submit","values":[],"decision":null,"document_hash":null}]}]}`
	primeAI(t, dir, msgRuns(t, def, []string{"e1", "e2"}, 1), answer)

	rec := postGenerate(t, versionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Errors) != 0 || len(body.Created) != 1 {
		t.Fatalf("created = %v, errors = %v, want 1 case and no error", body.Created, body.Errors)
	}
	rec = do(t, "GET", "/api/cases/"+body.Created[0].CaseID+"/events", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("events: status %d: %s", rec.Code, rec.Body.String())
	}
	var evBody struct {
		Events []engine.Event `json:"events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &evBody); err != nil {
		t.Fatal(err)
	}
	wantFetched := [][2]any{{"blacklist", map[string]any{"listed": false}}}
	if got := fetchedValues(t, evBody.Events); !reflect.DeepEqual(got, wantFetched) {
		t.Errorf("fetched = %v, want %v", got, wantFetched)
	}
	taken := false
	for _, e := range evBody.Events {
		if e.Type == engine.EventEdgeTaken && string(e.Payload) == `{"edge_id":"e2"}` {
			taken = true
		}
	}
	if !taken {
		t.Errorf("events %v do not take e2", typesOf(evBody.Events))
	}
}
