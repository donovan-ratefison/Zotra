package api

// The tests of the documentation routes.

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/donovan-ratefison/zotra/internal/store"
)

// 6.
func TestVersionDoc(t *testing.T) {
	newTestAPI(t)
	for _, c := range []struct{ path, contentType, part string }{
		{"doc.md", "text/markdown; charset=utf-8", "# Home loan\n"},
		{"doc.html", "text/html; charset=utf-8", `id="process-definition"`},
	} {
		rec := do(t, "GET", "/api/versions/"+seedVersionID+"/"+c.path, "", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d: %s", c.path, rec.Code, rec.Body.String())
		}
		if got := rec.Header().Get("Content-Type"); got != c.contentType {
			t.Errorf("%s: content type %q, want %q", c.path, got, c.contentType)
		}
		if !strings.Contains(rec.Body.String(), c.part) {
			t.Errorf("%s: body has no %q", c.path, c.part)
		}
	}
	if body := do(t, "GET", "/api/versions/"+seedVersionID+"/doc.md", "", "").Body.String(); !strings.HasPrefix(body, "# Home loan") {
		t.Errorf("markdown does not start with the title: %.40q", body)
	}
}

// 7 and 8.
func TestVersionDocRefusals(t *testing.T) {
	newTestAPI(t)
	for _, path := range []string{"doc.md", "doc.html"} {
		rec := do(t, "GET", "/api/versions/ghost/"+path, "", "")
		checkError(t, rec, http.StatusNotFound, "not_found", "no version ghost")
	}

	id := createProcessVersion(t, exampleDefinition(t), "Draft")
	rec := do(t, "PUT", "/api/versions/"+id, `{"definition":{"schema_version":"1","name":5}}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("put: status %d: %s", rec.Code, rec.Body.String())
	}
	for _, path := range []string{"doc.md", "doc.html"} {
		rec = do(t, "GET", "/api/versions/"+id+"/"+path, "", "")
		checkError(t, rec, http.StatusInternalServerError, "internal",
			"cannot read the definition of version "+id)
	}
}

// A1, A2: the page carries the bank profile.
func TestVersionDocBank(t *testing.T) {
	newTestAPI(t)
	page := func() string {
		rec := do(t, "GET", "/api/versions/"+seedVersionID+"/doc.html", "", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
		}
		return rec.Body.String()
	}
	// A2: the seed row.
	seed := page()
	if !strings.Contains(seed, "<span>Banque Ravina</span>") || strings.Contains(seed, "<img") {
		t.Errorf("A2: seed page has no bank name or has a logo")
	}
	// A1.
	for path, body := range map[string]string{
		"/api/settings/bank":      `{"name":"Banque Test","primary_color":"#7c3aed","accent_color":"#ffcc00"}`,
		"/api/settings/bank/logo": "\x89PNG\r\n\x1a\ndata",
	} {
		if rec := do(t, "PUT", path, body, ""); rec.Code != http.StatusOK {
			t.Fatalf("PUT %s: status %d: %s", path, rec.Code, rec.Body.String())
		}
	}
	text := page()
	for _, part := range []string{"--primary:#7c3aed;--accent:#ffcc00;--on-primary:#ffffff",
		`<img src="data:image/png;base64,iVBORw0KGgpkYXRh" alt="Banque Test">`,
		`v1 <span class="badge">Published</span>`} {
		if !strings.Contains(text, part) {
			t.Errorf("A1: page has no %q", part)
		}
	}
}

// A3.
func TestCoverOf(t *testing.T) {
	created := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	frozen := time.Date(2026, 10, 2, 8, 0, 0, 0, time.UTC)
	b := store.Bank{Name: "B", PrimaryColor: "#000000", AccentColor: "#ffffff"}
	v := store.Version{Number: 2, Status: "frozen", CreatedAt: created, FrozenAt: &frozen}
	if c := coverOf(b, v); !c.Date.Equal(frozen) || c.LogoURI != "" || c.Version != 2 || c.Status != "frozen" {
		t.Errorf("FrozenAt set: %+v", c)
	}
	v.FrozenAt = nil
	if c := coverOf(b, v); !c.Date.Equal(created) {
		t.Errorf("FrozenAt nil: Date = %v, want %v", c.Date, created)
	}
}
