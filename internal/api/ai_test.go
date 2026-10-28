// The tests of the policy import. Rows 1 to 6 run in mode live
// against one stub server: the environment is set before NewHandler,
// and the cache dir is one fresh temp dir, so no stub answer reaches
// the repository cache and the request counts stay exact. Row 7 runs
// in mode off. Rows 9 to 15 are the refusals: no AI call happens.

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
)

// aiLive sets the AI environment of the stub rows: mode live, base
// URL of the stub, one fresh cache dir. Call it before newTestAPI.
func aiLive(t *testing.T, url string) {
	t.Helper()
	t.Setenv("ZOTRA_AI_MODE", "live")
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
		chatEnvelope(string(seedWithoutName(t))),
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
	srv, count := aiLiveStub(t, []string{chatEnvelope(string(seedWithoutName(t)))})
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
