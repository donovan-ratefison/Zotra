// The policy import: POST /api/ai/policy-to-process. The web sends
// numbered paragraphs of a credit policy, the model answers with one
// process document, and only a document that passes the full
// validation and the citation check reaches the client.

package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/rules"
)

// paragraphIDRE matches one paragraph id: p<page>-<index>, two
// positive integers without leading zeros. p1-1 passes. p1-0, p01-1
// and p1-01 fail.
var paragraphIDRE = regexp.MustCompile(`^p([1-9][0-9]*)-([1-9][0-9]*)$`)

// msgInvalidParagraphs is the message of every invalid_paragraphs
// answer.
const msgInvalidParagraphs = "paragraphs must hold 1 to 500 items, " +
	"each with a unique id p<page>-<index> and a text of 1 to 5000 characters"

// msgNoContent is the validation error for an answer whose body holds
// no content string.
const msgNoContent = "the AI answer has no content"

// policyBody is the request body of the import.
type policyBody struct {
	Name       string `json:"name"`
	Paragraphs []struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	} `json:"paragraphs"`
}

// policyToProcess converts one policy into one process document. The
// answer is {"definition": <document>, "attempts": <n>}. After 3
// failed attempts it answers 422 with the errors of the last attempt.
func (d apiDeps) policyToProcess(w http.ResponseWriter, r *http.Request) {
	// 1. The body.
	var body policyBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	// 2. The name, in characters.
	if body.Name == "" || utf8.RuneCountInString(body.Name) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_name", "name is required")
		return
	}
	// 3. The paragraphs: 1 to 500 items, unique ids of the form
	// p<page>-<index>, 1 to 5000 characters of text, in this order.
	if len(body.Paragraphs) == 0 || len(body.Paragraphs) > 500 {
		writeError(w, http.StatusBadRequest, "invalid_paragraphs", msgInvalidParagraphs)
		return
	}
	seen := map[string]bool{}
	for _, p := range body.Paragraphs {
		if !paragraphIDRE.MatchString(p.ID) || seen[p.ID] ||
			p.Text == "" || utf8.RuneCountInString(p.Text) > 5000 {
			writeError(w, http.StatusBadRequest, "invalid_paragraphs", msgInvalidParagraphs)
			return
		}
		seen[p.ID] = true
	}
	// 4. The prompt.
	paragraphs := make([]ai.PolicyParagraph, 0, len(body.Paragraphs))
	for _, p := range body.Paragraphs {
		paragraphs = append(paragraphs, ai.PolicyParagraph{ID: p.ID, Text: p.Text})
	}
	messages := []ai.Message{
		{Role: "system", Content: ai.PolicyToProcessSystem},
		{Role: "user", Content: ai.PolicyToProcessUser(body.Name, paragraphs)},
	}
	// 5. The repair loop, at most 3 attempts. lastErrs feeds the 422
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
			errs = checkCitations(content, seen)
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
		"The AI output did not pass validation after 3 attempts.", lastErrs)
}

// aiErrorText maps one AI call error to the message of the 503
// answer. The client wraps transport errors in *url.Error, so the
// text of the mode off error is "ai: off" only after an unwrap.
func aiErrorText(err error) string {
	for {
		var urlErr *url.Error
		if !errors.As(err, &urlErr) {
			break
		}
		if urlErr.Err.Error() == "ai: off" {
			return "The AI layer is off."
		}
		err = urlErr.Err
	}
	return err.Error()
}

// checkCitations walks the citations of the decoded document and
// returns one error per cited id that the request did not carry, in
// document order: each node, its citations, then each check and its
// citations.
func checkCitations(content string, ids map[string]bool) []process.Error {
	def, err := process.Decode([]byte(content))
	if err != nil {
		// Not reachable after ValidateDocument: kept for safety.
		return []process.Error{{Path: "", Message: err.Error()}}
	}
	var errs []process.Error
	unknown := func(path, id string) {
		if !ids[id] {
			errs = append(errs, process.Error{
				Path:    path,
				Message: fmt.Sprintf("cited paragraph id %s does not exist", id),
			})
		}
	}
	for i, node := range def.Nodes {
		for _, id := range node.Citations {
			unknown(fmt.Sprintf("/nodes/%d/citations", i), id)
		}
		for j, check := range node.Checks {
			for _, id := range check.Citations {
				unknown(fmt.Sprintf("/nodes/%d/checks/%d/citations", i, j), id)
			}
		}
	}
	return errs
}

// repairMessage formats the user message of one repair step: the
// instruction line, then one line per error. An empty path reads
// "document".
func repairMessage(errs []process.Error) string {
	var b strings.Builder
	b.WriteString("The document failed validation. Fix every error and " +
		"return the full corrected document.\n")
	for i, e := range errs {
		if i > 0 {
			b.WriteString("\n")
		}
		path := e.Path
		if path == "" {
			path = "document"
		}
		fmt.Fprintf(&b, "%s: %s", path, e.Message)
	}
	return b.String()
}
