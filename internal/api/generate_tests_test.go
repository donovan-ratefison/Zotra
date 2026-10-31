package api

// The tests of the test generator. Each row runs in mode replay:
// the cache is primed with the exact request bytes the handler
// sends, so no live AI call happens. Row 8 runs in mode off.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/coverage"
	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// aiEnv sets the AI mode to replay and the cache dir to one fresh
// temp dir. It returns the dir. Call it before the store setup.
func aiEnv(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("ZOTRA_AI_MODE", "replay")
	t.Setenv("ZOTRA_AI_CACHE_DIR", dir)
	return dir
}

// newTestStoreAPI opens the test store and the handler with it, and
// returns the store. The rows that assert store rows use it.
func newTestStoreAPI(t *testing.T) *store.Store {
	t.Helper()
	st := openTestStore(t)
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<p>index</p>")}}
	h := NewHandler(static, "v-test", st, "")
	testAPIHandler = h
	return st
}

// primeAI writes one cache file for the Chat Completions request the
// handler sends with these messages: <dir>/<CacheKey>.json holds the
// cache entry shape with a Chat Completions envelope as body, and
// answer sits in choices[0].message.content. The request URI is
// /v1/chat/completions: the default BaseURL https://api.meta.ai/v1
// plus the client path /chat/completions.
func primeAI(t *testing.T, dir string, messages []ai.Message, answer string) {
	t.Helper()
	// The request bytes, with the same shape and tags as client.go.
	type jsonSchemaWire struct {
		Name   string         `json:"name"`
		Strict bool           `json:"strict"`
		Schema map[string]any `json:"schema"`
	}
	type responseFormatWire struct {
		Type       string         `json:"type"`
		JSONSchema jsonSchemaWire `json:"json_schema"`
	}
	req := struct {
		Model          string              `json:"model"`
		Messages       []ai.Message        `json:"messages"`
		ResponseFormat *responseFormatWire `json:"response_format"`
	}{
		Model:    "muse-spark-1.3",
		Messages: messages,
		ResponseFormat: &responseFormatWire{
			Type:       "json_schema",
			JSONSchema: jsonSchemaWire{Name: "generate_tests", Strict: true, Schema: generateTestsSchema()},
		},
	}
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	// The envelope: the model answer sits in the content string.
	env := struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}{}
	env.Choices = append(env.Choices, struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}{})
	env.Choices[0].Message.Content = answer
	envelope, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	entry := struct {
		Status  int         `json:"status"`
		Headers http.Header `json:"headers"`
		Body    string      `json:"body"`
	}{Status: 200, Headers: http.Header{}, Body: string(envelope)}
	entryBytes, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal cache entry: %v", err)
	}
	path := filepath.Join(dir, ai.CacheKey("POST", "/v1/chat/completions", body)+".json")
	if err := os.WriteFile(path, entryBytes, 0o644); err != nil {
		t.Fatalf("write cache file: %v", err)
	}
}

// postGenerate runs POST /api/ai/generate-tests for one version.
func postGenerate(t *testing.T, versionID string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/ai/generate-tests",
		fmt.Sprintf(`{"version_id":%q}`, versionID), "")
}

// generateBody is the decoded answer of the generate-tests route.
type generateBody struct {
	VersionID string           `json:"version_id"`
	RedEdges  []string         `json:"red_edges"`
	Created   []createdCaseDTO `json:"created"`
	Errors    []string         `json:"errors"`
}

// decodeGenerate unmarshals one answer of the generate-tests route.
func decodeGenerate(t *testing.T, rec *httptest.ResponseRecorder) generateBody {
	t.Helper()
	var body generateBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal answer: %v: %s", err, rec.Body.String())
	}
	return body
}

// equalStrings reports whether both lists hold the same strings in
// the same order.
func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// defOfExample decodes the example process, the definition of the
// seeded version.
func defOfExample(t *testing.T) process.Definition {
	t.Helper()
	def, err := process.Decode(exampleDefinition(t))
	if err != nil {
		t.Fatalf("decode example definition: %v", err)
	}
	return def
}

// red14 is the red list of a version with no test case: all 14 edges
// of the example process, in definition order.
var red14 = []string{
	"e01", "e02", "e03", "e04", "e05", "e06", "e07",
	"e08", "e09", "e10", "e11", "e12", "e13", "e14",
}

// answerRow2 is the primed model answer of the AI rows that need one
// good case: one submit of 3 documents takes e04, and the complete
// gateway loops back to entry. The field values travel in pairs: the
// value of each pair is the JSON text of the value.
const answerRow2 = `{"cases":[{"target_edge":"e04","data":` + dataPairs +
	`,"steps":[{"type":"submit","values":[` + docValuesPair +
	`],"decision":null,"document_hash":null}]}]}`

// dataPairs is the start data of the example process in pair form,
// with the 3 documents of the e04 path.
const dataPairs = `[` +
	`{"field":"client_name","value":"\"Ravina Soa\""},` +
	`{"field":"profession","value":"\"Engineer\""},` +
	`{"field":"amount","value":"240000.0"},` +
	`{"field":"duration_months","value":"240"},` +
	`{"field":"down_payment","value":"40000.0"},` +
	`{"field":"annual_rate","value":"0.035"},` +
	`{"field":"monthly_income","value":"4500.0"},` +
	`{"field":"documents","value":"[\"ID card\",\"Salary slips\",\"Bank statements\"]"}]`

// entrySubmit returns the entry submit body with one amount and the
// named documents.
func entrySubmit(amount string, docs ...string) string {
	list := ""
	for k, d := range docs {
		if k > 0 {
			list += ","
		}
		list += fmt.Sprintf("%q", d)
	}
	return fmt.Sprintf(`{"type":"submit","values":{"client_name":`+
		`"Ravina Soa","profession":"Engineer","amount":%s,`+
		`"duration_months":240,"down_payment":40000.0,`+
		`"annual_rate":0.035,"monthly_income":4500.0,"documents":[%s]}}`,
		amount, list)
}

// analysisSubmit returns the analysis submit body.
func analysisSubmit() string {
	return `{"type":"submit","values":{"analysis_opinion":"favorable",` +
		`"analysis_comment":""}}`
}

// cmdRow is one command call of a seeded case: the body and the user.
type cmdRow struct{ body, user string }

var (
	cmdStart   = cmdRow{`{"type":"start","data":{}}`, "u-advisor"}
	cmdTake    = cmdRow{`{"type":"take"}`, "u-analyst"}
	cmdRelease = cmdRow{`{"type":"submit","values":` +
		`{"release_date":"2099-01-01T00:00:00Z"}}`, "u-backoffice"}
)

// cmdDecide, cmdSign and cmdEmptySubmit build one command row.
func cmdDecide(decision, user string) cmdRow {
	return cmdRow{fmt.Sprintf(`{"type":"decide","decision":%q}`, decision), user}
}

func cmdSign(user string) cmdRow {
	return cmdRow{`{"type":"sign","document_hash":"sha256-1"}`, user}
}

func cmdEmptySubmit(user string) cmdRow {
	return cmdRow{`{"type":"submit","values":{}}`, user}
}

// approvedRun returns the start and the analysis commands of the
// approved path, up to the sign on the decision node.
func approvedRun(amount string) []cmdRow {
	return []cmdRow{
		cmdStart,
		{entrySubmit(amount, "ID card", "Salary slips",
			"Bank statements", "Property title"), "u-advisor"},
		cmdTake,
		{analysisSubmit(), "u-analyst"},
		cmdDecide("favorable", "u-analyst"),
		cmdSign("u-director"),
	}
}

// seedCase creates one test case on the version and runs its
// commands through the API. It returns the case id.
func seedCase(t *testing.T, versionID string, cmds []cmdRow) string {
	t.Helper()
	caseID := createCase(t, versionID, true)
	for _, c := range cmds {
		rec := do(t, "POST", "/api/cases/"+caseID+"/commands", c.body, c.user)
		if rec.Code != http.StatusOK {
			t.Fatalf("command %s: status %d: %s", c.body, rec.Code, rec.Body.String())
		}
	}
	return caseID
}

// msgRuns returns the messages of attempt n of the repair loop.
// Attempt 1 is system plus user. Each later attempt adds the
// assistant content of the failed answer and the repair user
// message with the errors so far.
func msgRuns(t *testing.T, def process.Definition, red []string, n int) []ai.Message {
	t.Helper()
	redJSON, err := json.Marshal(red)
	if err != nil {
		t.Fatalf("marshal red list: %v", err)
	}
	msgs := []ai.Message{
		{Role: "system", Content: ai.GenerateTestsSystem},
		{Role: "user", Content: fmt.Sprintf(ai.GenerateTestsUser,
			string(processSummary(def)), redJSON)},
	}
	schemaErr := func(k int) string {
		return fmt.Sprintf("attempt %d: the answer does not match the schema", k)
	}
	appendFailure := func(errs []string) {
		msgs = append(msgs,
			ai.Message{Role: "assistant", Content: "{oops"},
			ai.Message{Role: "user", Content: fmt.Sprintf(
				ai.GenerateTestsRepair, strings.Join(errs, "; "))})
	}
	if n >= 2 {
		appendFailure([]string{schemaErr(1)})
	}
	if n >= 3 {
		appendFailure([]string{schemaErr(1), schemaErr(2)})
	}
	return msgs
}

// 1.
func TestNoRedEdges(t *testing.T) {
	dir := aiEnv(t)
	newTestAPI(t)

	// A: the approved run, released.
	seedCase(t, seedVersionID, append(approvedRun("240000.0"),
		cmdDecide("approve", "u-director"),
		cmdEmptySubmit("u-legal"),
		cmdEmptySubmit("u-advisor"),
		cmdRelease,
	))
	// B: the small amount takes the default edge e08.
	seedCase(t, seedVersionID, []cmdRow{
		cmdStart,
		{entrySubmit("90000.0", "ID card", "Salary slips",
			"Bank statements", "Property title"), "u-advisor"},
		cmdTake,
		{analysisSubmit(), "u-analyst"},
		cmdDecide("favorable", "u-analyst"),
		cmdSign("u-legal"),
		cmdEmptySubmit("u-legal"),
		cmdEmptySubmit("u-advisor"),
		cmdRelease,
	})
	// C: refuse at the decision step, e10.
	seedCase(t, seedVersionID, append(approvedRun("240000.0"),
		cmdDecide("refuse", "u-director"),
	))
	// D: return at the decision step, e11.
	seedCase(t, seedVersionID, append(approvedRun("240000.0"),
		cmdDecide("return", "u-director"),
	))
	// E: 3 documents, then 4, then unfavorable: e04 and e06.
	seedCase(t, seedVersionID, []cmdRow{
		cmdStart,
		{entrySubmit("240000.0", "ID card", "Salary slips", "Bank statements"), "u-advisor"},
		{entrySubmit("240000.0", "ID card", "Salary slips",
			"Bank statements", "Property title"), "u-advisor"},
		cmdTake,
		cmdDecide("unfavorable", "u-analyst"),
	})

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	// The raw body holds the empty list, not null.
	if !strings.Contains(rec.Body.String(), `"red_edges":[]`) {
		t.Errorf("body = %s, want the text \"red_edges\":[]", rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.RedEdges) != 0 {
		t.Errorf("red_edges = %v, want empty", body.RedEdges)
	}
	if len(body.Created) != 0 {
		t.Errorf("created = %v, want empty", body.Created)
	}
	if len(body.Errors) != 0 {
		t.Errorf("errors = %v, want empty", body.Errors)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read cache dir: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("cache dir holds %d entries, want 0", len(entries))
	}
}

// 2.
func TestGeneratesCase(t *testing.T) {
	dir := aiEnv(t)
	newTestAPI(t)
	def := defOfExample(t)
	primeAI(t, dir, msgRuns(t, def, red14, 1), answerRow2)

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if !equalStrings(body.RedEdges, red14) {
		t.Errorf("red_edges = %v, want the 14 ids", body.RedEdges)
	}
	if len(body.Errors) != 0 {
		t.Errorf("errors = %v, want empty", body.Errors)
	}
	if len(body.Created) != 1 {
		t.Fatalf("created = %v, want 1 entry", body.Created)
	}
	created := body.Created[0]
	if created.TargetEdge != "e04" {
		t.Errorf("target_edge = %q, want e04", created.TargetEdge)
	}
	if created.CaseID == "" {
		t.Errorf("case_id is empty")
	}
	year := time.Now().UTC().Format("2006")
	if want := "CASE-" + year + "-0001"; created.Reference != want {
		t.Errorf("reference = %q, want %q", created.Reference, want)
	}

	// A fresh coverage of the version test cases no longer lists
	// e04: the gateway saw 3 documents and looped back to entry.
	rec = do(t, "GET", "/api/cases/"+created.CaseID+"/events", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("events status = %d: %s", rec.Code, rec.Body.String())
	}
	var evBody struct {
		Events []engine.Event `json:"events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &evBody); err != nil {
		t.Fatalf("unmarshal events: %v", err)
	}
	report := coverage.OfCases(def,
		map[string][]engine.Event{created.CaseID: evBody.Events})
	// The case took e01, e02 and e04, so 11 edges stay red.
	got := report.Red()
	if len(got) != 11 {
		t.Errorf("Red = %v, want the 11 ids without e01, e02, e04", got)
	}
	for _, e := range got {
		if e == "e04" {
			t.Errorf("e04 is still red")
		}
	}
}

// 3.
func TestRepairLoop(t *testing.T) {
	dir := aiEnv(t)
	newTestAPI(t)
	def := defOfExample(t)
	primeAI(t, dir, msgRuns(t, def, red14, 1), "{oops")
	primeAI(t, dir, msgRuns(t, def, red14, 2), answerRow2)

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Created) != 1 {
		t.Fatalf("created = %v, want 1 entry", body.Created)
	}
	if body.Created[0].TargetEdge != "e04" {
		t.Errorf("target_edge = %q, want e04", body.Created[0].TargetEdge)
	}
	if len(body.Errors) != 0 {
		t.Errorf("errors = %v, want empty", body.Errors)
	}
}

// 4.
func TestThreeFailures(t *testing.T) {
	dir := aiEnv(t)
	st := newTestStoreAPI(t)
	def := defOfExample(t)
	primeAI(t, dir, msgRuns(t, def, red14, 1), "{oops")
	primeAI(t, dir, msgRuns(t, def, red14, 2), "{oops")
	primeAI(t, dir, msgRuns(t, def, red14, 3), "{oops")

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Created) != 0 {
		t.Errorf("created = %v, want empty", body.Created)
	}
	want := []string{
		"attempt 1: the answer does not match the schema",
		"attempt 2: the answer does not match the schema",
		"attempt 3: the answer does not match the schema",
	}
	if !equalStrings(body.Errors, want) {
		t.Errorf("errors = %v, want %v", body.Errors, want)
	}
	cs, err := st.ListCases(t.Context())
	if err != nil {
		t.Fatalf("list cases: %v", err)
	}
	if len(cs) != 0 {
		t.Errorf("ListCases = %d rows, want 0", len(cs))
	}
}

// entryDataPairs is the start data of the example process in pair
// form, with the four documents of the e06 path. The rows below
// change one pair with strings.Replace, so the base stays one
// fixture.
const entryDataPairs = `[{"field":"client_name","value":"\"Ravina Soa\""},` +
	`{"field":"profession","value":"\"Engineer\""},` +
	`{"field":"amount","value":"240000.0"},` +
	`{"field":"duration_months","value":"240"},` +
	`{"field":"down_payment","value":"40000.0"},` +
	`{"field":"annual_rate","value":"0.035"},` +
	`{"field":"monthly_income","value":"4500.0"},` +
	`{"field":"documents","value":"[\"ID card\",\"Salary slips\",\"Bank statements\",\"Property title\"]"}]`

// docValuesPair is the values pair of the e04 submit: the JSON text
// of the 3-document list.
const docValuesPair = `{"field":"documents",` +
	`"value":"[\"ID card\",\"Salary slips\",\"Bank statements\"]"}`

// 5.
func TestDroppedCases(t *testing.T) {
	dir := aiEnv(t)
	st := newTestStoreAPI(t)
	def := defOfExample(t)
	answer := fmt.Sprintf(`{"cases":[`+
		`{"target_edge":"e04","data":%s,`+
		`"steps":[{"type":"decide","decision":"maybe",`+
		`"values":null,"document_hash":null}]},`+
		`{"target_edge":"e06","data":%s,"steps":[`+
		`{"type":"submit","values":[],`+
		`"decision":null,"document_hash":null}]}]}`,
		entryDataPairs, entryDataPairs)
	primeAI(t, dir, msgRuns(t, def, red14, 1), answer)

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Created) != 0 {
		t.Errorf("created = %v, want empty", body.Created)
	}
	want := []string{
		"case 1: step 1: node entry has no decisions",
		"case 2: edge e06 not reached",
	}
	if !equalStrings(body.Errors, want) {
		t.Errorf("errors = %v, want %v", body.Errors, want)
	}
	cs, err := st.ListCases(t.Context())
	if err != nil {
		t.Fatalf("list cases: %v", err)
	}
	if len(cs) != 2 {
		t.Fatalf("ListCases = %d rows, want 2", len(cs))
	}
	for _, c := range cs {
		events, err := st.ListEvents(t.Context(), c.ID)
		if err != nil {
			t.Fatalf("list events: %v", err)
		}
		if len(events) != 0 {
			t.Errorf("case %s holds %d events, want 0", c.ID, len(events))
		}
	}
}

// 6.
func TestSkippedTarget(t *testing.T) {
	dir := aiEnv(t)
	st := newTestStoreAPI(t)
	def := defOfExample(t)
	answer := fmt.Sprintf(`{"cases":[{"target_edge":"e99","data":%s,`+
		`"steps":[]}]}`, entryDataPairs)
	primeAI(t, dir, msgRuns(t, def, red14, 1), answer)

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Created) != 0 {
		t.Errorf("created = %v, want empty", body.Created)
	}
	want := []string{"case 1: target e99 is not red"}
	if !equalStrings(body.Errors, want) {
		t.Errorf("errors = %v, want %v", body.Errors, want)
	}
	cs, err := st.ListCases(t.Context())
	if err != nil {
		t.Fatalf("list cases: %v", err)
	}
	if len(cs) != 0 {
		t.Errorf("ListCases = %d rows, want 0", len(cs))
	}
}

// 7.
func TestRefusals(t *testing.T) {
	aiEnv(t)
	newTestAPI(t)

	rec := do(t, "POST", "/api/ai/generate-tests", `{bad`, "")
	checkError(t, rec, http.StatusBadRequest, "invalid_json", msgInvalidJSON)

	rec = do(t, "POST", "/api/ai/generate-tests", `{"version_id":"ghost"}`, "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no version ghost")
}

// 8.
func TestAIOff(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", dir)
	newTestAPI(t)

	rec := postGenerate(t, seedVersionID)
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable",
		"The AI layer is off.")
}

// 8b. Replay with an empty cache.
func TestGenerateReplayMiss(t *testing.T) {
	aiEnv(t)
	newTestAPI(t)

	rec := postGenerate(t, seedVersionID)
	checkError(t, rec, http.StatusServiceUnavailable, "ai_not_recorded", msgReplayMiss)
}

// 9.
func TestBrokenDefinition(t *testing.T) {
	aiEnv(t)
	newTestAPI(t)
	versionID := createProcessVersion(t, []byte(`{"schema_version":1}`), "Broken")

	rec := postGenerate(t, versionID)
	checkError(t, rec, http.StatusInternalServerError, "internal",
		"cannot complete the request")
}

// 10.
func TestStepErrors(t *testing.T) {
	dir := aiEnv(t)
	st := newTestStoreAPI(t)
	def := defOfExample(t)
	// Case 2 adds one unknown field: one more pair in the start data.
	ghostData := strings.TrimSuffix(entryDataPairs, `]`) +
		`,{"field":"ghost","value":"\"x\""}]`
	answer := fmt.Sprintf(`{"cases":[`+
		`{"target_edge":"e04","data":%s,"steps":[`+
		`{"type":"take","values":null,"decision":null,`+
		`"document_hash":null}]},`+
		`{"target_edge":"e04","data":%s,"steps":[{"type":"submit",`+
		`"values":[%s],"decision":null,"document_hash":null}]}]}`,
		entryDataPairs, ghostData, docValuesPair)
	primeAI(t, dir, msgRuns(t, def, red14, 1), answer)

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Created) != 0 {
		t.Errorf("created = %v, want empty", body.Created)
	}
	want := []string{
		"case 1: step 1: unknown step type take",
		"case 2: unknown field ghost",
	}
	if !equalStrings(body.Errors, want) {
		t.Errorf("errors = %v, want %v", body.Errors, want)
	}
	cs, err := st.ListCases(t.Context())
	if err != nil {
		t.Fatalf("list cases: %v", err)
	}
	if len(cs) != 2 {
		t.Fatalf("ListCases = %d rows, want 2", len(cs))
	}
	for _, c := range cs {
		events, err := st.ListEvents(t.Context(), c.ID)
		if err != nil {
			t.Fatalf("list events: %v", err)
		}
		if len(events) != 0 {
			t.Errorf("case %s holds %d events, want 0", c.ID, len(events))
		}
	}
}

// 11.
func TestEmptyAnswer(t *testing.T) {
	dir := aiEnv(t)
	st := newTestStoreAPI(t)
	def := defOfExample(t)
	primeAI(t, dir, msgRuns(t, def, red14, 1), `{"cases":[]}`)

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Created) != 0 {
		t.Errorf("created = %v, want empty", body.Created)
	}
	if len(body.Errors) != 0 {
		t.Errorf("errors = %v, want empty", body.Errors)
	}
	if !equalStrings(body.RedEdges, red14) {
		t.Errorf("red_edges = %v, want the 14 ids", body.RedEdges)
	}
	cs, err := st.ListCases(t.Context())
	if err != nil {
		t.Fatalf("list cases: %v", err)
	}
	if len(cs) != 0 {
		t.Errorf("ListCases = %d rows, want 0", len(cs))
	}
}

// 12.
func TestPairValues(t *testing.T) {
	dir := aiEnv(t)
	st := newTestStoreAPI(t)
	def := defOfExample(t)
	// The start data holds a quoted string, an array, and two entries
	// with the field client_name: the last entry wins.
	data := strings.Replace(dataPairs,
		`{"field":"client_name","value":"\"Ravina Soa\""},`,
		`{"field":"client_name","value":"\"First entry\""},`+
			`{"field":"client_name","value":"\"Ravina Soa\""},`, 1)
	answer := fmt.Sprintf(`{"cases":[{"target_edge":"e04","data":%s,`+
		`"steps":[{"type":"submit","values":[%s],"decision":null,`+
		`"document_hash":null}]}]}`, data, docValuesPair)
	primeAI(t, dir, msgRuns(t, def, red14, 1), answer)

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Created) != 1 {
		t.Fatalf("created = %v, want 1 entry", body.Created)
	}
	if len(body.Errors) != 0 {
		t.Errorf("errors = %v, want empty", body.Errors)
	}
	// The start event holds the decoded map: the quoted string decodes
	// without its quotes, the array decodes as a list, and the last
	// duplicate entry gives the value.
	events, err := st.ListEvents(t.Context(), body.Created[0].CaseID)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) == 0 || events[0].Type != engine.EventCaseCreated {
		t.Fatalf("first event = %+v, want case_created", events[0])
	}
	var p engine.CaseCreatedPayload
	if err := json.Unmarshal(events[0].Payload, &p); err != nil {
		t.Fatalf("unmarshal start payload: %v", err)
	}
	if p.Data["client_name"] != "Ravina Soa" {
		t.Errorf("client_name = %v, want the last entry Ravina Soa", p.Data["client_name"])
	}
	docs, ok := p.Data["documents"].([]any)
	if !ok || len(docs) != 3 || docs[0] != "ID card" {
		t.Errorf("documents = %v, want the decoded list of 3", p.Data["documents"])
	}
}

// 13.
func TestBadPairValue(t *testing.T) {
	dir := aiEnv(t)
	st := newTestStoreAPI(t)
	def := defOfExample(t)
	// The amount value is not JSON text: the case drops with the
	// error of the pair.
	data := strings.Replace(entryDataPairs,
		`"value":"240000.0"`, `"value":"very much"`, 1)
	answer := fmt.Sprintf(`{"cases":[{"target_edge":"e04","data":%s,`+
		`"steps":[]}]}`, data)
	primeAI(t, dir, msgRuns(t, def, red14, 1), answer)

	rec := postGenerate(t, seedVersionID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeGenerate(t, rec)
	if len(body.Created) != 0 {
		t.Errorf("created = %v, want empty", body.Created)
	}
	want := []string{"case 1: field amount: invalid JSON value"}
	if !equalStrings(body.Errors, want) {
		t.Errorf("errors = %v, want %v", body.Errors, want)
	}
	cs, err := st.ListCases(t.Context())
	if err != nil {
		t.Fatalf("list cases: %v", err)
	}
	if len(cs) != 1 {
		t.Fatalf("ListCases = %d rows, want 1", len(cs))
	}
	events, err := st.ListEvents(t.Context(), cs[0].ID)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("case %s holds %d events, want 0", cs[0].ID, len(events))
	}
}

// 14.
func TestSchemaStrict(t *testing.T) {
	// Strict mode allows no free object: every object of the schema
	// carries additionalProperties false. The walk checks the top
	// object, each properties entry and each items entry.
	var open []string
	var walk func(path string, node map[string]any)
	walk = func(path string, node map[string]any) {
		if node["type"] == "object" && node["additionalProperties"] != false {
			open = append(open, path)
		}
		if props, ok := node["properties"].(map[string]any); ok {
			for name, p := range props {
				if pm, ok := p.(map[string]any); ok {
					walk(path+"."+name, pm)
				}
			}
		}
		if items, ok := node["items"].(map[string]any); ok {
			walk(path+"[i]", items)
		}
	}
	schema := generateTestsSchema()
	walk("schema", schema)
	if len(open) != 0 {
		t.Errorf("objects without additionalProperties false: %v", open)
	}
	// Each pair item requires both fields: the data array hangs off
	// the case object, the values array off the step object.
	caseProps := schema["properties"].(map[string]any)["cases"].(map[string]any)["items"].(map[string]any)["properties"].(map[string]any)
	stepProps := caseProps["steps"].(map[string]any)["items"].(map[string]any)["properties"].(map[string]any)
	pairs := []struct {
		field string
		items map[string]any
	}{
		{"data", caseProps["data"].(map[string]any)["items"].(map[string]any)},
		{"values", stepProps["values"].(map[string]any)["items"].(map[string]any)},
	}
	for _, p := range pairs {
		if !reflect.DeepEqual(p.items["required"], []string{"field", "value"}) {
			t.Errorf("%s items required = %v, want [field value]", p.field, p.items["required"])
		}
	}
}
