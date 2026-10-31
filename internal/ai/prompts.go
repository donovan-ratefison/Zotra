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
case from the start to that edge. Each field value is one pair:
"field" is the field name, "value" is the JSON text of the value (a
number without quotes, a string with its quotes, an array, true or
false). Use only the field names and the decision values of the
process. Money and number values are numbers, integer values are
integers, document values are lists of strings, date values use the
RFC 3339 format.`

// GenerateTestsUser is the template of the user message. It takes
// the process summary and the red edges.
const GenerateTestsUser = `Process summary (JSON):
%s

Red edges (JSON array of edge ids):
%s

Write one test case per red edge. Each case holds the field values
of the start command as pairs and the command steps. A step has the
same shape as the case commands of the API:
{"type":"submit","values":[{"field":"...","value":"..."}]} or
{"type":"decide","decision":"..."} or
{"type":"sign","document_hash":"..."}.
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
- Cite only paragraph ids you received. schema_version is "1".
- Set not_a_policy_reason to null when the text is a bank credit policy.
- When the text is not a bank credit policy, set not_a_policy_reason to one short sentence that says what the text is, and return the smallest valid process: one start node, one end node with end_result "refused", and one edge.
` + ProcessFormatRules

// ProcessFormatRules states the semantic rules that the server checks
// after the JSON Schema. A model that knows them passes the checks at
// the first attempt more often.
const ProcessFormatRules = `Format rules that the server checks:
- Exactly one start node, and at least one end node. Each end node has an end_result.
- Each node is reachable from the start node and reaches an end node.
- A task without decisions has exactly one outgoing edge.
- A task with decisions has, for each decision, exactly one outgoing edge whose "decision" is that decision.
- A gateway has exactly one outgoing edge with "is_default": true. Each other edge of the gateway has a "condition". "is_default" is false on every edge that does not leave a gateway.
- "computed" is null for a value that a person enters. Else it is a CEL expression over other fields.
- CEL types: money and number fields are doubles, so write their literals with a decimal point (50000.0, 0.33). Integer fields use integer literals (300). Document fields are lists of strings (size(documents) >= 4). Date fields are timestamps (release_date >= now).`

// PolicyToProcessUser formats the numbered paragraphs as the user
// message: one line per paragraph, in the given order. The message has
// no process name, so the cache key depends on the paragraphs only.
func PolicyToProcessUser(paragraphs []PolicyParagraph) string {
	var b strings.Builder
	for i, p := range paragraphs {
		if i > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "%s: %s", p.ID, p.Text)
	}
	return b.String()
}

// ChangeProcessSystem is the system prompt of the assistant chat.
const ChangeProcessSystem = `You change a Zotra process file on request of a process designer.
You receive the current process file (JSON) and the change request.
Return the full new process file that satisfies the given schema. Rules:
- Make the requested change and only it. Keep every other element as it is: ids, names, order, citations.
- A new element gets a new unique id in the style of the file, and empty citations.
- Write every name, label and message in English. Money fields use EUR.
- Each check expression is a CEL boolean expression over the fields of the data model.
- If the request needs a new field, add it to the data model and to the scope of the step that writes it.
- schema_version is "1".` + "\n" + ProcessFormatRules

// ChangeProcessUser formats the current file and the request.
func ChangeProcessUser(definition, message string) string {
	return "Current process file (JSON):\n" + definition +
		"\n\nChange request: " + message
}

// SelectedStepNote tells the model which step "this step", "after
// this step" and "here" mean in the change request.
func SelectedStepNote(id, name string) string {
	return "\n\nSelected step: " + id + " (" + name + "). In the change request, \"this step\", \"after this step\" and \"here\" mean this step."
}

// RestateChangeSystem is the system prompt of the restate step of
// the assistant chat. The model only restates; the file stays as is.
const RestateChangeSystem = `You restate the change request of a process designer before the process changes.
You receive the current process file (JSON) and the change request.
Write one or two short sentences in plain English that say what will change. Use the names of the steps, roles and fields of the file. Start with "You want to".
Do not invent a step, a role or a field that the request does not name. Do not change the file.
Ask questions only when the answer changes the result. Rules for "questions":
- At most 3 questions, 2 to 5 options each. "questions" is empty when the request is clear.
- Build the options from the roles, documents, fields and usual deadlines of the file. Give each option a ref: "role:<id>", "document:<name>", "deadline:<hours>", "field:<name>", or "new:<text>" for an element that the file does not have.
- Tick the usual bank practice as the default. Four-eyes rule: a validation goes to another role than the role of the previous step. Give the reason of the default in one short line. "reason" is empty on the other options.
- "kind" is "single" when one answer fits, "multi" when several answers fit. "other" is true when a free answer can fit.
- Write in English. Do not use the em dash.`

// CompareVersionsSystem is the system prompt of the compare summary.
// The engine computes the changes; the model only summarizes them.
const CompareVersionsSystem = `You summarize the changes between two versions of a credit process for a bank clerk.
You receive one change on each line: "+" added, "-" removed, "~" changed.
Write at most 5 short sentences in plain English. Use the names of the lines.
Do not invent a change. Do not give advice.`
