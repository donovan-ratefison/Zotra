// The tests of the policy import. Rows 1 to 6 run in mode live
// against one stub server: the environment is set before NewHandler,
// and the cache dir is one fresh temp dir, so no stub answer reaches
// the repository cache and the request counts stay exact. Row 7 runs
// in mode off. Rows 9 to 15 are the refusals: no AI call happens.
// Rows K1 to K3 run in mode cache, with one fresh cache dir.

package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"cel.dev/cel-go/cel"

	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/rules"
)

// aiLive sets the AI environment of the stub rows: mode live, base
// URL of the stub, one fresh cache dir. Call it before newTestAPI.
func aiLive(t *testing.T, url string) {
	t.Helper()
	t.Setenv("ZOTRA_AI_MODE", "live")
	t.Setenv("ZOTRA_AI_API_KEY", "test-key")
	t.Setenv("ZOTRA_AI_BASE_URL", url)
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
}

// aiLiveStub starts one stub server that answers each request with
// bodies[n], the last body repeats. count holds the number of
// requests it saw. Each body is a full Chat Completions envelope.
func aiLiveStub(t *testing.T, bodies []string) (*httptest.Server, *int) {
	t.Helper()
	count := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := count
		count++
		body := bodies[len(bodies)-1]
		if n < len(bodies) {
			body = bodies[n]
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, &count
}

// chatEnvelope builds one Chat Completions answer with content in
// choices[0].message.content.
func chatEnvelope(content string) string {
	return fmt.Sprintf(`{"choices":[{"message":{"content":%q}}]}`, content)
}

// aiRefusalEnv gives the 400 rows a fresh cache dir. No AI call
// happens on a 400 path, so no stub is needed.
func aiRefusalEnv(t *testing.T) {
	t.Helper()
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
}

// policyReqPara is one paragraph of a request fixture.
type policyReqPara struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// policyRequestBody builds one import request body.
func policyRequestBody(name string, paras []policyReqPara) string {
	body := struct {
		Name       string          `json:"name"`
		Paragraphs []policyReqPara `json:"paragraphs"`
	}{Name: name, Paragraphs: paras}
	b, err := json.Marshal(body)
	if err != nil {
		panic(fmt.Sprintf("marshal request: %v", err))
	}
	return string(b)
}

// fixtureParagraphs are the request paragraphs of rows 1 to 8. No id
// is p9-9.
func fixtureParagraphs() []policyReqPara {
	return []policyReqPara{
		{ID: "p1-1", Text: "The advisor collects the file."},
		{ID: "p1-2", Text: "The analyst studies the file."},
		{ID: "p2-1", Text: "The director decides."},
	}
}

// fixtureRequest is the request body of rows 1 to 8.
func fixtureRequest() string {
	return policyRequestBody("Home loan", fixtureParagraphs())
}

// seedBytes returns the seed definition, a valid document.
func seedBytes(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../store/seed/example-process.json")
	if err != nil {
		t.Fatalf("read seed: %v", err)
	}
	return b
}

// seedVariant returns the seed definition with one change.
func seedVariant(t *testing.T, change func(doc map[string]any)) []byte {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal(seedBytes(t), &doc); err != nil {
		t.Fatalf("unmarshal seed: %v", err)
	}
	change(doc)
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal seed: %v", err)
	}
	return b
}

// seedWithoutName drops the name: the schema refuses the result.
func seedWithoutName(t *testing.T) []byte {
	t.Helper()
	return seedVariant(t, func(doc map[string]any) { delete(doc, "name") })
}

// seedWithoutCurrency drops the currency: the schema refuses the
// result. The server sets the name, so a missing name is no failure.
func seedWithoutCurrency(t *testing.T) []byte {
	t.Helper()
	return seedVariant(t, func(doc map[string]any) { delete(doc, "currency") })
}

// seedWithUnknownCitation adds p9-9, an id the request does not
// carry, to the citations of the first node.
func seedWithUnknownCitation(t *testing.T) []byte {
	t.Helper()
	return seedVariant(t, func(doc map[string]any) {
		nodes, ok := doc["nodes"].([]any)
		if !ok || len(nodes) == 0 {
			t.Fatal("seed has no nodes")
		}
		node, ok := nodes[0].(map[string]any)
		if !ok {
			t.Fatal("first node is not an object")
		}
		node["citations"] = append(node["citations"].([]any), "p9-9")
	})
}

// postPolicy posts one import request to the handler under test.
func postPolicy(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/ai/policy-to-process", body, "")
}

// checkOK asserts a 200 answer.
func checkOK(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

// policyAnswer is the body of a 200 answer.
type policyAnswer struct {
	Definition json.RawMessage `json:"definition"`
	Attempts   int             `json:"attempts"`
}

// checkDetails decodes the details of one error body.
func checkDetails(t *testing.T, rec *httptest.ResponseRecorder) []map[string]string {
	t.Helper()
	var body struct {
		Error struct {
			Details []map[string]string `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not an error body: %v: %q", err, rec.Body.String())
	}
	return body.Error.Details
}

// 1.
func TestPolicySeedFirstTry(t *testing.T) {
	srv, count := aiLiveStub(t, []string{chatEnvelope(string(seedBytes(t)))})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	checkOK(t, rec)
	var got policyAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a policy answer: %v", err)
	}
	var want, have any
	if err := json.Unmarshal(seedBytes(t), &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(got.Definition, &have); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(want, have) {
		t.Error("definition differs from the seed document")
	}
	if got.Attempts != 1 {
		t.Errorf("attempts = %d, want 1", got.Attempts)
	}
	if *count != 1 {
		t.Errorf("requests = %d, want 1", *count)
	}
}

// 2.
func TestPolicyRepairsOnce(t *testing.T) {
	srv, count := aiLiveStub(t, []string{
		chatEnvelope(string(seedWithoutCurrency(t))),
		chatEnvelope(string(seedBytes(t))),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	checkOK(t, rec)
	var got policyAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a policy answer: %v", err)
	}
	if got.Attempts != 2 {
		t.Errorf("attempts = %d, want 2", got.Attempts)
	}
	if *count != 2 {
		t.Errorf("requests = %d, want 2", *count)
	}
}

// 3.
func TestPolicyThreeFailures(t *testing.T) {
	srv, count := aiLiveStub(t, []string{chatEnvelope(string(seedWithoutCurrency(t)))})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	checkError(t, rec, http.StatusUnprocessableEntity, "invalid_output",
		"The AI output did not pass validation after 3 attempts.")
	details := checkDetails(t, rec)
	if len(details) == 0 {
		t.Error("details hold no error")
	}
	for _, d := range details {
		if d["message"] == "" {
			t.Errorf("detail misses the message: %v", d)
		}
	}
	if *count != 3 {
		t.Errorf("requests = %d, want 3", *count)
	}
}

// 4.
func TestPolicyUnknownCitationRepairs(t *testing.T) {
	srv, _ := aiLiveStub(t, []string{
		chatEnvelope(string(seedWithUnknownCitation(t))),
		chatEnvelope(string(seedBytes(t))),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	checkOK(t, rec)
	var got policyAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a policy answer: %v", err)
	}
	if got.Attempts != 2 {
		t.Errorf("attempts = %d, want 2", got.Attempts)
	}
}

// 5.
func TestPolicyUnknownCitationFails(t *testing.T) {
	srv, _ := aiLiveStub(t, []string{chatEnvelope(string(seedWithUnknownCitation(t)))})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	checkError(t, rec, http.StatusUnprocessableEntity, "invalid_output",
		"The AI output did not pass validation after 3 attempts.")
	details := checkDetails(t, rec)
	found := false
	for _, d := range details {
		if d["message"] == "cited paragraph id p9-9 does not exist" {
			found = true
		}
	}
	if !found {
		t.Errorf("details hold no unknown-citation error: %v", details)
	}
}

// 6.
func TestPolicyAnswerWithoutContent(t *testing.T) {
	srv, _ := aiLiveStub(t, []string{
		`{"choices":[{"message":{}}]}`,
		chatEnvelope(string(seedBytes(t))),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	checkOK(t, rec)
	var got policyAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a policy answer: %v", err)
	}
	if got.Attempts != 2 {
		t.Errorf("attempts = %d, want 2", got.Attempts)
	}
}

// 7.
func TestPolicyAIOff(t *testing.T) {
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable",
		"The AI layer is off.")
}

// 8.
func TestPolicyAIStatus500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "backend trouble", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "ai_unavailable" {
		t.Errorf("code = %q, want ai_unavailable", body.Error.Code)
	}
	if body.Error.Message == "" {
		t.Error("message is empty")
	}
}

// 9 to 15.
func TestPolicyRefusals(t *testing.T) {
	longName := strings.Repeat("a", 101)
	many := make([]policyReqPara, 501)
	for i := range many {
		many[i] = policyReqPara{ID: fmt.Sprintf("p1-%d", i+1), Text: "text"}
	}
	rows := []struct {
		name string
		body string
		code string
		msg  string
	}{
		{"9: body does not parse", "{", "invalid_json", msgInvalidJSON},
		{"10: empty body", "{}", "invalid_name", "name is required"},
		{"11: name of 101 characters", policyRequestBody(longName, fixtureParagraphs()),
			"invalid_name", "name is required"},
		{"12: id p1-0", policyRequestBody("Home loan", []policyReqPara{
			{ID: "p1-0", Text: "text"}}), "invalid_paragraphs", msgInvalidParagraphs},
		{"13: duplicate id", policyRequestBody("Home loan", []policyReqPara{
			{ID: "p1-1", Text: "text"}, {ID: "p1-1", Text: "text"}}),
			"invalid_paragraphs", msgInvalidParagraphs},
		{"14: empty text", policyRequestBody("Home loan", []policyReqPara{
			{ID: "p1-1", Text: ""}}), "invalid_paragraphs", msgInvalidParagraphs},
		{"15: 501 paragraphs", policyRequestBody("Home loan", many),
			"invalid_paragraphs", msgInvalidParagraphs},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			aiRefusalEnv(t)
			newTestAPI(t)
			rec := postPolicy(t, row.body)
			checkError(t, rec, http.StatusBadRequest, row.code, row.msg)
		})
	}
}

// The tests of the check explanation. The rows run in the order of
// the brief. Rows 1 to 4 and 11 to 12 run in mode live against one
// stub server, with the env rules of the 2.4 rows: mode, base URL and
// cache dir set before NewHandler, so no stub answer reaches the
// repository cache and the request counts stay exact. Rows 5 to 10
// are the refusals: no AI call happens on their paths. The fixture
// chains run the real fork, case, start and submit on the seed.

// explainValidExpr is the proposal expression of the answer fixture.
const explainValidExpr = "duration_months <= 360"

// explainFixtureExplanation and its two companions are the answer
// fixture values of the brief.
const explainFixtureExplanation = "The duration of 400 months passes the ceiling of 300 months."
const explainFixtureMessage = "The duration must stay at or under 360 months."
const explainFixturePlainText = "The loan duration stays at or under 360 months."

// explainContent builds the Chat Completions content of one answer:
// the fixture of the brief, the expression as parameter. The broken
// variants change the expression only.
func explainContent(expression string) string {
	return fmt.Sprintf(`{"explanation":%q,"proposal":{"expression":%q,`+
		`"message":%q,"plain_text":%q}}`, explainFixtureExplanation,
		expression, explainFixtureMessage, explainFixturePlainText)
}

// explainBodyJSON builds one explain request body.
func explainBodyJSON(caseID, nodeID, checkID string) string {
	return fmt.Sprintf(`{"case_id":%q,"node_id":%q,"check_id":%q}`,
		caseID, nodeID, checkID)
}

// postExplain posts one explain request to the handler under test.
func postExplain(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/ai/explain-check", body, "")
}

// explainFixture forks the seed version (the fork of the 2.3
// criterion 7), creates a test case on the fork, starts it with
// startData and submits the step. It checks each status and returns
// the case id. The base start data leaves the case on entry with one
// false check_evaluated for entry-amount; the passing start data
// stores a true event and the default edge returns the case to entry.
func explainFixture(t *testing.T, startData string) string {
	t.Helper()
	rec := do(t, "POST",
		"/api/versions/00000000-0000-0000-0000-000000000002/fork",
		`{"label":"Fix demo"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork status = %d: %s", rec.Code, rec.Body.String())
	}
	version, ok := decode(t, rec)["version"].(map[string]any)
	if !ok {
		t.Fatalf("fork body holds no version: %s", rec.Body.String())
	}
	forkID, ok := version["id"].(string)
	if !ok {
		t.Fatalf("fork body holds no version id: %s", rec.Body.String())
	}
	rec = do(t, "POST", "/api/cases",
		fmt.Sprintf(`{"version_id":%q,"is_test":true}`, forkID), "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("case status = %d: %s", rec.Code, rec.Body.String())
	}
	caseRow, ok := decode(t, rec)["case"].(map[string]any)
	if !ok {
		t.Fatalf("case body holds no case: %s", rec.Body.String())
	}
	caseID, ok := caseRow["id"].(string)
	if !ok {
		t.Fatalf("case body holds no case id: %s", rec.Body.String())
	}
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		fmt.Sprintf(`{"type":"start","data":%s}`, startData), "u-advisor")
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d: %s", rec.Code, rec.Body.String())
	}
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"submit","values":{}}`, "u-advisor")
	if rec.Code != http.StatusOK {
		t.Fatalf("submit status = %d: %s", rec.Code, rec.Body.String())
	}
	return caseID
}

// explainCompileError returns the exact compile error text of the
// expression over the seed fields. The scratch run of the lot
// verified the texts: "amount > " gives a syntax error, "" gives the
// same shape at 1:0, "amount" gives "result is double, want bool".
func explainCompileError(t *testing.T, expression string) string {
	t.Helper()
	def, err := process.Decode(seedBytes(t))
	if err != nil {
		t.Fatalf("decode seed: %v", err)
	}
	env, err := rules.NewEnv(def.Fields, nil)
	if err != nil {
		t.Fatalf("new env: %v", err)
	}
	if _, err := env.Compile(expression, cel.BoolType); err == nil {
		t.Fatalf("expression %q compiles, want an error", expression)
	} else {
		return err.Error()
	}
	return ""
}

// explainAnswerOf decodes one 200 answer.
func explainAnswerOf(t *testing.T, rec *httptest.ResponseRecorder) explainAnswer {
	t.Helper()
	var got explainAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not an explain answer: %v: %q", err, rec.Body.String())
	}
	return got
}

// 1.
func TestExplainOK(t *testing.T) {
	srv, count := aiLiveStub(t, []string{chatEnvelope(explainContent(explainValidExpr))})
	aiLive(t, srv.URL)
	newTestAPI(t)

	caseID := explainFixture(t, `{"amount":1,"duration_months":400}`)
	rec := postExplain(t, explainBodyJSON(caseID, "entry", "entry-amount"))
	checkOK(t, rec)
	got := explainAnswerOf(t, rec)
	want := explainAnswer{
		Explanation: explainFixtureExplanation,
		Proposal: explainProposal{
			Expression: explainValidExpr,
			Message:    explainFixtureMessage,
			PlainText:  explainFixturePlainText,
		},
	}
	if got != want {
		t.Errorf("answer = %+v, want %+v", got, want)
	}
	if *count != 1 {
		t.Errorf("requests = %d, want 1", *count)
	}
}

// 2.
func TestExplainRepairsOnce(t *testing.T) {
	srv, count := aiLiveStub(t, []string{
		chatEnvelope(explainContent("amount > ")),
		chatEnvelope(explainContent(explainValidExpr)),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)

	caseID := explainFixture(t, `{"amount":1,"duration_months":400}`)
	rec := postExplain(t, explainBodyJSON(caseID, "entry", "entry-amount"))
	checkOK(t, rec)
	explainAnswerOf(t, rec)
	if *count != 2 {
		t.Errorf("requests = %d, want 2", *count)
	}
}

// 3.
func TestExplainThreeFailures(t *testing.T) {
	srv, count := aiLiveStub(t, []string{chatEnvelope(explainContent("amount > "))})
	aiLive(t, srv.URL)
	newTestAPI(t)

	caseID := explainFixture(t, `{"amount":1,"duration_months":400}`)
	rec := postExplain(t, explainBodyJSON(caseID, "entry", "entry-amount"))
	checkError(t, rec, http.StatusUnprocessableEntity, "invalid_output", msgExplainFailed)
	details := checkDetails(t, rec)
	if len(details) != 1 {
		t.Fatalf("details = %d, want 1: %v", len(details), details)
	}
	if details[0]["path"] != "" {
		t.Errorf("path = %q, want empty", details[0]["path"])
	}
	if details[0]["message"] != explainCompileError(t, "amount > ") {
		t.Errorf("message = %q, want the compile error text", details[0]["message"])
	}
	if *count != 3 {
		t.Errorf("requests = %d, want 3", *count)
	}
}

// 4.
func TestExplainAIOff(t *testing.T) {
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	newTestAPI(t)

	caseID := explainFixture(t, `{"amount":1,"duration_months":400}`)
	rec := postExplain(t, explainBodyJSON(caseID, "entry", "entry-amount"))
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable",
		"The AI layer is off.")
}

// 5 to 10.
func TestExplainRefusals(t *testing.T) {
	baseStart := `{"amount":1,"duration_months":400}`
	passStart := `{"amount":1,"duration_months":100,"documents":[]}`
	rows := []struct {
		name    string
		chain   bool
		start   string
		body    func(caseID string) string
		status  int
		errCode string
		msg     string
	}{
		{"5: empty body", false, "",
			func(string) string { return "{}" },
			http.StatusBadRequest, "invalid_request", msgMissingFields},
		{"6: body without }", false, "",
			func(string) string { return `{"case_id":"c1","node_id":"entry"` },
			http.StatusBadRequest, "invalid_json", msgInvalidJSON},
		{"7: unknown case", false, "",
			func(string) string { return explainBodyJSON("nope", "entry", "entry-amount") },
			http.StatusNotFound, "not_found", "no case nope"},
		{"8: the case is not on this step", true, baseStart,
			func(caseID string) string { return explainBodyJSON(caseID, "analysis", "entry-amount") },
			http.StatusConflict, "conflict", "the case is not on this step"},
		{"9: the step has no check", true, baseStart,
			func(caseID string) string { return explainBodyJSON(caseID, "entry", "release-date") },
			http.StatusConflict, "conflict", "the step has no check release-date"},
		{"10: the check did not fail", true, passStart,
			func(caseID string) string { return explainBodyJSON(caseID, "entry", "entry-amount") },
			http.StatusConflict, "conflict", "the check did not fail"},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			aiRefusalEnv(t)
			newTestAPI(t)
			caseID := "c1"
			if row.chain {
				caseID = explainFixture(t, row.start)
			}
			rec := postExplain(t, row.body(caseID))
			checkError(t, rec, row.status, row.errCode, row.msg)
		})
	}
}

// 11.
func TestExplainEmptyExpression(t *testing.T) {
	srv, count := aiLiveStub(t, []string{
		chatEnvelope(explainContent("")),
		chatEnvelope(explainContent(explainValidExpr)),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)

	caseID := explainFixture(t, `{"amount":1,"duration_months":400}`)
	rec := postExplain(t, explainBodyJSON(caseID, "entry", "entry-amount"))
	checkOK(t, rec)
	explainAnswerOf(t, rec)
	if *count != 2 {
		t.Errorf("requests = %d, want 2", *count)
	}
}

// 12.
func TestExplainNonBoolExpression(t *testing.T) {
	srv, count := aiLiveStub(t, []string{
		chatEnvelope(explainContent("amount")),
		chatEnvelope(explainContent(explainValidExpr)),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)

	caseID := explainFixture(t, `{"amount":1,"duration_months":400}`)
	rec := postExplain(t, explainBodyJSON(caseID, "entry", "entry-amount"))
	checkOK(t, rec)
	explainAnswerOf(t, rec)
	if *count != 2 {
		t.Errorf("requests = %d, want 2", *count)
	}
}

// seedWithReason returns the seed definition with the key
// not_a_policy_reason set to value.
func seedWithReason(t *testing.T, value any) []byte {
	t.Helper()
	return seedVariant(t, func(doc map[string]any) { doc["not_a_policy_reason"] = value })
}

// checkSeedAnswer asserts a 200 answer, 1 attempt, and a definition
// equal to the seed (so with no not_a_policy_reason key).
func checkSeedAnswer(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	checkOK(t, rec)
	var got policyAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a policy answer: %v", err)
	}
	var want, have any
	if err := json.Unmarshal(seedBytes(t), &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(got.Definition, &have); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(want, have) {
		t.Errorf("definition differs from the seed document: %s", got.Definition)
	}
	if got.Attempts != 1 {
		t.Errorf("attempts = %d, want 1", got.Attempts)
	}
}

// N1, N3, N4: a null, blank or non-string reason is no reason.
func TestPolicyReasonIgnored(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value any
	}{{"N1 null", nil}, {"N3 blank", "   "}, {"N4 number", 5}} {
		t.Run(tc.name, func(t *testing.T) {
			srv, count := aiLiveStub(t, []string{chatEnvelope(string(seedWithReason(t, tc.value)))})
			aiLive(t, srv.URL)
			newTestAPI(t)

			checkSeedAnswer(t, postPolicy(t, fixtureRequest()))
			if *count != 1 {
				t.Errorf("requests = %d, want 1", *count)
			}
		})
	}
}

// N2: a reason answers 422 not_a_policy at once, with no validation.
func TestPolicyNotAPolicy(t *testing.T) {
	srv, count := aiLiveStub(t, []string{
		chatEnvelope(`{"name":"X","not_a_policy_reason":"The text is a cooking recipe."}`),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postPolicy(t, fixtureRequest())
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Details []any  `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not an error body: %v", err)
	}
	if body.Error.Code != "not_a_policy" {
		t.Errorf("code = %q, want not_a_policy", body.Error.Code)
	}
	want := "This file is not a credit policy. The text is a cooking recipe."
	if body.Error.Message != want {
		t.Errorf("message = %q, want %q", body.Error.Message, want)
	}
	if len(body.Error.Details) != 0 {
		t.Errorf("details = %v, want none", body.Error.Details)
	}
	if *count != 1 {
		t.Errorf("requests = %d, want 1", *count)
	}
}

// N5, N6: the request schema has not_a_policy_reason, and the shared
// process schema does not change.
func TestPolicySchemaReason(t *testing.T) {
	before, err := json.Marshal(process.JSONSchema())
	if err != nil {
		t.Fatal(err)
	}
	var reqBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		reqBody = b
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(chatEnvelope(string(seedBytes(t)))))
	}))
	t.Cleanup(srv.Close)
	aiLive(t, srv.URL)
	newTestAPI(t)

	checkOK(t, postPolicy(t, fixtureRequest()))

	var sent struct {
		ResponseFormat struct {
			JSONSchema struct {
				Schema struct {
					Properties map[string]struct {
						Type any `json:"type"`
					} `json:"properties"`
					Required []string `json:"required"`
				} `json:"schema"`
			} `json:"json_schema"`
		} `json:"response_format"`
	}
	if err := json.Unmarshal(reqBody, &sent); err != nil {
		t.Fatalf("request body: %v: %s", err, reqBody)
	}
	schema := sent.ResponseFormat.JSONSchema.Schema
	prop, found := schema.Properties["not_a_policy_reason"]
	if !found || !reflect.DeepEqual(prop.Type, []any{"string", "null"}) {
		t.Errorf("not_a_policy_reason type = %v, want [string null]", prop.Type)
	}
	if !slices.Contains(schema.Required, "not_a_policy_reason") {
		t.Errorf("required = %v, want not_a_policy_reason in it", schema.Required)
	}
	after, err := json.Marshal(process.JSONSchema())
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Error("the shared process schema changed")
	}
	if _, found := process.JSONSchema()["properties"].(map[string]any)["not_a_policy_reason"]; found {
		t.Error("the shared process schema has not_a_policy_reason")
	}
}

// N7: splitReason rows.
func TestPolicySplitReason(t *testing.T) {
	for _, tc := range []struct{ in, reason, rest string }{
		{`[1]`, "", `[1]`},
		{`null`, "", `null`},
		{`{"a":1}`, "", `{"a":1}`},
		{`{ "a" : 1 }`, "", `{ "a" : 1 }`},
		{`{"a":1,"not_a_policy_reason":"x"}`, "x", `{"a":1}`},
	} {
		reason, rest := splitReason(tc.in)
		if reason != tc.reason || rest != tc.rest {
			t.Errorf("splitReason(%q) = (%q, %q), want (%q, %q)",
				tc.in, reason, rest, tc.reason, tc.rest)
		}
	}
}

// aiCacheStub starts one stub server in mode cache, with one fresh
// cache dir. It answers the seed to each request, and records the
// number of requests and the last request body.
func aiCacheStub(t *testing.T) (count *int, last *string) {
	t.Helper()
	count, last = new(int), new(string)
	seed := chatEnvelope(string(seedBytes(t)))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		*count++
		*last = string(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(seed))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("ZOTRA_AI_MODE", "cache")
	t.Setenv("ZOTRA_AI_API_KEY", "test-key")
	t.Setenv("ZOTRA_AI_BASE_URL", srv.URL)
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	return count, last
}

// definitionName returns definition.name of one 200 answer.
func definitionName(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	checkOK(t, rec)
	var got struct {
		Definition struct {
			Name string `json:"name"`
		} `json:"definition"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a policy answer: %v", err)
	}
	return got.Definition.Name
}

// K1: the same paragraphs with another name hit the cache.
func TestPolicyCacheOtherName(t *testing.T) {
	count, _ := aiCacheStub(t)
	newTestAPI(t)

	if got := definitionName(t, postPolicy(t, fixtureRequest())); got != "Home loan" {
		t.Errorf("first name = %q, want %q", got, "Home loan")
	}
	rec := postPolicy(t, policyRequestBody("Home loan v2", fixtureParagraphs()))
	if got := definitionName(t, rec); got != "Home loan v2" {
		t.Errorf("second name = %q, want %q", got, "Home loan v2")
	}
	if *count != 1 {
		t.Errorf("requests = %d, want 1", *count)
	}
}

// K2: other paragraphs still call the AI.
func TestPolicyCacheOtherParagraphs(t *testing.T) {
	count, _ := aiCacheStub(t)
	newTestAPI(t)

	checkOK(t, postPolicy(t, fixtureRequest()))
	paras := append(fixtureParagraphs(), policyReqPara{ID: "p3-1", Text: "The bank pays."})
	checkOK(t, postPolicy(t, policyRequestBody("Home loan v2", paras)))
	if *count != 2 {
		t.Errorf("requests = %d, want 2", *count)
	}
}

// K3: the process name is not in the AI request.
func TestPolicyNameNotInRequest(t *testing.T) {
	_, last := aiCacheStub(t)
	newTestAPI(t)

	checkOK(t, postPolicy(t, policyRequestBody("Secret name", fixtureParagraphs())))
	if *last == "" {
		t.Fatal("the stub saw no request")
	}
	if strings.Contains(*last, "Secret name") {
		t.Errorf("request body holds the name: %s", *last)
	}
}

// K4: withName rows.
func TestPolicyWithName(t *testing.T) {
	for _, in := range []string{`[1]`, `null`} {
		if got := withName(in, "B"); got != in {
			t.Errorf("withName(%q) = %q, want it unchanged", in, got)
		}
	}
	var have map[string]any
	if err := json.Unmarshal([]byte(withName(`{"name":"A","x":1}`, "B")), &have); err != nil {
		t.Fatal(err)
	}
	if want := map[string]any{"name": "B", "x": 1.0}; !reflect.DeepEqual(have, want) {
		t.Errorf("withName = %v, want %v", have, want)
	}
}

// errorStub starts one stub server that answers each request with
// status 401 and an OpenAI-compatible error body. count holds the
// number of requests it saw.
func errorStub(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	count := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		count++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid key"}}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &count
}

// checkUnavailable asserts a 503 ai_unavailable answer whose message
// holds each part.
func checkUnavailable(t *testing.T, rec *httptest.ResponseRecorder, parts ...string) {
	t.Helper()
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not an error body: %v", err)
	}
	if body.Error.Code != "ai_unavailable" {
		t.Errorf("code = %q, want ai_unavailable", body.Error.Code)
	}
	for _, p := range parts {
		if !strings.Contains(body.Error.Message, p) {
			t.Errorf("message %q does not hold %q", body.Error.Message, p)
		}
	}
}

// Row 9: a 401 of the provider gives 503 with no repair loop.
func TestChangeProvider401(t *testing.T) {
	srv, count := errorStub(t)
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a 12 h deadline to the legal officer."))
	checkUnavailable(t, rec, "status 401", "invalid key")
	if *count != 1 {
		t.Errorf("requests = %d, want 1", *count)
	}
}

// Row 10: mode cache with no key makes no call and gives 503.
func TestChangeNoAPIKey(t *testing.T) {
	srv, count := errorStub(t)
	t.Setenv("ZOTRA_AI_MODE", "cache")
	t.Setenv("ZOTRA_AI_API_KEY", "")
	t.Setenv("ZOTRA_AI_BASE_URL", srv.URL)
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a 12 h deadline to the legal officer."))
	checkUnavailable(t, rec, "no API key")
	if *count != 0 {
		t.Errorf("requests = %d, want 0", *count)
	}
}

// Row 11: a 401 of the provider gives 503 on the policy import.
func TestPolicyProvider401(t *testing.T) {
	srv, count := errorStub(t)
	aiLive(t, srv.URL)
	newTestAPI(t)

	checkUnavailable(t, postPolicy(t, fixtureRequest()), "status 401", "invalid key")
	if *count != 1 {
		t.Errorf("requests = %d, want 1", *count)
	}
}
