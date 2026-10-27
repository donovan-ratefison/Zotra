// Package ai: the prompts of the AI features, as Go string
// constants, in English.
package ai

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
