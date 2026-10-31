// The tests of the compare summary: rows C1 to C6. The live rows run
// against one stub server, with the env set before newTestAPI. The
// refusal rows run no AI call.

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/donovan-ratefison/zotra/internal/ai"
)

// postCompare posts one compare summary request to the handler under
// test.
func postCompare(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/ai/compare-versions", body, "")
}

// changesBody builds one request body with n items of line.
func changesBody(t *testing.T, n int, line string) string {
	t.Helper()
	items := make([]string, n)
	for i := range items {
		items[i] = line
	}
	raw, err := json.Marshal(map[string]any{"changes": items})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// C1.
func TestCompareAnswersTrimmed(t *testing.T) {
	srv, count, seen := changeLiveStub(t,
		[]string{chatEnvelope(`{"summary":"  One step was added.  "}`)})
	aiLive(t, srv.URL)
	newTestAPI(t)

	rec := postCompare(t, `{"changes":["  + Task Credit committee ","~ Task Credit analysis modified"]}`)
	checkOK(t, rec)
	if got := decode(t, rec)["summary"]; got != "One step was added." {
		t.Errorf("summary = %q", got)
	}
	if *count != 1 {
		t.Fatalf("requests = %d, want 1", *count)
	}
	req := requestMessages(t, (*seen)[0])
	if len(req.Messages) != 2 {
		t.Fatalf("the request holds %d messages, want 2", len(req.Messages))
	}
	if req.Messages[0].Role != "system" || req.Messages[0].Content != ai.CompareVersionsSystem {
		t.Error("system message is not CompareVersionsSystem")
	}
	wantUser := "+ Task Credit committee\n~ Task Credit analysis modified"
	if req.Messages[1].Role != "user" || req.Messages[1].Content != wantUser {
		t.Errorf("user message = %q, want %q", req.Messages[1].Content, wantUser)
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
	if format.ResponseFormat.JSONSchema.Name != "compare_summary" {
		t.Errorf("schema name = %q, want compare_summary", format.ResponseFormat.JSONSchema.Name)
	}
}

// C2.
func TestCompareInvalidOutput(t *testing.T) {
	for _, stub := range []string{
		chatEnvelope(`{"summary":"   "}`),
		chatEnvelope("not json"),
		`{"choices":[]}`,
	} {
		t.Run(stub, func(t *testing.T) {
			srv, count, _ := changeLiveStub(t, []string{stub})
			aiLive(t, srv.URL)
			newTestAPI(t)
			rec := postCompare(t, `{"changes":["+ a"]}`)
			checkError(t, rec, http.StatusUnprocessableEntity, "invalid_output", msgNoContent)
			if *count != 1 {
				t.Errorf("requests = %d, want 1", *count)
			}
		})
	}
}

// C3.
func TestCompareAIOff(t *testing.T) {
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	newTestAPI(t)
	rec := postCompare(t, `{"changes":["+ a"]}`)
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable",
		"The AI layer is off.")
}

// C4 and C5: the refusals, no AI call.
func TestCompareRefusals(t *testing.T) {
	rows := []struct {
		name string
		body string
		code string
		msg  string
	}{
		{"bad json", `{`, "invalid_json", msgInvalidJSON},
		{"item not a string", `{"changes":[5]}`, "invalid_json", msgInvalidJSON},
		{"missing", `{}`, "invalid_changes", msgCompareInvalidChanges},
		{"null", `{"changes":null}`, "invalid_changes", msgCompareInvalidChanges},
		{"empty", `{"changes":[]}`, "invalid_changes", msgCompareInvalidChanges},
		{"201 items", changesBody(t, 201, "+ a"), "invalid_changes", msgCompareInvalidChanges},
		{"blank item", `{"changes":["   "]}`, "invalid_changes", msgCompareInvalidChanges},
		{"301 characters", changesBody(t, 1, strings.Repeat("a", 301)), "invalid_changes", msgCompareInvalidChanges},
	}
	srv, count, _ := changeLiveStub(t, []string{chatEnvelope(`{"summary":"S"}`)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			rec := postCompare(t, row.body)
			checkError(t, rec, http.StatusBadRequest, row.code, row.msg)
		})
	}
	if *count != 0 {
		t.Errorf("requests = %d, want 0", *count)
	}
}

// C6: the limits are inclusive.
func TestCompareLimits(t *testing.T) {
	srv, _, _ := changeLiveStub(t, []string{chatEnvelope(`{"summary":"S"}`)})
	aiLive(t, srv.URL)
	newTestAPI(t)
	for _, body := range []string{
		changesBody(t, 1, strings.Repeat("a", 300)),
		changesBody(t, 200, "+ a"),
	} {
		rec := postCompare(t, body)
		checkOK(t, rec)
		if got := decode(t, rec)["summary"]; got != "S" {
			t.Errorf("summary = %q, want S", got)
		}
	}
}
