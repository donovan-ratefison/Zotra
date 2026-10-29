package readfields

// The tests of the field reading: the schema builder and the answer
// parser. The rows G1 to G5 follow the brief.

import (
	"encoding/json"
	"reflect"
	"testing"
)

// choices builds one Chat Completions answer body: the given text
// sits in choices[0].message.content, as a JSON string.
func choices(text string) []byte {
	env := map[string]any{
		"choices": []map[string]any{
			{"message": map[string]any{"content": text}},
		},
	}
	b, err := json.Marshal(env)
	if err != nil {
		panic(err)
	}
	return b
}

// G1.
func TestSchemaFor(t *testing.T) {
	fields := []Field{
		{Name: "client_name", Label: "Client name", Type: "string"},
		{Name: "kind", Label: "Kind", Type: "enum"},
		{Name: "signed_on", Label: "Signed on", Type: "date"},
		{Name: "annual_rate", Label: "Annual rate", Type: "number"},
		{Name: "amount", Label: "Amount", Type: "money"},
		{Name: "duration_months", Label: "Duration", Type: "integer"},
		{Name: "ok", Label: "Ready", Type: "boolean"},
		{Name: "docs", Label: "Documents", Type: "document"},
		{Name: "alien", Label: "Alien", Type: "alien"},
	}
	schema := SchemaFor(fields)
	if schema["type"] != "object" {
		t.Errorf("type = %v, want object", schema["type"])
	}
	if schema["additionalProperties"] != false {
		t.Errorf("additionalProperties = %v, want false", schema["additionalProperties"])
	}
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("properties = %v, want a map", schema["properties"])
	}
	want := map[string]any{
		"client_name":     map[string]any{"type": []string{"string", "null"}},
		"kind":            map[string]any{"type": []string{"string", "null"}},
		"signed_on":       map[string]any{"type": []string{"string", "null"}},
		"annual_rate":     map[string]any{"type": []string{"number", "null"}},
		"amount":          map[string]any{"type": []string{"number", "null"}},
		"duration_months": map[string]any{"type": []string{"integer", "null"}},
		"ok":              map[string]any{"type": []string{"boolean", "null"}},
		"alien":           map[string]any{"type": []string{"string", "null"}},
		"docs": map[string]any{
			"type":  []string{"array", "null"},
			"items": map[string]any{"type": "string"},
		},
	}
	if len(props) != len(want) {
		t.Fatalf("properties = %d keys, want %d", len(props), len(want))
	}
	for name, w := range want {
		got, ok := props[name]
		if !ok {
			t.Fatalf("property %s is missing", name)
		}
		if !reflect.DeepEqual(got, w) {
			t.Errorf("property %s = %v, want %v", name, got, w)
		}
	}
	required, ok := schema["required"].([]string)
	if !ok {
		t.Fatalf("required = %v, want a []string", schema["required"])
	}
	if !reflect.DeepEqual(required, []string{
		"client_name", "kind", "signed_on", "annual_rate", "amount",
		"duration_months", "ok", "docs", "alien",
	}) {
		t.Errorf("required = %v, want the field names in input order", required)
	}
}

// G2.
func TestParseValues(t *testing.T) {
	fields := []Field{
		{Name: "amount", Label: "Amount", Type: "money"},
		{Name: "ok", Label: "Ready", Type: "boolean"},
	}
	values, err := ParseValues(choices(`{"amount":240000,"ok":null}`), fields)
	if err != nil {
		t.Fatalf("ParseValues: %v", err)
	}
	amount, ok := values["amount"].(float64)
	if !ok || amount != 240000 {
		t.Errorf("amount = %v, want 240000", values["amount"])
	}
	if v, ok := values["ok"]; !ok || v != nil {
		t.Errorf("ok = %v, want nil", values["ok"])
	}
}

// G3.
func TestParseValuesUnexpectedField(t *testing.T) {
	fields := []Field{{Name: "amount", Label: "Amount", Type: "money"}}
	_, err := ParseValues(choices(`{"ghost":1}`), fields)
	if err == nil || err.Error() != "unexpected field ghost" {
		t.Errorf("err = %v, want unexpected field ghost", err)
	}
}

// G4.
func TestParseValuesEnvelopeErrors(t *testing.T) {
	fields := []Field{{Name: "amount", Label: "Amount", Type: "money"}}
	rows := []struct {
		body string
		want string
	}{
		{`{}`, "cannot parse the values: no answer"},
		{`{"choices":[]}`, "cannot parse the values: no answer"},
		{`{"choices":[{"message":{}}]}`, "cannot parse the values: no content"},
		{`{"choices":[{"message":{"content":"[1,2]"}}]}`,
			"cannot parse the values: json: cannot unmarshal array " +
				"into Go value of type map[string]interface {}"},
	}
	for _, row := range rows {
		_, err := ParseValues([]byte(row.body), fields)
		if err == nil || err.Error() != row.want {
			t.Errorf("ParseValues(%s) err = %v, want %s", row.body, err, row.want)
		}
	}
}

// G5.
func TestParseValuesBadContent(t *testing.T) {
	fields := []Field{{Name: "amount", Label: "Amount", Type: "money"}}
	_, err := ParseValues(choices(`{oops`), fields)
	want := "cannot parse the values: invalid character 'o' " +
		"looking for beginning of object key string"
	if err == nil || err.Error() != want {
		t.Errorf("err = %v, want %s", err, want)
	}
}
