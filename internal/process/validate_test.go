package process

import (
	"encoding/json"
	"os"
	"reflect"
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

// appendEdge appends one edge map to the edges array of the doc.
func appendEdge(doc map[string]any, edge map[string]any) {
	doc["edges"] = append(doc["edges"].([]any), edge)
}

// gatewayBase applies the gateway mutation of the brief to the slim
// base: node 1 becomes a gateway without role, edge e2 becomes the
// default edge, and edge e5 carries the gateway condition.
func gatewayBase(doc map[string]any) {
	nodes := doc["nodes"].([]any)
	form := nodes[1].(map[string]any)
	form["type"] = "gateway"
	form["role"] = nil
	edges := doc["edges"].([]any)
	edges[1].(map[string]any)["is_default"] = true
	appendEdge(doc, map[string]any{
		"id": "e5", "from": "form", "to": "refused", "label": nil,
		"decision": nil, "condition": "amount > 0.0", "is_default": false,
	})
}

func TestValidateGatewayBase(t *testing.T) {
	errs := Validate(inlineDoc(t, gatewayBase))
	if len(errs) != 0 {
		t.Fatalf("Validate gave %d errors: %+v", len(errs), errs)
	}
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
		{
			name: "scope unknown field",
			data: inlineDoc(t, func(doc map[string]any) {
				doc["scope"] = append(doc["scope"].([]any), map[string]any{
					"field": "ghost", "role": "advisor", "access": "read",
				})
			}),
			wantPrefix: "/scope/4/field",
			wantInMsg:  "unknown field ghost",
		},
		{
			name: "scope unknown role",
			data: inlineDoc(t, func(doc map[string]any) {
				doc["scope"] = append(doc["scope"].([]any), map[string]any{
					"field": "client_name", "role": "nobody", "access": "read",
				})
			}),
			wantPrefix: "/scope/4/role",
			wantInMsg:  "unknown role nobody",
		},
		{
			name: "scope override unknown field",
			data: inlineDoc(t, func(doc map[string]any) {
				nodes := doc["nodes"].([]any)
				nodes[1].(map[string]any)["scope_overrides"] = []any{
					map[string]any{"field": "ghost", "role": "advisor", "access": "write"},
				}
			}),
			wantPrefix: "/nodes/1/scope_overrides/0/field",
			wantInMsg:  "unknown field ghost",
		},
		{
			name: "scope override unknown role",
			data: inlineDoc(t, func(doc map[string]any) {
				nodes := doc["nodes"].([]any)
				nodes[1].(map[string]any)["scope_overrides"] = []any{
					map[string]any{"field": "amount", "role": "nobody", "access": "write"},
				}
			}),
			wantPrefix: "/nodes/1/scope_overrides/0/role",
			wantInMsg:  "unknown role nobody",
		},
		{
			name: "decision not declared",
			data: inlineDoc(t, func(doc map[string]any) {
				appendEdge(doc, map[string]any{
					"id": "e5", "from": "review", "to": "refused", "label": nil,
					"decision": "maybe", "condition": nil, "is_default": false,
				})
			}),
			wantPrefix: "/edges/4/decision",
			wantInMsg:  "maybe is not a decision of node review",
		},
		{
			name: "decision out of start",
			data: inlineDoc(t, func(doc map[string]any) {
				edges := doc["edges"].([]any)
				edges[0].(map[string]any)["decision"] = "ok"
			}),
			wantPrefix: "/edges/0/decision",
			wantInMsg:  "only allowed on an edge out of a task",
		},
		{
			name: "decision not in task decisions",
			data: inlineDoc(t, func(doc map[string]any) {
				edges := doc["edges"].([]any)
				edges[1].(map[string]any)["decision"] = "ok"
			}),
			wantPrefix: "/edges/1/decision",
			wantInMsg:  "ok is not a decision of node form",
		},
		{
			name: "condition out of task",
			data: inlineDoc(t, func(doc map[string]any) {
				edges := doc["edges"].([]any)
				edges[1].(map[string]any)["condition"] = "amount > 0.0"
			}),
			wantPrefix: "/edges/1/condition",
			wantInMsg:  "only allowed on an edge out of a gateway",
		},
		{
			name: "is_default out of task",
			data: inlineDoc(t, func(doc map[string]any) {
				edges := doc["edges"].([]any)
				edges[1].(map[string]any)["is_default"] = true
			}),
			wantPrefix: "/edges/1/is_default",
			wantInMsg:  "only allowed on an edge out of a gateway",
		},
		{
			name: "gateway edge without condition",
			data: inlineDoc(t, func(doc map[string]any) {
				gatewayBase(doc)
				edges := doc["edges"].([]any)
				edges[4].(map[string]any)["condition"] = nil
			}),
			wantPrefix: "/edges/4/condition",
			wantInMsg:  "needs a condition",
		},
		{
			name: "default edge with condition",
			data: inlineDoc(t, func(doc map[string]any) {
				gatewayBase(doc)
				edges := doc["edges"].([]any)
				edges[1].(map[string]any)["condition"] = "amount > 0.0"
			}),
			wantPrefix: "/edges/1/condition",
			wantInMsg:  "must have a null condition",
		},
		{
			name: "start two outgoing edges",
			data: inlineDoc(t, func(doc map[string]any) {
				appendEdge(doc, map[string]any{
					"id": "e5", "from": "start", "to": "review", "label": nil,
					"decision": nil, "condition": nil, "is_default": false,
				})
			}),
			wantPrefix: "/nodes/0",
			wantInMsg:  "exactly one outgoing edge, found 2",
		},
		{
			name: "start incoming edge",
			data: inlineDoc(t, func(doc map[string]any) {
				nodes := doc["nodes"].([]any)
				nodes[3].(map[string]any)["decisions"] = []any{"ok", "ko", "back"}
				appendEdge(doc, map[string]any{
					"id": "e5", "from": "review", "to": "start", "label": nil,
					"decision": "back", "condition": nil, "is_default": false,
				})
			}),
			wantPrefix: "/nodes/0",
			wantInMsg:  "no incoming edge, found 1",
		},
		{
			name: "end outgoing edge",
			data: inlineDoc(t, func(doc map[string]any) {
				appendEdge(doc, map[string]any{
					"id": "e5", "from": "approved", "to": "form", "label": nil,
					"decision": nil, "condition": nil, "is_default": false,
				})
			}),
			wantPrefix: "/nodes/2",
			wantInMsg:  "no outgoing edge, found 1",
		},
		{
			name: "enum without options",
			data: inlineDoc(t, func(doc map[string]any) {
				fields := doc["fields"].([]any)
				fields[0].(map[string]any)["type"] = "enum"
			}),
			wantPrefix: "/fields/0/options",
			wantInMsg:  "at least one option",
		},
		{
			name: "non-enum with options",
			data: inlineDoc(t, func(doc map[string]any) {
				fields := doc["fields"].([]any)
				fields[1].(map[string]any)["options"] = []any{"x"}
			}),
			wantPrefix: "/fields/1/options",
			wantInMsg:  "only an enum field",
		},
		{
			name: "duplicate check id",
			data: inlineDoc(t, func(doc map[string]any) {
				check := map[string]any{
					"id": "c1", "expression": "amount > 0.0", "message": "m",
					"plain_text": nil, "citations": []any{},
				}
				nodes := doc["nodes"].([]any)
				nodes[1].(map[string]any)["checks"] = []any{check}
				nodes[3].(map[string]any)["checks"] = []any{check}
			}),
			wantPrefix: "/nodes/3/checks/0/id",
			wantInMsg:  "duplicate check id c1",
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

// sourcesDefinition is the base fixture of the source rows: one task
// node entry that lists the two sources and one check that reads one.
const sourcesDefinition = `{
  "schema_version": "1",
  "name": "Sources",
  "currency": "EUR",
  "policy_document_id": null,
  "theme": {"brand_name": "Sources", "primary_color": "#111111", "logo_url": null},
  "roles": [{"id": "advisor", "name": "Advisor", "department": "Branch"}],
  "fields": [{"name": "amount", "label": "Amount", "type": "money", "options": [], "computed": null}],
  "scope": [{"field": "amount", "role": "advisor", "access": "write"}],
  "nodes": [
    {"id": "start", "type": "start", "name": "Start", "role": null, "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": [], "end_result": null,
     "scope_overrides": [], "source_ids": [], "citations": []},
    {"id": "entry", "type": "task", "name": "Entry", "role": "advisor", "deadline_hours": null,
     "documents": [], "signature": false,
     "checks": [{"id": "c1", "expression": "blacklist.listed == false",
       "message": "The client is on the blacklist.", "plain_text": null, "citations": []}],
     "decisions": [], "end_result": null,
     "scope_overrides": [], "source_ids": ["blacklist", "loans"], "citations": []},
    {"id": "end", "type": "end", "name": "End", "role": null, "deadline_hours": null,
     "documents": [], "signature": false, "checks": [], "decisions": [], "end_result": "approved",
     "scope_overrides": [], "source_ids": [], "citations": []}
  ],
  "edges": [
    {"id": "e1", "from": "start", "to": "entry", "label": null, "decision": null, "condition": null, "is_default": false},
    {"id": "e2", "from": "entry", "to": "end", "label": null, "decision": null, "condition": null, "is_default": false}
  ],
  "sources": [
    {"id": "blacklist", "name": "Credit blacklist", "url": "http://core.example/api/blacklist",
     "test_values": {"listed": false}},
    {"id": "loans", "name": "Existing loans", "url": "http://core.example/api/loans",
     "test_values": {"monthly_total": 0}}
  ]
}`

// sourcesDoc applies one mutation to the sources fixture and returns
// the bytes.
func sourcesDoc(t *testing.T, mutate func(doc map[string]any)) []byte {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(sourcesDefinition), &doc); err != nil {
		t.Fatalf("unmarshal sources fixture: %v", err)
	}
	mutate(doc)
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal mutated doc: %v", err)
	}
	return data
}

// P1.
func TestSourcesDecode(t *testing.T) {
	def, err := Decode([]byte(sourcesDefinition))
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if len(def.Sources) != 2 {
		t.Fatalf("sources = %d, want 2", len(def.Sources))
	}
	src := def.Sources[0]
	if src.ID != "blacklist" || src.Name != "Credit blacklist" ||
		src.URL != "http://core.example/api/blacklist" || src.TestValues["listed"] != false {
		t.Errorf("source 0 = %+v, want the blacklist source", src)
	}
	null := sourcesDoc(t, func(doc map[string]any) { doc["sources"] = nil })
	def, err = Decode(null)
	if err != nil {
		t.Fatalf("Decode with null sources: %v", err)
	}
	if def.Sources == nil || len(def.Sources) != 0 {
		t.Errorf("sources = %#v, want an empty slice", def.Sources)
	}
}

// P1b.
func TestJSONSchemaClosesSources(t *testing.T) {
	sources := JSONSchema()["properties"].(map[string]any)["sources"].(map[string]any)
	if sources["items"] != false {
		t.Errorf("AI schema sources items = %v, want false", sources["items"])
	}
	var file map[string]any
	if err := json.Unmarshal(schemaJSON, &file); err != nil {
		t.Fatal(err)
	}
	item, ok := file["properties"].(map[string]any)["sources"].(map[string]any)["items"].(map[string]any)
	if !ok {
		t.Fatal("schema file sources items is not an object")
	}
	if _, ok := item["properties"].(map[string]any)["test_values"]; !ok {
		t.Error("schema file sources item has no test_values")
	}
}

// P2.
func TestValidateSources(t *testing.T) {
	if errs := Validate([]byte(sourcesDefinition)); len(errs) != 0 {
		t.Fatalf("base fixture gave %d errors: %+v", len(errs), errs)
	}
	source := func(doc map[string]any, i int) map[string]any {
		return doc["sources"].([]any)[i].(map[string]any)
	}
	node := func(doc map[string]any, i int) map[string]any {
		return doc["nodes"].([]any)[i].(map[string]any)
	}
	tests := []struct {
		name   string
		mutate func(doc map[string]any)
		want   []Error
	}{
		{"duplicate id", func(doc map[string]any) { source(doc, 1)["id"] = "blacklist" }, []Error{
			{"/sources/1/id", "duplicate source id blacklist"},
			{"/nodes/1/source_ids/1", "node references unknown source loans"},
		}},
		{"bad id", func(doc map[string]any) { source(doc, 0)["id"] = "1st" }, []Error{
			{"/sources/0/id", "source id 1st must match ^[a-z][a-z0-9_]*$"},
			{"/nodes/1/source_ids/0", "node references unknown source blacklist"},
		}},
		{"field name", func(doc map[string]any) { source(doc, 0)["id"] = "amount" }, []Error{
			{"/sources/0/id", "source id amount is already a field name"},
			{"/nodes/1/source_ids/0", "node references unknown source blacklist"},
		}},
		{"reserved name", func(doc map[string]any) { source(doc, 0)["id"] = "now" }, []Error{
			{"/sources/0/id", "source id now is a reserved name"},
			{"/nodes/1/source_ids/0", "node references unknown source blacklist"},
		}},
		{"ftp url", func(doc map[string]any) { source(doc, 0)["url"] = "ftp://x" }, []Error{
			{"/sources/0/url", "source url must have an http or https scheme and a host"},
		}},
		{"url does not parse", func(doc map[string]any) { source(doc, 0)["url"] = "://x" }, []Error{
			{"/sources/0/url", `invalid source url: parse "://x": missing protocol scheme`},
		}},
		{"empty host", func(doc map[string]any) { source(doc, 0)["url"] = "http://" }, []Error{
			{"/sources/0/url", "source url must have an http or https scheme and a host"},
		}},
		{"unknown entry", func(doc map[string]any) {
			node(doc, 1)["source_ids"] = []any{"ghost", "loans"}
		}, []Error{
			{"/nodes/1/source_ids/0", "node references unknown source ghost"},
		}},
		{"duplicate entry", func(doc map[string]any) {
			node(doc, 1)["source_ids"] = []any{"blacklist", "blacklist"}
		}, []Error{
			{"/nodes/1/source_ids/1", "duplicate source blacklist in source_ids"},
		}},
		{"entry on start", func(doc map[string]any) {
			node(doc, 0)["source_ids"] = []any{"blacklist"}
		}, []Error{
			{"/nodes/0/source_ids", "only a task node can list sources"},
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Validate(sourcesDoc(t, tt.mutate))
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("errors = %+v, want %+v", got, tt.want)
			}
		})
	}
}
