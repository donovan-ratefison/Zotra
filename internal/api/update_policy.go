// The policy update: POST /api/ai/update-policy. The web sends the
// policy paragraphs and one version. For a later version, the engine
// computes the changes since version 1, and one AI call drafts the
// policy paragraphs that the changes make wrong, plus one paragraph
// for each added step. For version 1 (for example after an import),
// there is no diff: one AI call checks the paragraphs against the
// process file. The server keeps only the items that cite request
// paragraphs and valid elements. Nothing is stored.

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/process"
)

// msgNoPolicyChanges is the message of the no_changes answer.
const msgNoPolicyChanges = "This version has no change since version 1."

// updatePolicySchema is the strict response schema of the policy
// update.
var updatePolicySchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"changed": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"paragraph_id": map[string]any{"type": "string"},
					"new_text":     map[string]any{"type": "string"},
					"reason":       map[string]any{"type": "string"},
					"element_ids": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "string"},
					},
				},
				"required":             []string{"paragraph_id", "new_text", "reason", "element_ids"},
				"additionalProperties": false,
			},
		},
		"added": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"step_id":            map[string]any{"type": "string"},
					"after_paragraph_id": map[string]any{"type": "string"},
					"text":               map[string]any{"type": "string"},
					"reason":             map[string]any{"type": "string"},
				},
				"required":             []string{"step_id", "after_paragraph_id", "text", "reason"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"changed", "added"},
	"additionalProperties": false,
}

// policyChange is one changed paragraph of the answer.
type policyChange struct {
	ParagraphID string   `json:"paragraph_id"`
	NewText     string   `json:"new_text"`
	Reason      string   `json:"reason"`
	ElementIDs  []string `json:"element_ids"`
}

// policyAddition is one new paragraph of the answer.
type policyAddition struct {
	StepID           string `json:"step_id"`
	AfterParagraphID string `json:"after_paragraph_id"`
	Text             string `json:"text"`
	Reason           string `json:"reason"`
}

// updatePolicy drafts the policy text for one version. Version 1 runs
// in check mode: the model compares the paragraphs with the process
// file, and base_number is 0. Another version runs in diff mode: the
// model gets the changes since version 1, and base_number is 1. The
// answer is {"base_number": <0 or 1>, "changed": [...], "added": [...],
// "dropped": <n>}.
func (d apiDeps) updatePolicy(w http.ResponseWriter, r *http.Request) {
	// 1. The body.
	var body struct {
		VersionID  string        `json:"version_id"`
		Paragraphs []paragraphIn `json:"paragraphs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	// 2. The paragraphs.
	if !validParagraphs(body.Paragraphs) {
		writeError(w, http.StatusBadRequest, "invalid_paragraphs", msgInvalidParagraphs)
		return
	}
	// 3. The version, with any status.
	v, err := d.st.GetVersion(r.Context(), body.VersionID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// 4. The mode. Version 1 has no base: check mode.
	paragraphs, ids := policyParagraphs(body.Paragraphs)
	next, errNext := process.Decode(v.Definition)
	if errNext != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	var messages []ai.Message
	var changed, addedSteps map[string]bool
	baseNumber := 1
	if v.Number == 1 {
		// 5. Check mode: each step and link is valid, each step can
		// get a paragraph.
		baseNumber = 0
		changed, addedSteps = map[string]bool{}, map[string]bool{}
		for _, n := range next.Nodes {
			changed[n.ID] = true
			addedSteps[n.ID] = true
		}
		for _, e := range next.Edges {
			changed[e.ID] = true
		}
		messages = []ai.Message{
			{Role: "system", Content: ai.UpdatePolicyCheckSystem},
			{Role: "user", Content: ai.UpdatePolicyCheckUser(paragraphs, string(v.Definition))},
		}
	} else {
		// 5. Diff mode: the base is version number 1 of the same
		// process.
		versions, err := d.st.ListVersions(r.Context(), v.ProcessID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		var baseRaw []byte
		for _, x := range versions {
			if x.Number == 1 {
				baseRaw = x.Definition
			}
		}
		base, errBase := process.Decode(baseRaw)
		if baseRaw == nil || errBase != nil {
			writeError(w, http.StatusInternalServerError, "internal",
				"cannot complete the request")
			return
		}
		var lines []string
		lines, changed, addedSteps = changedElements(base, next)
		if len(lines) == 0 {
			writeError(w, http.StatusBadRequest, "no_changes", msgNoPolicyChanges)
			return
		}
		messages = []ai.Message{
			{Role: "system", Content: ai.UpdatePolicySystem},
			{Role: "user", Content: ai.UpdatePolicyUser(paragraphs, string(v.Definition), lines)},
		}
	}
	// 6. One AI call, no repair loop.
	ansBody, err := d.ai.ChatCompletion(r.Context(), messages, "policy_update", updatePolicySchema)
	if err != nil {
		writeAIError(w, err)
		return
	}
	var answer struct {
		Changed []policyChange   `json:"changed"`
		Added   []policyAddition `json:"added"`
	}
	content, ok := answerContent(ansBody)
	if ok {
		ok = json.Unmarshal([]byte(content), &answer) == nil
	}
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "invalid_output", msgNoContent)
		return
	}
	// 7. The item checks, in answer order.
	keptChanged := []policyChange{}
	kept := map[string]bool{}
	for _, c := range answer.Changed {
		c.ParagraphID = strings.TrimSpace(c.ParagraphID)
		c.NewText = strings.TrimSpace(c.NewText)
		c.Reason = strings.TrimSpace(c.Reason)
		good := ids[c.ParagraphID] && !kept[c.ParagraphID] &&
			c.NewText != "" && c.Reason != "" && len(c.ElementIDs) > 0
		for i, id := range c.ElementIDs {
			c.ElementIDs[i] = strings.TrimSpace(id)
			good = good && changed[c.ElementIDs[i]]
		}
		if good {
			kept[c.ParagraphID] = true
			keptChanged = append(keptChanged, c)
		}
	}
	keptAdded := []policyAddition{}
	for _, a := range answer.Added {
		a.StepID = strings.TrimSpace(a.StepID)
		a.AfterParagraphID = strings.TrimSpace(a.AfterParagraphID)
		a.Text = strings.TrimSpace(a.Text)
		a.Reason = strings.TrimSpace(a.Reason)
		if addedSteps[a.StepID] && ids[a.AfterParagraphID] && a.Text != "" && a.Reason != "" {
			keptAdded = append(keptAdded, a)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"base_number": baseNumber,
		"changed":     keptChanged,
		"added":       keptAdded,
		"dropped":     len(answer.Changed) + len(answer.Added) - len(keptChanged) - len(keptAdded),
	})
}

// changedElements lists the changes of the steps and links from base
// to next, one line each: "+" added, "~" changed, "-" removed, with
// the element id. changed holds each listed id, addedSteps the new
// step ids. Roles and fields are not listed: the citations sit on
// steps and checks.
func changedElements(base, next process.Definition) (lines []string, changed, addedSteps map[string]bool) {
	changed = map[string]bool{}
	addedSteps = map[string]bool{}
	baseNodes := map[string]process.Node{}
	for _, n := range base.Nodes {
		baseNodes[n.ID] = n
	}
	nextNodes := map[string]bool{}
	for _, n := range next.Nodes {
		nextNodes[n.ID] = true
		old, ok := baseNodes[n.ID]
		switch {
		case !ok:
			lines = append(lines, fmt.Sprintf("+ step %s %q", n.ID, n.Name))
			changed[n.ID] = true
			addedSteps[n.ID] = true
		case !sameJSON(old, n):
			lines = append(lines, fmt.Sprintf("~ step %s %q", n.ID, n.Name))
			changed[n.ID] = true
		}
	}
	for _, n := range base.Nodes {
		if !nextNodes[n.ID] {
			lines = append(lines, fmt.Sprintf("- step %s %q", n.ID, n.Name))
			changed[n.ID] = true
		}
	}
	baseEdges := map[string]process.Edge{}
	for _, e := range base.Edges {
		baseEdges[e.ID] = e
	}
	nextEdges := map[string]bool{}
	for _, e := range next.Edges {
		nextEdges[e.ID] = true
		old, ok := baseEdges[e.ID]
		switch {
		case !ok:
			lines = append(lines, fmt.Sprintf("+ link %s %s -> %s", e.ID, e.From, e.To))
			changed[e.ID] = true
		case !sameJSON(old, e):
			lines = append(lines, fmt.Sprintf("~ link %s %s -> %s", e.ID, e.From, e.To))
			changed[e.ID] = true
		}
	}
	for _, e := range base.Edges {
		if !nextEdges[e.ID] {
			lines = append(lines, fmt.Sprintf("- link %s %s -> %s", e.ID, e.From, e.To))
			changed[e.ID] = true
		}
	}
	return lines, changed, addedSteps
}

// sameJSON reports whether a and b have the same JSON encoding.
func sameJSON(a, b any) bool {
	x, errX := json.Marshal(a)
	y, errY := json.Marshal(b)
	return errX == nil && errY == nil && string(x) == string(y)
}
