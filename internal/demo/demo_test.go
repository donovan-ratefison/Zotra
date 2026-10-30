package demo

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"

	"github.com/donovan-ratefison/zotra/internal/rules"
)

func TestHandler(t *testing.T) {
	notFound := map[string]any{"error": map[string]any{
		"code": "not_found", "message": "no such endpoint", "details": []any{},
	}}
	rows := []struct {
		name, method, target string
		status               int
		want                 map[string]any
	}{
		// D1: the fixed data.
		{"D1 blocked", "GET", "/blacklist?client_id=blocked", 200, map[string]any{"listed": true}},
		{"D1 blacklist other", "GET", "/blacklist?client_id=other", 200, map[string]any{"listed": false}},
		{"D1 loaded", "GET", "/loans?client_id=loaded", 200, map[string]any{"monthly_total": 800.0}},
		{"D1 loans other", "GET", "/loans?client_id=other", 200, map[string]any{"monthly_total": 0.0}},
		// D2: no client_id, unknown path, wrong method.
		{"D2 blacklist no id", "GET", "/blacklist", 200, map[string]any{"listed": false}},
		{"D2 loans no id", "GET", "/loans", 200, map[string]any{"monthly_total": 0.0}},
		{"D2 unknown path", "GET", "/ghost", 404, notFound},
		{"D2 wrong method", "POST", "/loans?client_id=loaded", 404, notFound},
	}
	h := Handler()
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(row.method, row.target, nil))
			if rec.Code != row.status {
				t.Fatalf("status = %d, want %d", rec.Code, row.status)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("Content-Type = %q", ct)
			}
			var got map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, row.want) {
				t.Fatalf("body = %v, want %v", got, row.want)
			}
		})
	}
}

// P1 and P2: the example process stays valid, and the seed copy
// equals it.
func TestExampleProcess(t *testing.T) {
	example, err := os.ReadFile("../../examples/home-loan/process.json")
	if err != nil {
		t.Fatal(err)
	}
	if errs := rules.ValidateDocument(example); len(errs) > 0 {
		t.Fatalf("P1: %v", errs)
	}
	seed, err := os.ReadFile("../store/seed/example-process.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(example, seed) {
		t.Fatal("P2: the seed copy differs from the example")
	}
}
