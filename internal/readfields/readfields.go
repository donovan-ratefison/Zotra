// Package readfields reads the fields of one document scan: the
// strict answer schema of the reading, and the parser of the Chat
// Completions answer. The route POST /api/documents/{id}/read uses
// both.
package readfields

import (
	"encoding/json"
	"fmt"
)

// Field is one field to read from a scan. The three values come from
// the data model of the process: the name, the label shown to the
// user, and the field type of plan section 2.
type Field struct {
	Name  string `json:"name"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

// jsonType gives the JSON type of one field type. An unknown field
// type gives "string".
func jsonType(fieldType string) string {
	switch fieldType {
	case "number", "money":
		return "number"
	case "integer":
		return "integer"
	case "boolean":
		return "boolean"
	default:
		// string, enum, date, and every unknown type.
		return "string"
	}
}

// SchemaFor builds the strict answer schema of the reading: one
// property per field, required, each of type [<json>, "null"]. The
// document type holds an array of strings. The strict rules of plan
// section 2 apply: every property required, no free keys.
func SchemaFor(fields []Field) map[string]any {
	props := map[string]any{}
	names := make([]string, 0, len(fields))
	for _, f := range fields {
		if f.Type == "document" {
			props[f.Name] = map[string]any{
				"type":  []string{"array", "null"},
				"items": map[string]any{"type": "string"},
			}
		} else {
			props[f.Name] = map[string]any{
				"type": []string{jsonType(f.Type), "null"},
			}
		}
		names = append(names, f.Name)
	}
	return map[string]any{
		"type":                 "object",
		"properties":           props,
		"required":             names,
		"additionalProperties": false,
	}
}

// answerEnvelope is the Chat Completions answer shape. The content
// sits in choices[0].message.content (lesson 85). The content is a
// pointer, so a missing key differs from an empty string.
type answerEnvelope struct {
	Choices []struct {
		Message struct {
			Content *string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// ParseValues reads one Chat Completions answer and returns the
// values by field name. A key outside the requested names is an
// error: the schema forbids it, and the fill must not invent form
// keys. The values keep their JSON value (string, number, boolean or
// null).
func ParseValues(body []byte, fields []Field) (map[string]any, error) {
	var env answerEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("cannot parse the values: %v", err)
	}
	if len(env.Choices) == 0 {
		return nil, fmt.Errorf("cannot parse the values: no answer")
	}
	content := env.Choices[0].Message.Content
	if content == nil {
		return nil, fmt.Errorf("cannot parse the values: no content")
	}
	var values map[string]any
	if err := json.Unmarshal([]byte(*content), &values); err != nil {
		return nil, fmt.Errorf("cannot parse the values: %v", err)
	}
	asked := make(map[string]bool, len(fields))
	for _, f := range fields {
		asked[f.Name] = true
	}
	for k := range values {
		if !asked[k] {
			return nil, fmt.Errorf("unexpected field %s", k)
		}
	}
	return values, nil
}
