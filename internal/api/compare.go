// The compare summary: POST /api/ai/compare-versions. The client
// sends the change lines of the version diff, and the model writes a
// short plain-language summary of them. One AI call, no repair loop:
// the summary has no rule to repair against.

package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/donovan-ratefison/zotra/internal/ai"
)

// msgCompareInvalidChanges is the message of every invalid_changes
// answer of the compare summary.
const msgCompareInvalidChanges = "changes must hold 1 to 200 lines of 1 to 300 characters"

// compareSchema is the strict response schema of the compare summary.
var compareSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"summary": map[string]any{"type": "string"},
	},
	"required":             []string{"summary"},
	"additionalProperties": false,
}

// compareVersions summarizes the change lines of two versions. The
// answer is {"summary": <text>}.
func (d apiDeps) compareVersions(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Changes []string `json:"changes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	if len(body.Changes) == 0 || len(body.Changes) > 200 {
		writeError(w, http.StatusBadRequest, "invalid_changes", msgCompareInvalidChanges)
		return
	}
	lines := make([]string, len(body.Changes))
	for i, c := range body.Changes {
		lines[i] = strings.TrimSpace(c)
		if n := utf8.RuneCountInString(lines[i]); n == 0 || n > 300 {
			writeError(w, http.StatusBadRequest, "invalid_changes", msgCompareInvalidChanges)
			return
		}
	}
	messages := []ai.Message{
		{Role: "system", Content: ai.CompareVersionsSystem},
		{Role: "user", Content: strings.Join(lines, "\n")},
	}
	ansBody, err := d.ai.ChatCompletion(r.Context(), messages, "compare_summary", compareSchema)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "ai_unavailable", aiErrorText(err))
		return
	}
	var answer struct {
		Summary string `json:"summary"`
	}
	content, ok := answerContent(ansBody)
	if ok {
		ok = json.Unmarshal([]byte(content), &answer) == nil
	}
	text := strings.TrimSpace(answer.Summary)
	if !ok || text == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_output", msgNoContent)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"summary": text})
}
