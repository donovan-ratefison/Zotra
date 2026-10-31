// The tests of the policy update: rows A1 to A11, and T1 to T5 of the
// check mode for version 1. The live rows run
// against one stub server, with the env set before newTestAPI. The
// refusal rows run no AI call.

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/process"
)

// updateParagraphs are the request paragraphs of the rows.
var updateParagraphs = []paragraphIn{
	{ID: "p1-1", Text: "The analyst reviews the file."},
	{ID: "p1-2", Text: "The director decides above EUR 100,000."},
}

// seedDefinition decodes the seed definition.
func seedDefinition(t *testing.T) process.Definition {
	t.Helper()
	def, err := process.Decode(seedBytes(t))
	if err != nil {
		t.Fatal(err)
	}
	return def
}

// committeeDefinition is the seed with the analysis step renamed and a
// new step committee between analysis and threshold.
func committeeDefinition(t *testing.T) process.Definition {
	t.Helper()
	def := seedDefinition(t)
	director := "director"
	var nodes []process.Node
	for _, n := range def.Nodes {
		if n.ID == "analysis" {
			n.Name = "Credit analysis and scoring"
			nodes = append(nodes, n)
			for _, o := range def.Nodes {
				if o.ID == "offer" {
					o.ID, o.Name, o.Role = "committee", "Credit committee", &director
					nodes = append(nodes, o)
				}
			}
			continue
		}
		nodes = append(nodes, n)
	}
	def.Nodes = nodes
	for i := range def.Edges {
		if def.Edges[i].ID == "e05" {
			def.Edges[i].To = "committee"
		}
	}
	e15 := def.Edges[0]
	e15.ID, e15.From, e15.To = "e15", "committee", "threshold"
	def.Edges = append(def.Edges, e15)
	return def
}

// updateDraft forks the seed and stores def in the fork. It returns
// the id of the fork.
func updateDraft(t *testing.T, def process.Definition) string {
	t.Helper()
	id := chatDraft(t)
	raw, err := json.Marshal(map[string]any{"definition": def})
	if err != nil {
		t.Fatal(err)
	}
	if rec := do(t, "PUT", "/api/versions/"+id, string(raw), ""); rec.Code != http.StatusOK {
		t.Fatalf("put status = %d: %s", rec.Code, rec.Body.String())
	}
	return id
}

// updateReq builds one request body.
func updateReq(t *testing.T, versionID string, paragraphs []paragraphIn) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"version_id": versionID, "paragraphs": paragraphs})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// postUpdatePolicy posts one request to the handler under test.
func postUpdatePolicy(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/ai/update-policy", body, "")
}

// updateAnswer is the body of a 200 answer.
type updateAnswer struct {
	BaseNumber int              `json:"base_number"`
	Changed    []policyChange   `json:"changed"`
	Added      []policyAddition `json:"added"`
	Dropped    int              `json:"dropped"`
}

const (
	goodChanged = `{"paragraph_id":"p1-1","new_text":" The analyst reviews and scores the file. ","reason":"The analysis step now scores the file.","element_ids":["analysis"]}`
	goodAdded   = `{"step_id":"committee","after_paragraph_id":"p1-1","text":"The credit committee reviews the file before the amount check.","reason":"New step Credit committee."}`
)

// checkGoodItems checks the two good items of rows A1, A2 and T1, and
// the base number of the diff mode.
func checkGoodItems(t *testing.T, got updateAnswer, dropped int) {
	t.Helper()
	checkGoodItemsBase(t, got, 1, dropped)
}

// checkGoodItemsBase checks the two good items, the base number and
// the dropped count.
func checkGoodItemsBase(t *testing.T, got updateAnswer, base, dropped int) {
	t.Helper()
	wantChanged := []policyChange{{ParagraphID: "p1-1",
		NewText: "The analyst reviews and scores the file.",
		Reason:  "The analysis step now scores the file.", ElementIDs: []string{"analysis"}}}
	wantAdded := []policyAddition{{StepID: "committee", AfterParagraphID: "p1-1",
		Text:   "The credit committee reviews the file before the amount check.",
		Reason: "New step Credit committee."}}
	if !reflect.DeepEqual(got.Changed, wantChanged) {
		t.Errorf("changed = %+v", got.Changed)
	}
	if !reflect.DeepEqual(got.Added, wantAdded) {
		t.Errorf("added = %+v", got.Added)
	}
	if got.BaseNumber != base || got.Dropped != dropped {
		t.Errorf("base_number = %d, dropped = %d, want %d, %d", got.BaseNumber, got.Dropped, base, dropped)
	}
}

// A1.
func TestUpdatePolicyAnswers(t *testing.T) {
	stub := fmt.Sprintf(`{"changed":[%s],"added":[%s]}`, goodChanged, goodAdded)
	srv, count, seen := changeLiveStub(t, []string{chatEnvelope(stub)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	id := updateDraft(t, committeeDefinition(t))

	rec := postUpdatePolicy(t, updateReq(t, id, updateParagraphs))
	checkOK(t, rec)
	var got updateAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	checkGoodItems(t, got, 0)
	if *count != 1 {
		t.Fatalf("requests = %d, want 1", *count)
	}
	req := requestMessages(t, (*seen)[0])
	if len(req.Messages) != 2 || req.Messages[0].Content != ai.UpdatePolicySystem {
		t.Fatal("system message is not UpdatePolicySystem")
	}
	user := req.Messages[1].Content
	if !strings.HasPrefix(user, "Policy paragraphs:\np1-1: The analyst reviews the file.\np1-2: ") {
		t.Errorf("user message starts with %q", user[:60])
	}
	wantEnd := "Changes since version 1:\n" +
		"~ step analysis \"Credit analysis and scoring\"\n" +
		"+ step committee \"Credit committee\"\n" +
		"~ link e05 analysis -> committee\n" +
		"+ link e15 committee -> threshold"
	if !strings.HasSuffix(user, wantEnd) {
		t.Errorf("user message ends with %q", user[len(user)-200:])
	}
	var format struct {
		ResponseFormat struct {
			JSONSchema struct {
				Name string `json:"name"`
			} `json:"json_schema"`
		} `json:"response_format"`
	}
	if err := json.Unmarshal([]byte((*seen)[0]), &format); err != nil {
		t.Fatal(err)
	}
	if format.ResponseFormat.JSONSchema.Name != "policy_update" {
		t.Errorf("schema name = %q", format.ResponseFormat.JSONSchema.Name)
	}
}

// A2.
func TestUpdatePolicyDropsBadItems(t *testing.T) {
	bad := []string{
		`{"paragraph_id":"p9-9","new_text":"T","reason":"R","element_ids":["analysis"]}`,
		`{"paragraph_id":"p1-2","new_text":"T","reason":"R","element_ids":["offer"]}`,
		`{"paragraph_id":"p1-2","new_text":"T","reason":"R","element_ids":[]}`,
		`{"paragraph_id":"p1-1","new_text":"T","reason":"R","element_ids":["analysis"]}`,
		`{"paragraph_id":"p1-2","new_text":"  ","reason":"R","element_ids":["analysis"]}`,
	}
	badAdded := []string{
		`{"step_id":"analysis","after_paragraph_id":"p1-1","text":"T","reason":"R"}`,
		`{"step_id":"committee","after_paragraph_id":"p9-9","text":"T","reason":"R"}`,
		`{"step_id":"committee","after_paragraph_id":"p1-1","text":"T","reason":" "}`,
	}
	stub := fmt.Sprintf(`{"changed":[%s,%s],"added":[%s,%s]}`, goodChanged,
		strings.Join(bad, ","), strings.Join(badAdded, ","), goodAdded)
	srv, _, _ := changeLiveStub(t, []string{chatEnvelope(stub)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	id := updateDraft(t, committeeDefinition(t))

	rec := postUpdatePolicy(t, updateReq(t, id, updateParagraphs))
	checkOK(t, rec)
	var got updateAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	checkGoodItems(t, got, 8)
}

// A3.
func TestUpdatePolicyEmptyAnswer(t *testing.T) {
	srv, _, _ := changeLiveStub(t, []string{chatEnvelope(`{"changed":[],"added":[]}`)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	id := updateDraft(t, committeeDefinition(t))

	rec := postUpdatePolicy(t, updateReq(t, id, updateParagraphs))
	checkOK(t, rec)
	want := `{"added":[],"base_number":1,"changed":[],"dropped":0}`
	if got := strings.TrimSpace(rec.Body.String()); got != want {
		t.Errorf("body = %s, want %s", got, want)
	}
}

// A4.
func TestUpdatePolicyInvalidOutput(t *testing.T) {
	for _, stub := range []string{chatEnvelope("not json"), `{"choices":[]}`} {
		t.Run(stub, func(t *testing.T) {
			srv, count, _ := changeLiveStub(t, []string{stub})
			aiLive(t, srv.URL)
			newTestAPI(t)
			id := updateDraft(t, committeeDefinition(t))
			rec := postUpdatePolicy(t, updateReq(t, id, updateParagraphs))
			checkError(t, rec, http.StatusUnprocessableEntity, "invalid_output", msgNoContent)
			if *count != 1 {
				t.Errorf("requests = %d, want 1", *count)
			}
		})
	}
}

// A5.
func TestUpdatePolicyAIOff(t *testing.T) {
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	newTestAPI(t)
	id := updateDraft(t, committeeDefinition(t))
	rec := postUpdatePolicy(t, updateReq(t, id, updateParagraphs))
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable", "The AI layer is off.")
}

// A6, A7 and A8: the refusals, no AI call.
func TestUpdatePolicyRefusals(t *testing.T) {
	srv, count, _ := changeLiveStub(t, []string{chatEnvelope(`{"changed":[],"added":[]}`)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	id := updateDraft(t, committeeDefinition(t))
	unchanged := chatDraft(t)
	many := make([]paragraphIn, 501)
	for i := range many {
		many[i] = paragraphIn{ID: fmt.Sprintf("p1-%d", i+1), Text: "T"}
	}
	missing := "00000000-0000-0000-0000-0000000000ff"
	rows := []struct {
		name   string
		body   string
		status int
		code   string
		msg    string
	}{
		{"bad json", `{`, 400, "invalid_json", msgInvalidJSON},
		{"no paragraphs", updateReq(t, id, []paragraphIn{}), 400, "invalid_paragraphs", msgInvalidParagraphs},
		{"501 paragraphs", updateReq(t, id, many), 400, "invalid_paragraphs", msgInvalidParagraphs},
		{"id p0-1", updateReq(t, id, []paragraphIn{{ID: "p0-1", Text: "T"}}), 400, "invalid_paragraphs", msgInvalidParagraphs},
		{"duplicate id", updateReq(t, id, []paragraphIn{{ID: "p1-1", Text: "T"}, {ID: "p1-1", Text: "U"}}), 400, "invalid_paragraphs", msgInvalidParagraphs},
		{"empty text", updateReq(t, id, []paragraphIn{{ID: "p1-1", Text: ""}}), 400, "invalid_paragraphs", msgInvalidParagraphs},
		{"not a uuid", updateReq(t, "not-a-uuid", updateParagraphs), 404, "not_found", "no version not-a-uuid"},
		{"unknown version", updateReq(t, missing, updateParagraphs), 404, "not_found", "no version " + missing},
		{"version 1, id p0-1", updateReq(t, changeSeedVersionID, []paragraphIn{{ID: "p0-1", Text: "T"}}), 400, "invalid_paragraphs", msgInvalidParagraphs},
		{"fork with no change", updateReq(t, unchanged, updateParagraphs), 400, "no_changes", msgNoPolicyChanges},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			rec := postUpdatePolicy(t, row.body)
			checkError(t, rec, row.status, row.code, row.msg)
		})
	}
	if *count != 0 {
		t.Errorf("requests = %d, want 0", *count)
	}
}

// T1: an imported version 1 with one change gives a draft in check
// mode.
func TestUpdatePolicyFirstVersion(t *testing.T) {
	stub := fmt.Sprintf(`{"changed":[%s],"added":[%s]}`, goodChanged, goodAdded)
	srv, count, seen := changeLiveStub(t, []string{chatEnvelope(stub)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	id := createProcessVersion(t, seedBytes(t), "Import")
	def := committeeDefinition(t)
	raw, err := json.Marshal(map[string]any{"definition": def})
	if err != nil {
		t.Fatal(err)
	}
	if rec := do(t, "PUT", "/api/versions/"+id, string(raw), ""); rec.Code != http.StatusOK {
		t.Fatalf("put status = %d: %s", rec.Code, rec.Body.String())
	}

	rec := postUpdatePolicy(t, updateReq(t, id, updateParagraphs))
	checkOK(t, rec)
	var got updateAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	checkGoodItemsBase(t, got, 0, 0)
	if *count != 1 {
		t.Fatalf("requests = %d, want 1", *count)
	}
	req := requestMessages(t, (*seen)[0])
	if len(req.Messages) != 2 || req.Messages[0].Content != ai.UpdatePolicyCheckSystem {
		t.Fatal("system message is not UpdatePolicyCheckSystem")
	}
	// The store may reformat the JSON, so the definition is read back
	// from the message and compared as a parsed value.
	user := req.Messages[1].Content
	marker := "\n\nProcess file (JSON):\n"
	stored := user[strings.Index(user, marker)+len(marker):]
	paragraphs, _ := policyParagraphs(updateParagraphs)
	if user != ai.UpdatePolicyCheckUser(paragraphs, stored) {
		t.Errorf("user message = %q", user)
	}
	if strings.Contains(user, "Changes since") {
		t.Error("user message holds a change list")
	}
	var have, want any
	if err := json.Unmarshal([]byte(stored), &have); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(have, want.(map[string]any)["definition"]) {
		t.Error("process file of the message is not the stored definition")
	}
}

// T2: version 1 with no change goes to the AI. The items cite the
// steps and links of the definition.
func TestUpdatePolicyFirstVersionChecks(t *testing.T) {
	stub := `{"changed":[` +
		`{"paragraph_id":"p1-1","new_text":"T","reason":"R","element_ids":["e01"]},` +
		`{"paragraph_id":"p1-2","new_text":"T","reason":"R","element_ids":["nope"]}` +
		`],"added":[` +
		`{"step_id":"analysis","after_paragraph_id":"p1-1","text":"T","reason":"R"},` +
		`{"step_id":"nope","after_paragraph_id":"p1-1","text":"T","reason":"R"}]}`
	srv, count, _ := changeLiveStub(t, []string{chatEnvelope(stub)})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postUpdatePolicy(t, updateReq(t, changeSeedVersionID, updateParagraphs))
	checkOK(t, rec)
	var got updateAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.BaseNumber != 0 || got.Dropped != 2 || *count != 1 {
		t.Errorf("base_number = %d, dropped = %d, requests = %d, want 0, 2, 1",
			got.BaseNumber, got.Dropped, *count)
	}
	if len(got.Changed) != 1 || got.Changed[0].ParagraphID != "p1-1" {
		t.Errorf("changed = %+v", got.Changed)
	}
	if len(got.Added) != 1 || got.Added[0].StepID != "analysis" {
		t.Errorf("added = %+v", got.Added)
	}
}

// A9.
func TestUpdatePolicyChangesReverse(t *testing.T) {
	lines, _, added := changedElements(committeeDefinition(t), seedDefinition(t))
	want := []string{
		`~ step analysis "Credit analysis"`,
		`- step committee "Credit committee"`,
		`~ link e05 analysis -> threshold`,
		`- link e15 committee -> threshold`,
	}
	if !reflect.DeepEqual(lines, want) {
		t.Errorf("lines = %q", lines)
	}
	if len(added) != 0 {
		t.Errorf("addedSteps = %v, want empty", added)
	}
}

// A10.
func TestUpdatePolicyCheckChange(t *testing.T) {
	next := seedDefinition(t)
	for i := range next.Nodes {
		for j := range next.Nodes[i].Checks {
			if next.Nodes[i].Checks[j].ID == "entry-amount" {
				next.Nodes[i].Checks[j].Message = "The amount must be positive."
			}
		}
	}
	lines, changed, _ := changedElements(seedDefinition(t), next)
	if want := []string{`~ step entry "Application entry"`}; !reflect.DeepEqual(lines, want) {
		t.Errorf("lines = %q, want %q", lines, want)
	}
	if !changed["entry"] || len(changed) != 1 {
		t.Errorf("changed = %v", changed)
	}
}

// A11: copy of TestRestateSchemaStrict.
func TestUpdatePolicySchemaStrict(t *testing.T) {
	objects := 0
	var walk func(path string, node map[string]any)
	walk = func(path string, node map[string]any) {
		if node["type"] == "object" {
			objects++
			props, _ := node["properties"].(map[string]any)
			required, _ := node["required"].([]string)
			if node["additionalProperties"] != false {
				t.Errorf("%s: additionalProperties is not false", path)
			}
			have := map[string]bool{}
			for _, key := range required {
				have[key] = true
			}
			for key := range props {
				if !have[key] {
					t.Errorf("%s: key %s is not required", path, key)
				}
			}
			if len(required) != len(props) {
				t.Errorf("%s: required has %d keys, properties %d", path, len(required), len(props))
			}
			for key, child := range props {
				walk(path+"/"+key, child.(map[string]any))
			}
		}
		if items, ok := node["items"].(map[string]any); ok {
			walk(path+"/items", items)
		}
	}
	walk("", updatePolicySchema)
	if objects != 3 {
		t.Errorf("objects = %d, want 3", objects)
	}
}
