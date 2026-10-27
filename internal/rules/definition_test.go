package rules

import (
	"bytes"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/donovan-ratefison/zotra/internal/process"
)

// exampleDefinition reads examples/home-loan/process.json and decodes
// it. Each test row changes one value of the decoded struct.
func exampleDefinition(t *testing.T) process.Definition {
	t.Helper()
	data, err := os.ReadFile("../../examples/home-loan/process.json")
	if err != nil {
		t.Fatalf("read example: %v", err)
	}
	def, err := process.Decode(data)
	if err != nil {
		t.Fatalf("decode example: %v", err)
	}
	return def
}

// strptr gives a pointer to s, for the *string fields of the format.
func strptr(s string) *string {
	return &s
}

func TestCheckDefinition(t *testing.T) {
	tests := []struct {
		name           string
		change         func(def *process.Definition)
		wantPath       string
		wantPart       string
		wantCount      int
		wantSecondPath string
	}{
		{
			name:      "example is valid",
			change:    func(def *process.Definition) {},
			wantCount: 0,
		},
		{
			name: "check expression does not compile",
			change: func(def *process.Definition) {
				def.Nodes[1].Checks[0].Expression = "foo >"
			},
			wantPath:  "/nodes/1/checks/0/expression",
			wantPart:  "compile",
			wantCount: 1,
		},
		{
			name: "check expression is not bool",
			change: func(def *process.Definition) {
				def.Nodes[1].Checks[0].Expression = "amount"
			},
			wantPath:  "/nodes/1/checks/0/expression",
			wantPart:  "want bool",
			wantCount: 1,
		},
		{
			name: "edge condition is not bool",
			change: func(def *process.Definition) {
				def.Edges[2].Condition = strptr("size(documents)")
			},
			wantPath:  "/edges/2/condition",
			wantPart:  "want bool",
			wantCount: 1,
		},
		{
			name: "edge condition uses an unknown name",
			change: func(def *process.Definition) {
				def.Edges[6].Condition = strptr("ghost > 1.0")
			},
			wantPath:  "/edges/6/condition",
			wantPart:  "compile",
			wantCount: 1,
		},
		{
			name: "computed expression has the wrong type",
			change: func(def *process.Definition) {
				def.Fields[7].Computed = strptr("client_name")
			},
			wantPath:  "/fields/7/computed",
			wantPart:  "want double",
			wantCount: 1,
		},
		{
			name: "two computed fields on a cycle",
			change: func(def *process.Definition) {
				def.Fields[7].Computed = strptr("debt_ratio * monthly_income")
			},
			wantPath:       "/fields/7/computed",
			wantPart:       "is in a cycle",
			wantCount:      2,
			wantSecondPath: "/fields/8/computed",
		},
		{
			name: "computed field uses itself",
			change: func(def *process.Definition) {
				def.Fields[8].Computed = strptr("debt_ratio + 1.0")
			},
			wantPath:  "/fields/8/computed",
			wantPart:  "is in a cycle",
			wantCount: 1,
		},
		{
			name: "computed expression does not compile",
			change: func(def *process.Definition) {
				def.Fields[7].Computed = strptr("foo >")
			},
			wantPath:  "/fields/7/computed",
			wantPart:  "compile",
			wantCount: 1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := exampleDefinition(t)
			tt.change(&def)
			got := CheckDefinition(def)
			if got == nil {
				t.Fatal("CheckDefinition returned nil, want an empty slice")
			}
			if len(got) != tt.wantCount {
				t.Fatalf("got %d errors %v, want %d", len(got), got, tt.wantCount)
			}
			if tt.wantCount == 0 {
				return
			}
			if got[0].Path != tt.wantPath {
				t.Errorf("first path %q, want %q", got[0].Path, tt.wantPath)
			}
			if !strings.Contains(got[0].Message, tt.wantPart) {
				t.Errorf("first message %q, want it to contain %q", got[0].Message, tt.wantPart)
			}
			if tt.wantSecondPath != "" && got[1].Path != tt.wantSecondPath {
				t.Errorf("second path %q, want %q", got[1].Path, tt.wantSecondPath)
			}
		})
	}
}

func TestComputedOrder(t *testing.T) {
	tests := []struct {
		name        string
		change      func(def *process.Definition)
		wantOrder   []string
		wantErrPart string
	}{
		{
			name:      "example order",
			change:    func(def *process.Definition) {},
			wantOrder: []string{"monthly_payment", "debt_ratio"},
		},
		{
			name: "swapped fields keep the dependency order",
			change: func(def *process.Definition) {
				def.Fields[7], def.Fields[8] = def.Fields[8], def.Fields[7]
			},
			wantOrder: []string{"monthly_payment", "debt_ratio"},
		},
		{
			name: "cycle gives an error",
			change: func(def *process.Definition) {
				def.Fields[7].Computed = strptr("debt_ratio * monthly_income")
			},
			wantErrPart: "cycle",
		},
		{
			name: "expression that does not compile gives an error",
			change: func(def *process.Definition) {
				def.Fields[7].Computed = strptr("foo >")
			},
			wantErrPart: "compile",
		},
		{
			name: "no computed field gives an empty slice, not nil",
			change: func(def *process.Definition) {
				def.Fields[7].Computed = nil
				def.Fields[8].Computed = nil
			},
			wantOrder: []string{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := exampleDefinition(t)
			tt.change(&def)
			got, err := ComputedOrder(def)
			if tt.wantErrPart != "" {
				if err == nil {
					t.Fatalf("ComputedOrder gave no error, want one that contains %q", tt.wantErrPart)
				}
				if !strings.Contains(err.Error(), tt.wantErrPart) {
					t.Errorf("error %q, want it to contain %q", err.Error(), tt.wantErrPart)
				}
				return
			}
			if err != nil {
				t.Fatalf("ComputedOrder: %v", err)
			}
			if got == nil {
				t.Fatal("ComputedOrder returned nil, want an empty slice")
			}
			if !slices.Equal(got, tt.wantOrder) {
				t.Errorf("order %v, want %v", got, tt.wantOrder)
			}
		})
	}
}

func TestValidateDocument(t *testing.T) {
	example, err := os.ReadFile("../../examples/home-loan/process.json")
	if err != nil {
		t.Fatalf("read example: %v", err)
	}
	// wantCount of -1: do not check the count, only the first path.
	tests := []struct {
		name      string
		data      []byte
		wantCount int
		wantPath  string
	}{
		{
			name:      "example is valid",
			data:      example,
			wantCount: 0,
		},
		{
			name:      "invalid JSON",
			data:      []byte("{"),
			wantCount: 1,
			wantPath:  "",
		},
		{
			name:      "schema error stops before the rules",
			data:      bytes.Replace(example, []byte(`"schema_version": "1"`), []byte(`"schema_version": "2"`), 1),
			wantCount: -1,
			wantPath:  "/schema_version",
		},
		{
			name:      "rule 5 error through the entry point",
			data:      bytes.Replace(example, []byte("amount > 0.0 && duration_months <= 300"), []byte("foo >"), 1),
			wantCount: -1,
			wantPath:  "/nodes/1/checks/0/expression",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ValidateDocument(tt.data)
			if got == nil {
				t.Fatal("ValidateDocument returned nil, want an empty slice")
			}
			if tt.wantCount >= 0 && len(got) != tt.wantCount {
				t.Fatalf("got %d errors %v, want %d", len(got), got, tt.wantCount)
			}
			if tt.wantCount != 0 && got[0].Path != tt.wantPath {
				t.Errorf("first path %q, want %q", got[0].Path, tt.wantPath)
			}
		})
	}
}
