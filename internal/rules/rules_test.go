package rules

import (
	"fmt"
	"math"
	"testing"
	"time"

	"cel.dev/cel-go/cel"

	"github.com/donovan-ratefison/zotra/internal/process"
)

// exampleFields holds the 14 fields of examples/home-loan/process.json.
// The names and the types are the only values that the rules use.
func exampleFields() []process.Field {
	field := func(name, typ string) process.Field {
		return process.Field{Name: name, Label: name, Type: typ, Options: []string{}, Computed: nil}
	}
	return []process.Field{
		field("client_name", "string"),
		field("profession", "string"),
		field("amount", "money"),
		field("duration_months", "integer"),
		field("down_payment", "money"),
		field("annual_rate", "number"),
		field("monthly_income", "money"),
		field("monthly_payment", "money"),
		field("debt_ratio", "number"),
		field("documents", "document"),
		field("analysis_opinion", "enum"),
		field("analysis_comment", "string"),
		field("credit_decision", "enum"),
		field("release_date", "date"),
	}
}

func testEnv(t *testing.T) *Env {
	t.Helper()
	env, err := NewEnv(exampleFields())
	if err != nil {
		t.Fatalf("NewEnv: %v", err)
	}
	return env
}

func fixedNow() time.Time {
	return time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
}

func TestFieldType(t *testing.T) {
	tests := []struct {
		fieldType string
		want      *cel.Type
	}{
		{"string", cel.StringType},
		{"enum", cel.StringType},
		{"number", cel.DoubleType},
		{"money", cel.DoubleType},
		{"integer", cel.IntType},
		{"boolean", cel.BoolType},
		{"date", cel.TimestampType},
		{"document", cel.ListType(cel.StringType)},
	}
	for _, tt := range tests {
		t.Run(tt.fieldType, func(t *testing.T) {
			got, err := FieldType(process.Field{Name: "f", Label: "f", Type: tt.fieldType, Options: []string{}, Computed: nil})
			if err != nil {
				t.Fatalf("FieldType(%s): %v", tt.fieldType, err)
			}
			if !got.IsExactType(tt.want) {
				t.Errorf("FieldType(%s) = %s, want %s", tt.fieldType, got, tt.want)
			}
		})
	}
}

func TestNewEnvUnknownType(t *testing.T) {
	bad := process.Field{Name: "f", Label: "f", Type: "vector", Options: []string{}, Computed: nil}
	if _, err := NewEnv([]process.Field{bad}); err == nil {
		t.Error("NewEnv with unknown type gave no error, want one")
	}
	if _, err := FieldType(bad); err == nil {
		t.Error("FieldType with unknown type gave no error, want one")
	}
}

func TestCompileExample(t *testing.T) {
	env := testEnv(t)
	tests := []struct {
		name       string
		expression string
		result     *cel.Type
	}{
		{name: "entry-amount", expression: "amount > 0.0 && duration_months <= 300", result: cel.BoolType},
		{name: "analysis-debt-ratio", expression: `debt_ratio <= 0.33 || analysis_comment != ""`, result: cel.BoolType},
		{name: "release-date", expression: "release_date >= now", result: cel.BoolType},
		{name: "documents condition", expression: "size(documents) >= 4", result: cel.BoolType},
		{name: "threshold condition", expression: "amount > 100000.0", result: cel.BoolType},
		{
			name:       "monthly_payment",
			expression: "amount * (annual_rate / 12.0) / (1.0 - pow(1.0 + annual_rate / 12.0, -duration_months))",
			result:     cel.DoubleType,
		},
		{name: "debt_ratio", expression: "monthly_payment / monthly_income", result: cel.DoubleType},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := env.Compile(tt.expression, tt.result); err != nil {
				t.Errorf("Compile: %v", err)
			}
		})
	}
}

// evalRow is one row of the evaluation table.
type evalRow struct {
	expression string
	result     *cel.Type
	values     map[string]any
	now        time.Time
	decision   string
	want       any
	epsilon    float64
}

func TestEvalExample(t *testing.T) {
	env := testEnv(t)
	now := fixedNow()
	later := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)

	boolRow := func(expression string, values map[string]any, want bool) evalRow {
		return evalRow{
			expression: expression,
			result:     cel.BoolType,
			values:     values,
			now:        now,
			decision:   "",
			want:       want,
		}
	}

	release := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	tests := []evalRow{
		boolRow("amount > 0.0 && duration_months <= 300",
			map[string]any{"amount": 240000.0, "duration_months": 240}, true),
		boolRow("amount > 0.0 && duration_months <= 300",
			map[string]any{"amount": 0.0}, false),
		boolRow("amount > 0.0 && duration_months <= 300",
			map[string]any{"amount": 240000.0, "duration_months": 301}, false),
		boolRow("size(documents) >= 4",
			map[string]any{"documents": []string{"a", "b", "c", "d"}}, true),
		boolRow("size(documents) >= 4",
			map[string]any{"documents": []string{"a"}}, false),
		boolRow(`debt_ratio <= 0.33 || analysis_comment != ""`,
			map[string]any{"monthly_payment": 900.0, "monthly_income": 3000.0, "debt_ratio": 0.3, "analysis_comment": ""}, true),
		boolRow(`debt_ratio <= 0.33 || analysis_comment != ""`,
			map[string]any{"monthly_payment": 900.0, "monthly_income": 1000.0, "debt_ratio": 0.9, "analysis_comment": ""}, false),
		boolRow(`debt_ratio <= 0.33 || analysis_comment != ""`,
			map[string]any{"monthly_payment": 900.0, "monthly_income": 1000.0, "debt_ratio": 0.9, "analysis_comment": "Client has other loans."}, true),
		boolRow("release_date >= now",
			map[string]any{"release_date": release}, true),
		{
			expression: "release_date >= now",
			result:     cel.BoolType,
			values:     map[string]any{"release_date": release},
			now:        later,
			decision:   "",
			want:       false,
		},
		boolRow("amount > 100000.0",
			map[string]any{"amount": 150000.0}, true),
		boolRow("amount > 100000.0",
			map[string]any{"amount": 100000.0}, false),
		{
			expression: "amount * (annual_rate / 12.0) / (1.0 - pow(1.0 + annual_rate / 12.0, -duration_months))",
			result:     cel.DoubleType,
			values:     map[string]any{"amount": 120000.0, "annual_rate": 0.11, "duration_months": 240},
			now:        now,
			decision:   "",
			want:       1238.6,
			epsilon:    1.0,
		},
	}

	for i, tt := range tests {
		t.Run(fmt.Sprintf("row-%02d", i+1), func(t *testing.T) {
			prg, err := env.Compile(tt.expression, tt.result)
			if err != nil {
				t.Fatalf("Compile: %v", err)
			}
			if tt.epsilon > 0 {
				got, err := prg.Eval(tt.values, tt.now, tt.decision)
				if err != nil {
					t.Fatalf("Eval: %v", err)
				}
				g, ok := got.(float64)
				if !ok {
					t.Fatalf("Eval gave %T, want float64", got)
				}
				if math.Abs(g-tt.want.(float64)) > tt.epsilon {
					t.Errorf("Eval = %v, want %v within %v", g, tt.want, tt.epsilon)
				}
				return
			}
			got, err := prg.EvalBool(tt.values, tt.now, tt.decision)
			if err != nil {
				t.Fatalf("EvalBool: %v", err)
			}
			if got != tt.want.(bool) {
				t.Errorf("EvalBool = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCompileRefusals(t *testing.T) {
	env := testEnv(t)
	tests := []struct {
		name       string
		expression string
		result     *cel.Type
	}{
		{name: "result double", expression: "amount", result: cel.BoolType},
		{name: "result string", expression: `"hello"`, result: cel.BoolType},
		{name: "result double sum", expression: "amount + 1", result: cel.BoolType},
		{name: "unknown name", expression: "foo > 1", result: cel.BoolType},
		{name: "result int size", expression: "size(documents)", result: cel.StringType},
		{name: "int against double", expression: "amount > 0", result: cel.BoolType},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := env.Compile(tt.expression, tt.result); err == nil {
				t.Errorf("Compile(%q) gave no error, want one", tt.expression)
			}
		})
	}
}
