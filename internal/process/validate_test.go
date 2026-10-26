package process

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestValidateExample(t *testing.T) {
	data, err := os.ReadFile("../../examples/home-loan/process.json")
	if err != nil {
		t.Fatalf("read example: %v", err)
	}
	if errs := Validate(data); len(errs) != 0 {
		t.Fatalf("Validate gave %d errors: %+v", len(errs), errs)
	}
	def, err := Decode(data)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if len(def.Roles) != 5 {
		t.Errorf("roles = %d, want 5", len(def.Roles))
	}
	if len(def.Fields) != 14 {
		t.Errorf("fields = %d, want 14", len(def.Fields))
	}
	if len(def.Nodes) != 11 {
		t.Errorf("nodes = %d, want 11", len(def.Nodes))
	}
	if len(def.Edges) != 14 {
		t.Errorf("edges = %d, want 14", len(def.Edges))
	}
	if def.Sources == nil {
		t.Error("Sources is nil, want an empty slice")
	}
	if def.Fields[0].Options == nil {
		t.Error("Options of client_name is nil, want an empty slice")
	}
	first := def.Nodes[0]
	if first.Documents == nil || first.Checks == nil || first.Decisions == nil ||
		first.ScopeOverrides == nil || first.SourceIDs == nil || first.Citations == nil {
		t.Error("a slice of the first node is nil, want an empty slice")
	}
}

const slimBase = `{
  "schema_version": "1",
  "name": "Slim",
  "currency": "EUR",
  "policy_document_id": null,
  "theme": {"brand_name": "Slim", "primary_color": "#111111", "logo_url": null},
  "roles": [
    {"id": "advisor", "name": "Advisor", "department": "Branch"},
    {"id": "analyst", "name": "Analyst", "department": "Risk"}
  ],
  "fields": [
    {"name": "client_name", "label": "Client name", "type": "string", "options": [], "computed": null},
    {"name": "amount", "label": "Amount", "type": "money", "options": [], "computed": null}
  ],
  "scope": [
    {"field": "client_name", "role": "advisor", "access": "write"},
    {"field": "client_name", "role": "analyst", "access": "read"},
    {"field": "amount", "role": "advisor", "access": "write"},
    {"field": "amount", "role": "analyst", "access": "read"}
  ],
  "nodes": [
    {"id": "start", "type": "start", "name": "Start", "role": null, "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": [], "end_result": null,
     "scope_overrides": [], "source_ids": [], "citations": []},
    {"id": "form", "type": "task", "name": "Form", "role": "advisor", "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": [], "end_result": null,
     "scope_overrides": [], "source_ids": [], "citations": []},
    {"id": "approved", "type": "end", "name": "Approved", "role": null, "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": [], "end_result": "approved",
     "scope_overrides": [], "source_ids": [], "citations": []},
    {"id": "review", "type": "task", "name": "Review", "role": "analyst", "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": ["ok", "ko"], "end_result": null,
     "scope_overrides": [], "source_ids": [], "citations": []},
    {"id": "refused", "type": "end", "name": "Refused", "role": null, "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": [], "end_result": "refused",
     "scope_overrides": [], "source_ids": [], "citations": []}
  ],
  "edges": [
    {"id": "e1", "from": "start", "to": "form", "label": null, "decision": null, "condition": null, "is_default": false},
    {"id": "e2", "from": "form", "to": "review", "label": null, "decision": null, "condition": null, "is_default": false},
    {"id": "e3", "from": "review", "to": "approved", "label": null, "decision": "ok", "condition": null, "is_default": false},
    {"id": "e4", "from": "review", "to": "refused", "label": null, "decision": "ko", "condition": null, "is_default": false}
  ],
  "sources": []
}`

// inlineDoc applies one mutation to the slim base and returns the bytes.
func inlineDoc(t *testing.T, mutate func(doc map[string]any)) []byte {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(slimBase), &doc); err != nil {
		t.Fatalf("unmarshal slim base: %v", err)
	}
	mutate(doc)
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal mutated doc: %v", err)
	}
	return data
}

func TestValidateInvalid(t *testing.T) {
	tests := []struct {
		name       string
		file       string
		data       []byte
		wantPrefix string
		wantInMsg  string
	}{
		{name: "two starts", file: "testdata/invalid/01-two-starts.json", wantPrefix: "/nodes/1"},
		{name: "no start", file: "testdata/invalid/02-no-start.json", wantPrefix: "/nodes"},
		{name: "no end", file: "testdata/invalid/03-no-end.json", wantPrefix: "/nodes"},
		{name: "end null result", file: "testdata/invalid/04-end-null-result.json", wantPrefix: "/nodes/2/end_result"},
		{name: "task no role", file: "testdata/invalid/05-task-no-role.json", wantPrefix: "/nodes/1/role"},
		{name: "task two edges", file: "testdata/invalid/06-task-two-edges.json", wantPrefix: "/nodes/1"},
		{name: "task missing decision edge", file: "testdata/invalid/07-task-missing-decision-edge.json", wantPrefix: "/nodes/1"},
		{name: "gateway no default", file: "testdata/invalid/08-gateway-no-default.json", wantPrefix: "/nodes/1", wantInMsg: "found 0"},
		{name: "gateway two defaults", file: "testdata/invalid/09-gateway-two-defaults.json", wantPrefix: "/nodes/1", wantInMsg: "found 2"},
		{name: "unreachable node", file: "testdata/invalid/10-unreachable-node.json", wantPrefix: "/nodes/3"},
		{name: "no path to end", file: "testdata/invalid/11-no-path-to-end.json", wantPrefix: "/nodes/2"},
		{name: "bad citation", file: "testdata/invalid/12-bad-citation.json", wantPrefix: "/nodes/1/citations/0"},
		{
			name: "schema rejects extra property",
			data: inlineDoc(t, func(doc map[string]any) {
				nodes := doc["nodes"].([]any)
				nodes[1].(map[string]any)["extra"] = true
			}),
			wantPrefix: "/nodes/1",
			wantInMsg:  "extra",
		},
		{
			name: "schema rejects missing property",
			data: inlineDoc(t, func(doc map[string]any) {
				edges := doc["edges"].([]any)
				delete(edges[0].(map[string]any), "id")
			}),
			wantPrefix: "/edges/0",
		},
		{
			name: "schema rejects bad field name",
			data: inlineDoc(t, func(doc map[string]any) {
				fields := doc["fields"].([]any)
				fields[0].(map[string]any)["name"] = "Amount"
			}),
			wantPrefix: "/fields/0/name",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var data []byte
			if tt.file != "" {
				read, err := os.ReadFile(tt.file)
				if err != nil {
					t.Fatalf("read fixture: %v", err)
				}
				data = read
			} else {
				data = tt.data
			}
			errs := Validate(data)
			if len(errs) == 0 {
				t.Fatal("Validate gave no error, want at least one")
			}
			if !strings.HasPrefix(errs[0].Path, tt.wantPrefix) {
				t.Errorf("first error path = %q, want prefix %q (message: %s)",
					errs[0].Path, tt.wantPrefix, errs[0].Message)
			}
			if tt.wantInMsg != "" && !strings.Contains(errs[0].Message, tt.wantInMsg) {
				t.Errorf("first error message = %q, want it to contain %q", errs[0].Message, tt.wantInMsg)
			}
		})
	}
}
