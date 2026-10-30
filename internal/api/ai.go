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

	"cel.dev/cel-go/cel"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/engine"
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
		{Role: "user", Content: ai.PolicyToProcessUser(paragraphs)},
	}
	// 5. The repair loop, at most 3 attempts. lastErrs feeds the 422
	// details when every attempt failed.
	var lastErrs []process.Error
	for attempt := 1; attempt <= 3; attempt++ {
		ansBody, err := d.ai.ChatCompletion(r.Context(), messages,
			"process", policySchema())
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "ai_unavailable",
				aiErrorText(err))
			return
		}
		var errs []process.Error
		var named string
		content, ok := answerContent(ansBody)
		if ok && content != "" {
			var reason string
			reason, content = splitReason(content)
			if reason != "" {
				writeError(w, http.StatusUnprocessableEntity, "not_a_policy",
					"This file is not a credit policy. "+reason)
				return
			}
		}
		switch {
		case !ok || content == "":
			errs = []process.Error{{Path: "", Message: msgNoContent}}
		default:
			named = withName(content, body.Name)
			errs = rules.ValidateDocument([]byte(named))
		}
		if len(errs) == 0 {
			errs = checkCitations(named, seen)
		}
		if len(errs) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{
				"definition": json.RawMessage(named),
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

// policySchema returns a deep copy of the process schema with one more
// property, not_a_policy_reason. The copy keeps the shared schema
// unchanged. Strict mode needs each property in required.
func policySchema() map[string]any {
	b, err := json.Marshal(process.JSONSchema())
	if err != nil {
		panic(fmt.Sprintf("marshal process schema: %v", err))
	}
	var schema map[string]any
	if err := json.Unmarshal(b, &schema); err != nil {
		panic(fmt.Sprintf("unmarshal process schema: %v", err))
	}
	schema["properties"].(map[string]any)["not_a_policy_reason"] =
		map[string]any{"type": []any{"string", "null"}}
	schema["required"] = append(schema["required"].([]any), "not_a_policy_reason")
	return schema
}

// splitReason removes the key not_a_policy_reason from one answer
// object. reason is the trimmed value when it is a string, else "".
// Content that is not an object, or an object without the key, comes
// back unchanged.
func splitReason(content string) (reason string, rest string) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &obj); err != nil || obj == nil {
		return "", content
	}
	raw, found := obj["not_a_policy_reason"]
	if !found {
		return "", content
	}
	delete(obj, "not_a_policy_reason")
	b, err := json.Marshal(obj)
	if err != nil {
		return "", content
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		reason = strings.TrimSpace(s)
	}
	return reason, string(b)
}

// withName sets the key "name" of one answer object to name. The
// request name is not in the prompt, so the server writes it here.
// Content that is not an object comes back unchanged.
func withName(content, name string) string {
	var obj map[string]any
	if err := json.Unmarshal([]byte(content), &obj); err != nil || obj == nil {
		return content
	}
	obj["name"] = name
	b, err := json.Marshal(obj)
	if err != nil {
		return content
	}
	return string(b)
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

// explainBody is the request body of the check explanation.
type explainBody struct {
	CaseID  string `json:"case_id"`
	NodeID  string `json:"node_id"`
	CheckID string `json:"check_id"`
}

// explainProposal is the proposed rule fix of one answer.
type explainProposal struct {
	Expression string `json:"expression"`
	Message    string `json:"message"`
	PlainText  string `json:"plain_text"`
}

// explainAnswer is the answer of the check explanation.
type explainAnswer struct {
	Explanation string          `json:"explanation"`
	Proposal    explainProposal `json:"proposal"`
}

// msgMissingFields is the message of every invalid_request answer of
// the explanation.
const msgMissingFields = "case_id, node_id and check_id are required"

// msgExplainFailed is the message of the 422 answer of the
// explanation after 3 failed attempts (the message of 2.4).
const msgExplainFailed = "The AI output did not pass validation after 3 attempts."

// explainSchema returns the response schema of the explanation.
// Strict mode needs every property required.
func explainSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"explanation", "proposal"},
		"properties": map[string]any{
			"explanation": map[string]any{"type": "string"},
			"proposal": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"expression", "message", "plain_text"},
				"properties": map[string]any{
					"expression": map[string]any{"type": "string"},
					"message":    map[string]any{"type": "string"},
					"plain_text": map[string]any{"type": "string"},
				},
			},
		},
	}
}

// checkExplainAnswer parses the answer content and checks the
// proposal: the expression is present and compiles as a boolean rule
// over the fields of the case. Each problem is one error with path
// "" and the error text as message.
func checkExplainAnswer(content string, env *rules.Env) (explainAnswer, []process.Error) {
	var ans explainAnswer
	if err := json.Unmarshal([]byte(content), &ans); err != nil {
		return explainAnswer{}, []process.Error{{Path: "", Message: err.Error()}}
	}
	if ans.Proposal.Expression == "" {
		return ans, []process.Error{{Path: "",
			Message: "the proposal expression is empty"}}
	}
	if _, err := env.Compile(ans.Proposal.Expression, cel.BoolType); err != nil {
		return ans, []process.Error{{Path: "", Message: err.Error()}}
	}
	return ans, nil
}

// explainRepairMessage formats the user message of one repair step:
// the instruction line, then one line per error.
func explainRepairMessage(errs []process.Error) string {
	var b strings.Builder
	b.WriteString("The proposal does not compile as a boolean rule. " +
		"Return the corrected answer.")
	for _, e := range errs {
		b.WriteString("\n")
		b.WriteString(e.Message)
	}
	return b.String()
}

// explainCheck explains one failed check: POST /api/ai/explain-check.
// The answer is {"explanation": ..., "proposal": {...}}. After 3
// failed attempts it answers 422 with the errors of the last attempt.
func (d apiDeps) explainCheck(w http.ResponseWriter, r *http.Request) {
	// 1. The body.
	var body explainBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	// 2. The three ids.
	if body.CaseID == "" || body.NodeID == "" || body.CheckID == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", msgMissingFields)
		return
	}
	// 3. The case, its definition, its events, its state. An unknown
	// case maps to 404 not_found through the store mapping.
	_, def, events, st, ok := d.loadCaseState(w, r, body.CaseID)
	if !ok {
		return
	}
	// 4. The case rests on the step of the check.
	if st.NodeID != body.NodeID {
		writeError(w, http.StatusConflict, "conflict", "the case is not on this step")
		return
	}
	// 5. The step holds the check.
	var check *process.Check
	var nodeName string
	for i := range def.Nodes {
		if def.Nodes[i].ID != body.NodeID {
			continue
		}
		nodeName = def.Nodes[i].Name
		for j := range def.Nodes[i].Checks {
			if def.Nodes[i].Checks[j].ID == body.CheckID {
				check = &def.Nodes[i].Checks[j]
				break
			}
		}
		break
	}
	if check == nil {
		writeError(w, http.StatusConflict, "conflict",
			fmt.Sprintf("the step has no check %s", body.CheckID))
		return
	}
	// 6. The last evaluation of the check in the events failed. The
	// fold already unmarshaled every payload, so a payload error
	// cannot happen here.
	failed := false
	for _, e := range events {
		if e.Type != engine.EventCheckEvaluated {
			continue
		}
		var p engine.CheckEvaluatedPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			writeError(w, http.StatusInternalServerError, "internal",
				"cannot complete the request")
			return
		}
		if p.CheckID == body.CheckID {
			failed = !p.Result
		}
	}
	if !failed {
		writeError(w, http.StatusConflict, "conflict", "the check did not fail")
		return
	}
	// 7. The environment that checks the proposal. It cannot fail on
	// a folded definition; the store mapping gives 500 internal.
	env, err := rules.NewEnv(def.Fields, def.Sources)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// 8. The prompt.
	messages := []ai.Message{
		{Role: "system", Content: ai.ExplainCheckSystem},
		{Role: "user", Content: ai.ExplainCheckUser(nodeName, body.CheckID,
			check.Expression, check.Message, st.Data)},
	}
	// 9. The repair loop, at most 3 attempts. lastErrs feeds the 422
	// details when every attempt failed.
	var lastErrs []process.Error
	for attempt := 1; attempt <= 3; attempt++ {
		ansBody, err := d.ai.ChatCompletion(r.Context(), messages,
			"explain_check", explainSchema())
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "ai_unavailable",
				aiErrorText(err))
			return
		}
		var errs []process.Error
		var ans explainAnswer
		content, hasContent := answerContent(ansBody)
		switch {
		case !hasContent || content == "":
			errs = []process.Error{{Path: "", Message: msgNoContent}}
		default:
			ans, errs = checkExplainAnswer(content, env)
		}
		if len(errs) == 0 {
			writeJSON(w, http.StatusOK, ans)
			return
		}
		lastErrs = errs
		if attempt < 3 {
			messages = append(messages,
				ai.Message{Role: "assistant", Content: content},
				ai.Message{Role: "user", Content: explainRepairMessage(errs)})
		}
	}
	writeErrorDetails(w, http.StatusUnprocessableEntity, "invalid_output",
		msgExplainFailed, lastErrs)
}
