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
	"github.com/donovan-ratefison/zotra/internal/process"
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
		{"11: message of 2001 characters",
			changeReq(changeSeedVersionID, strings.Repeat("a", 2001)),
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
		{"R7: message of 2001 characters",
			changeReq(changeSeedVersionID, strings.Repeat("a", 2001)),
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

// The rows of the clarifying questions: G1 to G14.

// restateAnswer is the body of a 200 restate answer.
type restateAnswer struct {
	Restatement string            `json:"restatement"`
	Questions   []restateQuestion `json:"questions"`
}

// postRestateLive posts one restate request on a new draft, with a
// stub that gives content, and decodes the 200 answer.
func postRestateLive(t *testing.T, content string) restateAnswer {
	t.Helper()
	srv, _, _ := changeLiveStub(t, []string{chatEnvelope(content)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	rec := postRestate(t, changeReq(chatDraft(t), "Add a validation step."))
	checkOK(t, rec)
	var got restateAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a restate answer: %v", err)
	}
	return got
}

// G1.
func TestRestateNoQuestions(t *testing.T) {
	got := postRestateLive(t, `{"restatement":"You want to X.","questions":[]}`)
	if got.Restatement != "You want to X." || got.Questions == nil || len(got.Questions) != 0 {
		t.Errorf("answer = %+v, want questions []", got)
	}
}

// G2.
func TestRestateQuestionKept(t *testing.T) {
	got := postRestateLive(t, `{"restatement":"You want to X.","questions":[`+
		`{"id":"who","text":"Who validates?","kind":"single","other":false,"options":[`+
		`{"label":"Legal officer","ref":"role:legal","default":true,"reason":"four-eyes rule"},`+
		`{"label":"Analyst","ref":"role:analyst","default":false,"reason":""}]}]}`)
	want := []restateQuestion{{ID: "who", Text: "Who validates?", Kind: "single", Options: []restateOption{
		{Label: "Legal officer", Ref: "role:legal", Default: true, Reason: "four-eyes rule"},
		{Label: "Analyst", Ref: "role:analyst"},
	}}}
	if !reflect.DeepEqual(got.Questions, want) {
		t.Errorf("questions = %+v", got.Questions)
	}
}

// seedDef decodes the seed definition: roles advisor, analyst,
// director, legal, backoffice; document "Loan offer"; fields amount
// and client_name.
func seedDef(t *testing.T) process.Definition {
	t.Helper()
	def, err := process.Decode(seedBytes(t))
	if err != nil {
		t.Fatal(err)
	}
	return def
}

// opt builds one option with the label of its ref.
func opt(ref string, def bool, reason string) restateOption {
	return restateOption{Label: ref, Ref: ref, Default: def, Reason: reason}
}

// question builds one valid question.
func question(id, kind string, options ...restateOption) restateQuestion {
	return restateQuestion{ID: id, Text: "Question " + id, Kind: kind, Options: options}
}

// refsOf returns the refs of the options of q.
func refsOf(q restateQuestion) []string {
	refs := []string{}
	for _, o := range q.Options {
		refs = append(refs, o.Ref)
	}
	return refs
}

// G3 to G12.
func TestRestateCheckQuestions(t *testing.T) {
	def := seedDef(t)
	t.Run("G3: unknown role dropped", func(t *testing.T) {
		got := checkQuestions(def, []restateQuestion{question("q", "single",
			opt("role:legal", true, ""), opt("role:nobody", false, ""), opt("role:analyst", false, ""))})
		if len(got) != 1 || !reflect.DeepEqual(refsOf(got[0]), []string{"role:legal", "role:analyst"}) {
			t.Errorf("got %+v", got)
		}
	})
	t.Run("G4: wrong refs dropped", func(t *testing.T) {
		for _, ref := range []string{"document:Passport", "deadline:0", "deadline:012",
			"deadline:-5", "team:x", "legal"} {
			if validRef(def, ref) {
				t.Errorf("validRef(%q) = true", ref)
			}
		}
		got := checkQuestions(def, []restateQuestion{question("q", "multi",
			opt("role:legal", true, ""), opt("role:analyst", false, ""),
			opt("document:Passport", false, ""), opt("deadline:0", false, ""),
			opt("deadline:012", false, ""), opt("deadline:-5", false, ""),
			opt("team:x", false, ""), opt("legal", false, ""))})
		if len(got) != 1 || !reflect.DeepEqual(refsOf(got[0]), []string{"role:legal", "role:analyst"}) {
			t.Errorf("got %+v", got)
		}
	})
	t.Run("G5: known refs kept", func(t *testing.T) {
		refs := []string{"document:Loan offer", "deadline:24", "field:amount", "new:Compliance officer"}
		var options []restateOption
		for _, ref := range refs {
			if !validRef(def, ref) {
				t.Errorf("validRef(%q) = false", ref)
			}
			options = append(options, opt(ref, false, ""))
		}
		got := checkQuestions(def, []restateQuestion{question("q", "multi", options...)})
		if len(got) != 1 || !reflect.DeepEqual(refsOf(got[0]), refs) {
			t.Errorf("got %+v", got)
		}
	})
	t.Run("G6: question with 1 valid option dropped", func(t *testing.T) {
		got := checkQuestions(def, []restateQuestion{question("q", "single",
			opt("role:legal", true, ""), opt("role:nobody", false, ""))})
		if got == nil || len(got) != 0 {
			t.Errorf("got %+v, want []", got)
		}
	})
	t.Run("G7: single keeps the first default", func(t *testing.T) {
		got := checkQuestions(def, []restateQuestion{question("q", "single",
			opt("role:legal", false, ""), opt("role:analyst", true, "a"), opt("role:director", true, "d"))})
		o := got[0].Options
		if o[0].Default || !o[1].Default || o[2].Default || o[1].Reason != "a" || o[2].Reason != "" {
			t.Errorf("options = %+v", o)
		}
	})
	t.Run("G8: multi with no default", func(t *testing.T) {
		got := checkQuestions(def, []restateQuestion{question("q", "multi",
			opt("role:legal", false, ""), opt("role:analyst", false, ""))})
		o := got[0].Options
		if !o[0].Default || o[1].Default {
			t.Errorf("options = %+v", o)
		}
	})
	t.Run("G9: non-default reason cleared", func(t *testing.T) {
		got := checkQuestions(def, []restateQuestion{question("q", "single",
			opt("role:legal", true, "  four-eyes rule  "), opt("role:analyst", false, "x"))})
		o := got[0].Options
		if o[0].Reason != "four-eyes rule" || o[1].Reason != "" {
			t.Errorf("options = %+v", o)
		}
	})
	t.Run("G10: 3 questions, 5 options", func(t *testing.T) {
		six := question("a", "multi", opt("role:advisor", true, ""), opt("role:analyst", false, ""),
			opt("role:director", false, ""), opt("role:legal", false, ""),
			opt("role:backoffice", false, ""), opt("new:Clerk", false, ""))
		two := func(id string) restateQuestion {
			return question(id, "single", opt("role:legal", true, ""), opt("role:analyst", false, ""))
		}
		got := checkQuestions(def, []restateQuestion{six, two("b"), two("c"), two("d")})
		if len(got) != 3 || got[2].ID != "c" || len(got[0].Options) != 5 || got[0].Options[4].Ref != "role:backoffice" {
			t.Errorf("got %+v", got)
		}
	})
	t.Run("G11: wrong questions dropped", func(t *testing.T) {
		ok := question("q", "single", opt("role:legal", true, ""), opt("role:analyst", false, ""))
		text := ok
		text.Kind = "text"
		empty := ok
		empty.Text = "  "
		got := checkQuestions(def, []restateQuestion{ok, text, empty, ok})
		if len(got) != 1 {
			t.Errorf("got %d questions, want 1", len(got))
		}
		got = checkQuestions(def, []restateQuestion{text, empty})
		if got == nil || len(got) != 0 {
			t.Errorf("got %+v, want []", got)
		}
	})
	t.Run("G12: empty label dropped", func(t *testing.T) {
		blank := opt("field:client_name", false, "")
		blank.Label = "  "
		got := checkQuestions(def, []restateQuestion{question("q", "multi",
			opt("role:legal", true, ""), blank, opt("role:analyst", false, ""))})
		if len(got) != 1 || !reflect.DeepEqual(refsOf(got[0]), []string{"role:legal", "role:analyst"}) {
			t.Errorf("got %+v", got)
		}
	})
}

// G13: each object of the strict schema closes its keys and requires
// all of them.
func TestRestateSchemaStrict(t *testing.T) {
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
	walk("", restateSchema)
	if objects != 3 {
		t.Errorf("objects = %d, want 3", objects)
	}
}

// G14: both chat routes take 2000 characters and refuse 2001. The
// 2000 rows reach the draft check, so the message check passed.
func TestChangeMessageLimit(t *testing.T) {
	if msgChangeInvalidMessage != "message is required, 2000 characters at most" {
		t.Errorf("message text = %q", msgChangeInvalidMessage)
	}
	for _, route := range []string{"/api/ai/change-process", "/api/ai/restate-change"} {
		t.Run(route, func(t *testing.T) {
			aiRefusalEnv(t)
			newTestAPI(t)
			rec := do(t, "POST", route, changeReq(changeSeedVersionID, strings.Repeat("a", 2001)), "")
			checkError(t, rec, http.StatusBadRequest, "invalid_message", msgChangeInvalidMessage)
			rec = do(t, "POST", route, changeReq(changeSeedVersionID, strings.Repeat("a", 2000)), "")
			checkError(t, rec, http.StatusConflict, "conflict",
				fmt.Sprintf("version %s is not a draft", changeSeedVersionID))
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

// The rows of the selected step: S1 to S7.

// changeReqNode builds one chat request body with the raw JSON value
// node in the field selected_node_id.
func changeReqNode(versionID, message, node string) string {
	return fmt.Sprintf(`{"version_id":%q,"message":%q,"selected_node_id":%s}`,
		versionID, message, node)
}

// S1, S2 and S5: the user message holds the note only when a step is
// selected.
func TestChangeSelectedStepNote(t *testing.T) {
	note := ai.SelectedStepNote("offer", "Loan offer")
	routes := []struct {
		name, path, answer string
	}{
		{"change-process", "/api/ai/change-process", ""},
		{"restate-change", "/api/ai/restate-change", `{"restatement":"You want to X.","questions":[]}`},
	}
	rows := []struct {
		name, node string
		withNote   bool
	}{
		{"offer", `"offer"`, true},
		{"null", "null", false},
		{"absent", "", false},
	}
	for _, route := range routes {
		for _, row := range rows {
			t.Run(route.name+" "+row.name, func(t *testing.T) {
				answer := route.answer
				if answer == "" {
					answer = string(seedBytes(t))
				}
				srv, count, seen := changeLiveStub(t, []string{chatEnvelope(answer)})
				aiLive(t, srv.URL)
				newTestAPI(t)
				draftID := chatDraft(t)
				message := "Add a step after this step."
				body := changeReq(draftID, message)
				if row.node != "" {
					body = changeReqNode(draftID, message, row.node)
				}
				checkOK(t, do(t, "POST", route.path, body, ""))
				if *count != 1 {
					t.Fatalf("requests = %d, want 1", *count)
				}
				user := requestMessages(t, (*seen)[0]).Messages[1].Content
				want := "\n\nChange request: " + message
				if row.withNote {
					want += note
				}
				if !strings.HasSuffix(user, want) {
					t.Errorf("user message ends with %q, want %q", user[len(user)-200:], want)
				}
			})
		}
	}
}

// S3, S4, S6 and S7: the refusals of the field, no AI call.
func TestChangeSelectedStepRefusals(t *testing.T) {
	rows := []struct {
		name, node string
		draft      bool
		status     int
		code, msg  string
	}{
		{"S3: unknown step", `"nobody"`, true,
			http.StatusBadRequest, "invalid_node", msgInvalidNode},
		{"S4: empty string", `""`, true,
			http.StatusBadRequest, "invalid_node", msgInvalidNode},
		{"S6: number", `5`, true,
			http.StatusBadRequest, "invalid_json", msgInvalidJSON},
		{"S7: frozen version", `"nobody"`, false,
			http.StatusConflict, "conflict",
			fmt.Sprintf("version %s is not a draft", changeSeedVersionID)},
	}
	for _, path := range []string{"/api/ai/change-process", "/api/ai/restate-change"} {
		for _, row := range rows {
			t.Run(path+" "+row.name, func(t *testing.T) {
				srv, count, _ := changeLiveStub(t, []string{chatEnvelope("{}")})
				aiLive(t, srv.URL)
				newTestAPI(t)
				versionID := changeSeedVersionID
				if row.draft {
					versionID = chatDraft(t)
				}
				rec := do(t, "POST", path, changeReqNode(versionID, "Add a step.", row.node), "")
				checkError(t, rec, row.status, row.code, row.msg)
				if *count != 0 {
					t.Errorf("requests = %d, want 0", *count)
				}
			})
		}
	}
}

// formatAnswer returns the seed with the format keys removed, as the
// AI answers it, after one change of the fields.
func formatAnswer(t *testing.T, change func(fields []any) []any) string {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal(seedBytes(t), &doc); err != nil {
		t.Fatal(err)
	}
	fields := doc["fields"].([]any)
	for _, f := range fields {
		delete(f.(map[string]any), "format")
	}
	doc["fields"] = change(fields)
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// fieldFormats maps each field name of a definition to its format
// key, or to "absent".
func fieldFormats(t *testing.T, definition []byte) map[string]any {
	t.Helper()
	var doc struct {
		Fields []map[string]any `json:"fields"`
	}
	if err := json.Unmarshal(definition, &doc); err != nil {
		t.Fatalf("definition: %v", err)
	}
	out := map[string]any{}
	for _, f := range doc.Fields {
		format, ok := f["format"]
		if !ok {
			format = "absent"
		}
		out[f["name"].(string)] = format
	}
	return out
}

func sameFields(fields []any) []any { return fields }

// F1 to F5: withFormats copies the format of the current fields.
func TestWithFormats(t *testing.T) {
	cur := seedBytes(t)
	// F1
	got := fieldFormats(t, []byte(withFormats(formatAnswer(t, sameFields), cur)))
	if got["annual_rate"] != "percent" || got["debt_ratio"] != "percent" || got["amount"] != "absent" {
		t.Errorf("F1: formats = %v", got)
	}
	// F2
	money := formatAnswer(t, func(fields []any) []any {
		for _, f := range fields {
			if f.(map[string]any)["name"] == "annual_rate" {
				f.(map[string]any)["type"] = "money"
			}
		}
		return fields
	})
	got = fieldFormats(t, []byte(withFormats(money, cur)))
	if got["annual_rate"] != "absent" || got["debt_ratio"] != "percent" {
		t.Errorf("F2: formats = %v", got)
	}
	// F3
	extra := formatAnswer(t, func(fields []any) []any {
		return append(fields, map[string]any{"name": "fee_rate", "label": "Fee rate",
			"type": "number", "options": []any{}, "computed": nil})
	})
	got = fieldFormats(t, []byte(withFormats(extra, cur)))
	if got["fee_rate"] != "absent" || got["annual_rate"] != "percent" {
		t.Errorf("F3: formats = %v", got)
	}
	// F4
	if out := withFormats("[1]", cur); out != "[1]" {
		t.Errorf("F4: out = %s, want [1]", out)
	}
	// F5: a current definition with no format.
	answer := formatAnswer(t, sameFields)
	if out := withFormats(answer, []byte(answer)); out != answer {
		t.Error("F5: content changed, want the same string")
	}
}

// F6: the change route keeps the format of the draft.
func TestChangeKeepsFormat(t *testing.T) {
	srv, count, _ := changeLiveStub(t, []string{chatEnvelope(formatAnswer(t, sameFields))})
	aiLive(t, srv.URL)
	newTestAPI(t)
	draftID := createProcessVersion(t, seedBytes(t), "Format")

	definition := postChangeOnce(t, draftID, count)
	if got := fieldFormats(t, definition); got["annual_rate"] != "percent" {
		t.Errorf("annual_rate format = %v, want percent", got["annual_rate"])
	}
}
