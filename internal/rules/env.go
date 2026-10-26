// Package rules compiles and evaluates the CEL expressions of a
// process: checks, conditions and computed fields. The contract is
// local/plan.md sections 2 and 3.
package rules

import (
	"fmt"
	"math"
	"time"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/common/types"
	"cel.dev/cel-go/common/types/ref"
	"cel.dev/cel-go/common/types/traits"
	"cel.dev/cel-go/ext"

	"github.com/donovan-ratefison/zotra/internal/process"
)

// Env is the CEL environment of one process definition.
type Env struct {
	env *cel.Env
}

// Program is one compiled expression. It carries no state.
type Program struct {
	prg  cel.Program
	expr string
}

// FieldType returns the CEL result type of one field, from the table
// of local/plan.md section 2: string and enum give string, number and
// money give double, integer gives int, boolean gives bool, date
// gives google.protobuf.Timestamp, document gives list(string). It
// returns an error for an unknown field type.
func FieldType(field process.Field) (*cel.Type, error) {
	switch field.Type {
	case "string", "enum":
		return cel.StringType, nil
	case "number", "money":
		return cel.DoubleType, nil
	case "integer":
		return cel.IntType, nil
	case "boolean":
		return cel.BoolType, nil
	case "date":
		return cel.TimestampType, nil
	case "document":
		return cel.ListType(cel.StringType), nil
	default:
		return nil, fmt.Errorf("unknown field type %q", field.Type)
	}
}

// NewEnv returns the environment of the fields: one variable per
// field name, with the CEL type of its field type, plus now
// (google.protobuf.Timestamp) and decision (string). It enables the
// math extension of cel-go, and declares pow, so that the computed
// fields can use pow. It returns an error for an unknown field type.
func NewEnv(fields []process.Field) (*Env, error) {
	opts := []cel.EnvOption{ext.Math()}
	for _, field := range fields {
		t, err := FieldType(field)
		if err != nil {
			return nil, fmt.Errorf("field %s: %w", field.Name, err)
		}
		opts = append(opts, cel.Variable(field.Name, t))
	}
	opts = append(opts,
		cel.Variable("now", cel.TimestampType),
		cel.Variable("decision", cel.StringType),
		powFunction(),
	)
	env, err := cel.NewEnv(opts...)
	if err != nil {
		return nil, fmt.Errorf("cel env: %w", err)
	}
	return &Env{env: env}, nil
}

// powFunction declares pow(double, int) and pow(double, double),
// both backed by math.Pow. The math extension of cel-go has no pow.
func powFunction() cel.EnvOption {
	toDouble := func(v ref.Val) (float64, bool) {
		x, ok := v.(types.Double)
		if !ok {
			return 0, false
		}
		return float64(x), true
	}
	powBinding := func(exponent func(ref.Val) (float64, bool)) func(lhs, rhs ref.Val) ref.Val {
		return func(lhs, rhs ref.Val) ref.Val {
			base, ok := toDouble(lhs)
			if !ok {
				return types.MaybeNoSuchOverloadErr(lhs)
			}
			exp, ok := exponent(rhs)
			if !ok {
				return types.MaybeNoSuchOverloadErr(rhs)
			}
			return types.Double(math.Pow(base, exp))
		}
	}
	intExponent := func(v ref.Val) (float64, bool) {
		n, ok := v.(types.Int)
		if !ok {
			return 0, false
		}
		return float64(n), true
	}
	doubleExponent := func(v ref.Val) (float64, bool) {
		return toDouble(v)
	}
	return cel.Function("pow",
		cel.Overload("pow_double_int",
			[]*cel.Type{cel.DoubleType, cel.IntType}, cel.DoubleType,
			cel.BinaryBinding(powBinding(intExponent))),
		cel.Overload("pow_double_double",
			[]*cel.Type{cel.DoubleType, cel.DoubleType}, cel.DoubleType,
			cel.BinaryBinding(powBinding(doubleExponent))),
	)
}

// Compile compiles the expression and checks rule 5: the result type
// is result. An expression that does not parse, that uses an unknown
// name, or that has another result type, is an error that names the
// expression and the reason.
func (e *Env) Compile(expression string, result *cel.Type) (Program, error) {
	ast, issues := e.env.Compile(expression)
	if issues != nil && issues.Err() != nil {
		return Program{}, fmt.Errorf("compile %q: %w", expression, issues.Err())
	}
	if !ast.OutputType().IsExactType(result) {
		return Program{}, fmt.Errorf("compile %q: result is %s, want %s",
			expression, ast.OutputType(), result)
	}
	prg, err := e.env.Program(ast)
	if err != nil {
		return Program{}, fmt.Errorf("program %q: %w", expression, err)
	}
	return Program{prg: prg, expr: expression}, nil
}

// Eval evaluates the program. values holds the set fields, by name,
// with the Go shapes of local/plan.md section 2. now is the event
// time, decision the decision being made, or "". A used variable
// without a value is an error. The result is a Go value of the result
// type.
func (p Program) Eval(values map[string]any, now time.Time, decision string) (any, error) {
	activation := make(map[string]any, len(values)+2)
	for name, value := range values {
		activation[name] = value
	}
	activation["now"] = now
	activation["decision"] = decision
	out, _, err := p.prg.Eval(activation)
	if err != nil {
		return nil, fmt.Errorf("eval %q: %w", p.expr, err)
	}
	native, err := nativeValue(out)
	if err != nil {
		return nil, fmt.Errorf("eval %q: %w", p.expr, err)
	}
	return native, nil
}

// EvalBool evaluates a program that Compile checked for bool.
func (p Program) EvalBool(values map[string]any, now time.Time, decision string) (bool, error) {
	out, err := p.Eval(values, now, decision)
	if err != nil {
		return false, err
	}
	b, ok := out.(bool)
	if !ok {
		return false, fmt.Errorf("eval %q: result is %T, want bool", p.expr, out)
	}
	return b, nil
}

// nativeValue converts the ref.Val result of cel-go to the plain Go
// value of the same kind.
func nativeValue(out ref.Val) (any, error) {
	switch v := out.(type) {
	case types.Bool:
		return bool(v), nil
	case types.Int:
		return int64(v), nil
	case types.Double:
		return float64(v), nil
	case types.String:
		return string(v), nil
	case types.Timestamp:
		return time.Time(v.Time), nil
	case traits.Lister:
		size, ok := v.Size().(types.Int)
		if !ok {
			return nil, fmt.Errorf("result is %T, want a native value", v.Size())
		}
		items := make([]any, 0, int64(size))
		for i := int64(0); i < int64(size); i++ {
			item, err := nativeValue(v.Get(types.Int(i)))
			if err != nil {
				return nil, err
			}
			items = append(items, item)
		}
		return items, nil
	default:
		return nil, fmt.Errorf("result is %T, want a native value", out)
	}
}
