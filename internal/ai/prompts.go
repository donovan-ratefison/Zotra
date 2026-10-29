// Package ai: the prompts of the AI features, as Go string
// constants, in English.
package ai

import (
	"encoding/json"
	"fmt"
	"strings"
)

// GenerateTestsSystem is the system message of the test generator.
const GenerateTestsSystem = `You write test cases for a credit process. You answer with one
JSON object that matches the given schema. Each case targets one red
edge: propose the field values and the command steps that walk one
case from the start to that edge. Use only the field names and the
decision values of the process. Money and number fields are numbers,
integer fields are integers, document fields are lists of strings,
date fields use the RFC 3339 format.`

// GenerateTestsUser is the template of the user message. It takes
// the process summary and the red edges.
const GenerateTestsUser = `Process summary (JSON):
%s

Red edges (JSON array of edge ids):
%s

Write one test case per red edge. Each case holds the field values
for the start command and the command steps. A step has the same
shape as the case commands of the API: {"type":"submit","values":{}}
or {"type":"decide","decision":"..."} or {"type":"sign","document_hash":"..."}.
A take step is not needed. Do not include the start step.`

// GenerateTestsRepair is the template of the repair message, sent
// when the previous answer failed the checks. It takes the errors.
const GenerateTestsRepair = `Your previous answer failed. Errors:
%s

Answer again with one JSON object that matches the schema and fixes
every error.`

// SamZonesPrompt is the instruction of the zone detection.
const SamZonesPrompt = `Find the zones of this document scan. Answer
with one JSON object: {"zones":[{"label":"signature|stamp|id","box":
{"x":0,"y":0,"width":0,"height":0},"mask":[]}]} in image pixels. Use
one zone per area you find. The mask field can stay empty.`

// ExplainCheckSystem is the system prompt of the check explanation.
const ExplainCheckSystem = `You explain a failed check of a bank credit process.
You receive the check (its CEL expression and its message), the data of the case, and the plain values the expression used.
Answer with one JSON object: an "explanation" field with two to four short sentences in plain English for a banker,
and a "proposal" object with a new "expression" (CEL, boolean), "message" (the failure message in English) and "plain_text" (the rule in one plain English sentence).
Change the rule only when the policy behind the check justifies it. Else keep the expression as it is.`

// ExplainCheckUser formats the context of one failed check as the
// user message: the step line, the check line, the expression line,
// the message line, then the case data as one JSON object. The keys
// sort, so one case gives one message.
func ExplainCheckUser(nodeName, checkID, expression, message string,
	data map[string]any,
) string {
	encoded, err := json.Marshal(data)
	if err != nil {
		// Not reachable for the folded state data: every value came
		// from JSON events. Kept for safety.
		encoded = []byte("{}")
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Step: %s\n", nodeName)
	fmt.Fprintf(&b, "Check: %s\n", checkID)
	fmt.Fprintf(&b, "Expression: %s\n", expression)
	fmt.Fprintf(&b, "Message: %s\n", message)
	fmt.Fprintf(&b, "Data: %s", encoded)
	return b.String()
}

// ReadFieldsPrompt is the instruction of the field reading.
const ReadFieldsPrompt = `Read the listed fields of this document
scan. Answer one JSON object with one key per listed field name.
Use the JSON type of the field. Use null when the scan does not
show the field. No other key.`

// PolicyParagraph is one numbered paragraph of a policy: the id has
// the form p<page>-<index>, the text is the paragraph text.
type PolicyParagraph struct {
	ID   string
	Text string
}

// PolicyToProcessSystem is the system prompt of the policy import.
const PolicyToProcessSystem = `You convert a bank credit policy into a Zotra process file.
You receive numbered paragraphs of the policy, one id per paragraph, in the form p<page>-<index>.
Return one JSON document that satisfies the given schema. Rules:
- Use the steps, roles, fields and rules that the policy names. Keep the process small.
- Write every name, label and message in English. Money fields use EUR.
- The theme carries the bank name from the policy and primary_color "#0f4c45".
- Each check expression is a CEL boolean expression over the fields of the data model.
- Put the id of the paragraph that justifies an element in the citations of that node or check.
- Cite only paragraph ids you received. schema_version is "1".`

// PolicyToProcessUser formats the process name and the numbered
// paragraphs as the user message: the name line, one blank line, then
// one line per paragraph, in the given order.
func PolicyToProcessUser(name string, paragraphs []PolicyParagraph) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Process name: %s.\n\n", name)
	for i, p := range paragraphs {
		if i > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "%s: %s", p.ID, p.Text)
	}
	return b.String()
}
