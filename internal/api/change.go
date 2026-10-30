// The assistant chat: POST /api/ai/change-process (and the restate
// step, POST /api/ai/restate-change). The designer
// types a change of the process in plain words, the model answers
// with one full process document, and only a document that passes
// the full validation and the citation check against the current
// definition reaches the client. Nothing is saved: the client shows
// the proposal, and the designer accepts or rejects it.

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/rules"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// msgChangeInvalidMessage is the message of every invalid_message
// answer of the assistant chat.
const msgChangeInvalidMessage = "message is required, 1000 characters at most"

// changeBody is the request body of the assistant chat.
type changeBody struct {
	VersionID string `json:"version_id"`
	Message   string `json:"message"`
}

// changeProcess proposes one changed process document for one
// request of the designer. The answer is {"definition": <document>,
// "attempts": <n>}. After 3 failed attempts it answers 422 with the
// errors of the last attempt.
func (d apiDeps) changeProcess(w http.ResponseWriter, r *http.Request) {
	v, message, ok := d.changeRequest(w, r)
	if !ok {
		return
	}
	// 5. The citation ids of the current definition: the model may
	// keep the cited paragraphs, never invent one.
	current, err := process.Decode(v.Definition)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	ids := map[string]bool{}
	for _, node := range current.Nodes {
		for _, id := range node.Citations {
			ids[id] = true
		}
		for _, check := range node.Checks {
			for _, id := range check.Citations {
				ids[id] = true
			}
		}
	}
	// 6. The prompt.
	messages := []ai.Message{
		{Role: "system", Content: ai.ChangeProcessSystem},
		{Role: "user", Content: ai.ChangeProcessUser(string(v.Definition), message)},
	}
	// 7. The repair loop, at most 3 attempts. lastErrs feeds the 422
	// details when every attempt failed.
	var lastErrs []process.Error
	for attempt := 1; attempt <= 3; attempt++ {
		ansBody, err := d.ai.ChatCompletion(r.Context(), messages,
			"process", process.JSONSchema())
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "ai_unavailable",
				aiErrorText(err))
			return
		}
		var errs []process.Error
		content, ok := answerContent(ansBody)
		// merged is the answer with the sources of the current
		// definition: the AI never writes sources.
		merged := content
		switch {
		case !ok || content == "":
			errs = []process.Error{{Path: "", Message: msgNoContent}}
		default:
			merged = withSources(content, v.Definition)
			errs = rules.ValidateDocument([]byte(merged))
		}
		if len(errs) == 0 {
			errs = checkCitations(merged, ids)
		}
		if len(errs) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{
				"definition": json.RawMessage(merged),
				"attempts":   attempt,
			})
			return
		}
		lastErrs = errs
		if attempt < 3 {
			messages = append(messages,
				ai.Message{Role: "assistant", Content: content},
				ai.Message{Role: "user", Content: repairMessage(errs)})
		}
	}
	writeErrorDetails(w, http.StatusUnprocessableEntity, "invalid_output",
		msgExplainFailed, lastErrs)
}

// withSources returns the AI answer with the sources array of the
// current definition. The strict AI schema closes the sources array,
// so the model cannot keep the hand-defined sources. The answer stays
// as it is when it is not a JSON object, or when the current
// definition has no sources key (a draft can be any JSON object).
func withSources(content string, current []byte) string {
	var answer map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &answer); err != nil || answer == nil {
		return content
	}
	var cur map[string]json.RawMessage
	if err := json.Unmarshal(current, &cur); err != nil {
		return content
	}
	src, ok := cur["sources"]
	if !ok {
		return content
	}
	answer["sources"] = src
	out, err := json.Marshal(answer)
	if err != nil {
		return content
	}
	return string(out)
}

// changeRequest reads the body of a chat request and runs the checks
// that both chat routes share. It writes the error answer and returns
// ok false when a check fails.
func (d apiDeps) changeRequest(w http.ResponseWriter, r *http.Request) (v store.Version, message string, ok bool) {
	// 1. The body.
	var body changeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return v, "", false
	}
	// 2. The message, in characters.
	message = strings.TrimSpace(body.Message)
	if message == "" || utf8.RuneCountInString(message) > 1000 {
		writeError(w, http.StatusBadRequest, "invalid_message", msgChangeInvalidMessage)
		return v, "", false
	}
	// 3. The version. An unknown version maps to 404 not_found
	// through the store mapping.
	v, err := d.st.GetVersion(r.Context(), body.VersionID)
	if err != nil {
		writeStoreError(w, err)
		return v, "", false
	}
	// 4. The change applies to a draft.
	if v.Status != store.StatusDraft {
		writeError(w, http.StatusConflict, "conflict",
			fmt.Sprintf("version %s is not a draft", body.VersionID))
		return v, "", false
	}
	return v, message, true
}

// restateSchema is the response schema of the restate step.
var restateSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"restatement": map[string]any{"type": "string"},
	},
	"required":             []string{"restatement"},
	"additionalProperties": false,
}

// restateChange restates one request of the designer in one or two
// sentences, before any change. The answer is {"restatement": <text>}.
// It makes one AI call, with no repair loop.
func (d apiDeps) restateChange(w http.ResponseWriter, r *http.Request) {
	v, message, ok := d.changeRequest(w, r)
	if !ok {
		return
	}
	messages := []ai.Message{
		{Role: "system", Content: ai.RestateChangeSystem},
		{Role: "user", Content: ai.ChangeProcessUser(string(v.Definition), message)},
	}
	ansBody, err := d.ai.ChatCompletion(r.Context(), messages, "restatement", restateSchema)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "ai_unavailable", aiErrorText(err))
		return
	}
	var answer struct {
		Restatement string `json:"restatement"`
	}
	content, ok := answerContent(ansBody)
	if ok {
		ok = json.Unmarshal([]byte(content), &answer) == nil
	}
	text := strings.TrimSpace(answer.Restatement)
	if !ok || text == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_output", msgNoContent)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"restatement": text})
}
