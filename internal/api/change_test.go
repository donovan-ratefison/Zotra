// The tests of the assistant chat. The rows run in the order of the
// brief. Rows 1 to 6 run in mode live against one stub server, with
// the env rules of the 2.4 rows: mode, base URL and cache dir set
// before NewHandler, so no stub answer reaches the repository cache
// and the request counts stay exact. The refusal rows run no AI
// call. The change request applies to a draft: the fixture forks the
// seeded published version.

package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/donovan-ratefison/zotra/internal/ai"
)

// changeSeedVersionID is the seeded published version of the store.
const changeSeedVersionID = "00000000-0000-0000-0000-000000000002"

// changeLiveStub starts one stub server that answers each request
// with bodies[n], the last body repeats. It records every request
// body, so the rows read the prompts. count holds the number of
// requests it saw.
func changeLiveStub(t *testing.T, bodies []string) (*httptest.Server, *int, *[]string) {
	t.Helper()
	count := 0
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		seen = append(seen, string(raw))
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
	return srv, &count, &seen
}

// changeReq builds one change request body.
func changeReq(versionID, message string) string {
	return fmt.Sprintf(`{"version_id":%q,"message":%q}`, versionID, message)
}

// chatDraft forks the seeded published version and returns the id of
// the new draft. The fork holds the seed definition.
func chatDraft(t *testing.T) string {
	t.Helper()
	rec := do(t, "POST", "/api/versions/"+changeSeedVersionID+"/fork",
		`{"label":"Chat demo"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork status = %d: %s", rec.Code, rec.Body.String())
	}
	version, ok := decode(t, rec)["version"].(map[string]any)
	if !ok {
		t.Fatalf("fork body holds no version: %s", rec.Body.String())
	}
	id, _ := version["id"].(string)
	if id == "" {
		t.Fatalf("fork body holds no version id: %s", rec.Body.String())
	}
	return id
}

// postChange posts one change request to the handler under test.
func postChange(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/ai/change-process", body, "")
}

// changeAnswer is the body of a 200 answer.
type changeAnswer struct {
	Definition json.RawMessage `json:"definition"`
	Attempts   int             `json:"attempts"`
}

// chatRequest mirrors the prompt part of one Chat Completions
// request, so the rows can read the messages.
type chatRequest struct {
	Messages []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
}

// requestMessages decodes one captured request body.
func requestMessages(t *testing.T, body string) chatRequest {
	t.Helper()
	var req chatRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatalf("captured body does not parse: %v", err)
	}
	return req
}

// checkDefinitionEqual compares the answer definition with the seed
// document, as parsed values, so the key order plays no role.
func checkDefinitionEqual(t *testing.T, definition json.RawMessage) {
	t.Helper()
	var want, have any
	if err := json.Unmarshal(seedBytes(t), &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(definition, &have); err != nil {
		t.Fatalf("answer definition does not parse: %v", err)
	}
	if !reflect.DeepEqual(want, have) {
		t.Error("definition differs from the seed document")
	}
}

// 1.
func TestChangeDraftAnswersOnce(t *testing.T) {
	srv, count, _ := changeLiveStub(t, []string{chatEnvelope(string(seedBytes(t)))})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a 12 h deadline to the legal officer."))
	checkOK(t, rec)
	var got changeAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a change answer: %v", err)
	}
	checkDefinitionEqual(t, got.Definition)
	if got.Attempts != 1 {
		t.Errorf("attempts = %d, want 1", got.Attempts)
	}
	if *count != 1 {
		t.Errorf("requests = %d, want 1", *count)
	}
}

// 2.
func TestChangeSystemHoldsFormatRules(t *testing.T) {
	srv, _, seen := changeLiveStub(t, []string{chatEnvelope(string(seedBytes(t)))})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a deadline."))
	checkOK(t, rec)
	if len(*seen) != 1 {
		t.Fatalf("captured = %d requests, want 1", len(*seen))
	}
	req := requestMessages(t, (*seen)[0])
	if len(req.Messages) < 2 {
		t.Fatalf("the request holds %d messages, want 2", len(req.Messages))
	}
	first := req.Messages[0]
	if first.Role != "system" {
		t.Errorf("first role = %q, want system", first.Role)
	}
	if !strings.Contains(first.Content, ai.ProcessFormatRules) {
		t.Error("the system message does not hold ProcessFormatRules")
	}
}

// 3.
func TestChangeRepairsOnce(t *testing.T) {
	srv, count, seen := changeLiveStub(t, []string{
		chatEnvelope(string(seedWithoutName(t))),
		chatEnvelope(string(seedBytes(t))),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a deadline."))
	checkOK(t, rec)
	var got changeAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a change answer: %v", err)
	}
	if got.Attempts != 2 {
		t.Errorf("attempts = %d, want 2", got.Attempts)
	}
	if *count != 2 {
		t.Errorf("requests = %d, want 2", *count)
	}
	second := requestMessages(t, (*seen)[1])
	if len(second.Messages) < 4 {
		t.Fatalf("the second request holds %d messages, want 4", len(second.Messages))
	}
	last := second.Messages[len(second.Messages)-1]
	if last.Role != "user" || !strings.Contains(last.Content, "The document failed validation.") {
		t.Errorf("the second request holds no repair message: role %q, content %q",
			last.Role, last.Content)
	}
}

// 4.
func TestChangeThreeFailures(t *testing.T) {
	srv, count, _ := changeLiveStub(t, []string{chatEnvelope(string(seedWithoutName(t)))})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a deadline."))
	checkError(t, rec, http.StatusUnprocessableEntity, "invalid_output", msgExplainFailed)
	details := checkDetails(t, rec)
	if len(details) == 0 {
		t.Error("details hold no error")
	}
	if *count != 3 {
		t.Errorf("requests = %d, want 3", *count)
	}
}

// 5.
func TestChangeUnknownCitationRepairs(t *testing.T) {
	srv, _, _ := changeLiveStub(t, []string{
		chatEnvelope(string(seedWithUnknownCitation(t))),
		chatEnvelope(string(seedBytes(t))),
	})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a deadline."))
	checkOK(t, rec)
	var got changeAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a change answer: %v", err)
	}
	if got.Attempts != 2 {
		t.Errorf("attempts = %d, want 2", got.Attempts)
	}
}

// 6.
func TestChangeNoContentFails(t *testing.T) {
	srv, count, _ := changeLiveStub(t, []string{`{"choices":[{"message":{}}]}`})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a deadline."))
	checkError(t, rec, http.StatusUnprocessableEntity, "invalid_output", msgExplainFailed)
	if *count != 3 {
		t.Errorf("requests = %d, want 3", *count)
	}
}

// 7.
func TestChangeAIOff(t *testing.T) {
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a deadline."))
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable",
		"The AI layer is off.")
}

// 8.
func TestChangeAIStatus500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "backend trouble", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a deadline."))
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

// 9 to 13. The refusal rows run no AI call.
func TestChangeRefusals(t *testing.T) {
	rows := []struct {
		name   string
		body   string
		status int
		code   string
		msg    string
	}{
		{"9: body does not parse", "{",
			http.StatusBadRequest, "invalid_json", msgInvalidJSON},
		{"10: message of spaces", changeReq(changeSeedVersionID, "   "),
			http.StatusBadRequest, "invalid_message", msgChangeInvalidMessage},
		{"11: message of 1001 characters",
			changeReq(changeSeedVersionID, strings.Repeat("a", 1001)),
			http.StatusBadRequest, "invalid_message", msgChangeInvalidMessage},
		{"12: unknown version",
			changeReq("00000000-0000-0000-0000-000000000009", "Add a deadline."),
			http.StatusNotFound, "not_found", "no version 00000000-0000-0000-0000-000000000009"},
		{"13: published version", changeReq(changeSeedVersionID, "Add a deadline."),
			http.StatusConflict, "conflict",
			fmt.Sprintf("version %s is not a draft", changeSeedVersionID)},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			aiRefusalEnv(t)
			newTestAPI(t)
			rec := postChange(t, row.body)
			checkError(t, rec, row.status, row.code, row.msg)
		})
	}
}

// 14.
func TestChangeDraftUnchanged(t *testing.T) {
	srv, _, _ := changeLiveStub(t, []string{chatEnvelope(string(seedBytes(t)))})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)

	rec := postChange(t, changeReq(draftID, "Add a 12 h deadline to the legal officer."))
	checkOK(t, rec)
	rec = do(t, "GET", "/api/versions/"+draftID, "", "")
	checkOK(t, rec)
	version, ok := decode(t, rec)["version"].(map[string]any)
	if !ok {
		t.Fatalf("body holds no version: %s", rec.Body.String())
	}
	definition, err := json.Marshal(version["definition"])
	if err != nil {
		t.Fatal(err)
	}
	checkDefinitionEqual(t, definition)
}

// The rows of the restate step: R1 to R8.

// postRestate posts one restate request to the handler under test.
func postRestate(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/ai/restate-change", body, "")
}

// R1.
func TestRestateAnswersTrimmed(t *testing.T) {
	srv, count, seen := changeLiveStub(t,
		[]string{chatEnvelope(`{"restatement":"  You want to add a step.  "}`)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := chatDraft(t)
	message := "Add a 12 h deadline to the legal check"

	rec := postRestate(t, changeReq(draftID, message))
	checkOK(t, rec)
	if got := decode(t, rec)["restatement"]; got != "You want to add a step." {
		t.Errorf("restatement = %q", got)
	}
	if *count != 1 {
		t.Fatalf("requests = %d, want 1", *count)
	}
	req := requestMessages(t, (*seen)[0])
	if len(req.Messages) != 2 || req.Messages[0].Content != ai.RestateChangeSystem {
		t.Error("system message is not RestateChangeSystem")
	}
	draft := do(t, "GET", "/api/versions/"+draftID, "", "")
	version, _ := decode(t, draft)["version"].(map[string]any)
	def, err := json.Marshal(version["definition"])
	if err != nil {
		t.Fatal(err)
	}
	// The store may reorder the keys, so the definitions compare as
	// parsed values.
	var have, want any
	prefix := "Current process file (JSON):\n"
	user := req.Messages[1].Content
	suffix := "\n\nChange request: " + message
	if !strings.HasPrefix(user, prefix) || !strings.HasSuffix(user, suffix) {
		t.Fatalf("user message is not ChangeProcessUser: %q", user)
	}
	if err := json.Unmarshal([]byte(strings.TrimSuffix(strings.TrimPrefix(user, prefix), suffix)), &have); err != nil {
		t.Fatalf("user message definition does not parse: %v", err)
	}
	_ = json.Unmarshal(def, &want)
	if !reflect.DeepEqual(have, want) {
		t.Error("user message definition differs from the draft definition")
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
	if format.ResponseFormat.JSONSchema.Name != "restatement" {
		t.Errorf("schema name = %q, want restatement", format.ResponseFormat.JSONSchema.Name)
	}
}

// R2 to R4: one AI call, then 422.
func TestRestateInvalidOutput(t *testing.T) {
	rows := []struct{ name, body string }{
		{"R2: blank restatement", chatEnvelope(`{"restatement":"   "}`)},
		{"R3: not json", chatEnvelope("not json")},
		{"R4: no choices", `{"choices":[]}`},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			srv, count, _ := changeLiveStub(t, []string{row.body})
			aiLive(t, srv.URL)
			newTestAPI(t)
			draftID := chatDraft(t)
			rec := postRestate(t, changeReq(draftID, "Add a deadline."))
			checkError(t, rec, http.StatusUnprocessableEntity, "invalid_output", msgNoContent)
			if *count != 1 {
				t.Errorf("requests = %d, want 1", *count)
			}
		})
	}
}

// R5.
func TestRestateAIOff(t *testing.T) {
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	newTestAPI(t)
	draftID := chatDraft(t)
	rec := postRestate(t, changeReq(draftID, "Add a deadline."))
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable",
		"The AI layer is off.")
}

// R6 to R8: the shared checks, no AI call.
func TestRestateRefusals(t *testing.T) {
	rows := []struct {
		name   string
		body   string
		status int
		code   string
		msg    string
	}{
		{"R6: body does not parse", "{",
			http.StatusBadRequest, "invalid_json", msgInvalidJSON},
		{"R7: empty message", changeReq(changeSeedVersionID, ""),
			http.StatusBadRequest, "invalid_message", msgChangeInvalidMessage},
		{"R7: message of 1001 characters",
			changeReq(changeSeedVersionID, strings.Repeat("a", 1001)),
			http.StatusBadRequest, "invalid_message", msgChangeInvalidMessage},
		{"R8: unknown version",
			changeReq("00000000-0000-0000-0000-000000000009", "Add a deadline."),
			http.StatusNotFound, "not_found", "no version 00000000-0000-0000-0000-000000000009"},
		{"R8: published version", changeReq(changeSeedVersionID, "Add a deadline."),
			http.StatusConflict, "conflict",
			fmt.Sprintf("version %s is not a draft", changeSeedVersionID)},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			aiRefusalEnv(t)
			newTestAPI(t)
			checkError(t, postRestate(t, row.body), row.status, row.code, row.msg)
		})
	}
}

// sourcesOf returns the parsed sources value of a definition.
func sourcesOf(t *testing.T, definition []byte) any {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal(definition, &doc); err != nil {
		t.Fatalf("definition does not parse: %v", err)
	}
	return doc["sources"]
}

// postChangeOnce posts one change on the draft, expects 200 after one
// attempt and one request, and returns the answer definition.
func postChangeOnce(t *testing.T, draftID string, count *int) json.RawMessage {
	t.Helper()
	rec := postChange(t, changeReq(draftID, "Add a 12 h deadline to the advisor."))
	checkOK(t, rec)
	var got changeAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a change answer: %v", err)
	}
	if got.Attempts != 1 || *count != 1 {
		t.Errorf("attempts = %d, requests = %d, want 1 and 1", got.Attempts, *count)
	}
	return got.Definition
}

// C1: the AI answers an empty sources array; the answer keeps the
// sources of the draft.
func TestChangeKeepsSources(t *testing.T) {
	draft := sourcesDoc(t, oneSource)
	answer := sourcesDoc(t, func(doc map[string]any) {
		oneSource(doc)
		doc["sources"] = []any{}
	})
	srv, count, _ := changeLiveStub(t, []string{chatEnvelope(string(answer))})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := createProcessVersion(t, draft, "Sources")

	definition := postChangeOnce(t, draftID, count)
	if got, want := sourcesOf(t, definition), sourcesOf(t, draft); !reflect.DeepEqual(got, want) {
		t.Errorf("sources = %v, want %v", got, want)
	}
}

// C2: a draft stored with no sources key; the AI sources array stays.
func TestChangeDraftWithoutSources(t *testing.T) {
	var doc map[string]any
	if err := json.Unmarshal(seedBytes(t), &doc); err != nil {
		t.Fatal(err)
	}
	delete(doc, "sources")
	draft, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	srv, count, _ := changeLiveStub(t, []string{chatEnvelope(string(seedBytes(t)))})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := createProcessVersion(t, draft, "No sources")

	definition := postChangeOnce(t, draftID, count)
	if got, want := sourcesOf(t, definition), sourcesOf(t, seedBytes(t)); !reflect.DeepEqual(got, want) {
		t.Errorf("sources = %v, want %v", got, want)
	}
}
