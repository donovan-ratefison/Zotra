package api

// The tests of the documentation routes: rows 6 to 8 of the lot.

import (
	"net/http"
	"strings"
	"testing"
)

// 6.
func TestVersionDoc(t *testing.T) {
	newTestAPI(t)
	for _, c := range []struct{ path, contentType, part string }{
		{"doc.md", "text/markdown; charset=utf-8", "# Home loan\n"},
		{"doc.html", "text/html; charset=utf-8", "<svg"},
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
