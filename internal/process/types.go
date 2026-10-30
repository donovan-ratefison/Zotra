// Package process holds the process file format: types, JSON Schema
// and validation.
package process

// Definition is one process version: one JSON document. The same JSON
// Schema validates the import, the AI output and the editor.
type Definition struct {
	SchemaVersion    string   `json:"schema_version"`
	Name             string   `json:"name"`
	Currency         string   `json:"currency"`
	PolicyDocumentID *string  `json:"policy_document_id"`
	Theme            Theme    `json:"theme"`
	Roles            []Role   `json:"roles"`
	Fields           []Field  `json:"fields"`
	Scope            []Scope  `json:"scope"`
	Nodes            []Node   `json:"nodes"`
	Edges            []Edge   `json:"edges"`
	Sources          []Source `json:"sources"`
}

// Source is one external HTTP JSON source. The engine fetches it when
// a case enters a task node that lists its id. A test case reads
// TestValues in place of the network.
type Source struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	URL        string         `json:"url"`
	TestValues map[string]any `json:"test_values"`
}

// Theme carries the brand of the delivered app.
type Theme struct {
	BrandName    string  `json:"brand_name"`
	PrimaryColor string  `json:"primary_color"`
	LogoURL      *string `json:"logo_url"`
}

// Role is one participant of the process.
type Role struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Department string `json:"department"`
}

// Field is one entry of the data model.
type Field struct {
	Name     string   `json:"name"`
	Label    string   `json:"label"`
	Type     string   `json:"type"`
	Options  []string `json:"options"`
	Computed *string  `json:"computed"`
}

// Scope is one entry of the field access matrix.
type Scope struct {
	Field  string `json:"field"`
	Role   string `json:"role"`
	Access string `json:"access"`
}

// Node is one step of the process. All nodes share one shape; the
// Type field decides.
type Node struct {
	ID             string   `json:"id"`
	Type           string   `json:"type"`
	Name           string   `json:"name"`
	Role           *string  `json:"role"`
	DeadlineHours  *int     `json:"deadline_hours"`
	Documents      []string `json:"documents"`
	Signature      bool     `json:"signature"`
	Checks         []Check  `json:"checks"`
	Decisions      []string `json:"decisions"`
	EndResult      *string  `json:"end_result"`
	ScopeOverrides []Scope  `json:"scope_overrides"`
	SourceIDs      []string `json:"source_ids"`
	Citations      []string `json:"citations"`
}

// Check is one CEL rule of a node. Its expression must have result bool.
type Check struct {
	ID         string   `json:"id"`
	Expression string   `json:"expression"`
	Message    string   `json:"message"`
	PlainText  *string  `json:"plain_text"`
	Citations  []string `json:"citations"`
}

// Edge is one link between two nodes.
type Edge struct {
	ID        string  `json:"id"`
	From      string  `json:"from"`
	To        string  `json:"to"`
	Label     *string `json:"label"`
	Decision  *string `json:"decision"`
	Condition *string `json:"condition"`
	IsDefault bool    `json:"is_default"`
}

// normalize replaces every nil slice with the empty slice, so that
// the engine can range over it.
func normalize(def *Definition) {
	set := func(s []string) []string {
		if s == nil {
			return []string{}
		}
		return s
	}
	if def.Sources == nil {
		def.Sources = []Source{}
	}
	if def.Roles == nil {
		def.Roles = []Role{}
	}
	if def.Fields == nil {
		def.Fields = []Field{}
	}
	if def.Scope == nil {
		def.Scope = []Scope{}
	}
	if def.Nodes == nil {
		def.Nodes = []Node{}
	}
	if def.Edges == nil {
		def.Edges = []Edge{}
	}
	for i := range def.Fields {
		def.Fields[i].Options = set(def.Fields[i].Options)
	}
	for i := range def.Nodes {
		n := &def.Nodes[i]
		n.Documents = set(n.Documents)
		n.Decisions = set(n.Decisions)
		n.SourceIDs = set(n.SourceIDs)
		n.Citations = set(n.Citations)
		if n.Checks == nil {
			n.Checks = []Check{}
		}
		if n.ScopeOverrides == nil {
			n.ScopeOverrides = []Scope{}
		}
		for j := range n.Checks {
			n.Checks[j].Citations = set(n.Checks[j].Citations)
		}
	}
}
