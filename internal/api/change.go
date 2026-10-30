// The assistant chat: POST /api/ai/change-process. The designer
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
	// 1. The body.
	var body changeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	// 2. The message, in characters.
	message := strings.TrimSpace(body.Message)
	if message == "" || utf8.RuneCountInString(message) > 1000 {
		writeError(w, http.StatusBadRequest, "invalid_message", msgChangeInvalidMessage)
		return
	}
	// 3. The version. An unknown version maps to 404 not_found
	// through the store mapping.
	v, err := d.st.GetVersion(r.Context(), body.VersionID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// 4. The change applies to a draft.
	if v.Status != store.StatusDraft {
		writeError(w, http.StatusConflict, "conflict",
			fmt.Sprintf("version %s is not a draft", body.VersionID))
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
		switch {
		case !ok || content == "":
			errs = []process.Error{{Path: "", Message: msgNoContent}}
		default:
			errs = rules.ValidateDocument([]byte(content))
		}
		if len(errs) == 0 {
			errs = checkCitations(content, ids)
		}
		if len(errs) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{
				"definition": json.RawMessage(content),
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
