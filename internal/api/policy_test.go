package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// putPolicyRaw sends one PUT of a raw policy body. An empty name sends
// no X-File-Name header.
func putPolicyRaw(t *testing.T, processID string, body []byte, name string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("PUT", "/api/processes/"+processID+"/policy", bytes.NewReader(body))
	if name != "" {
		req.Header.Set("X-File-Name", name)
	}
	rec := httptest.NewRecorder()
	testAPIHandler.ServeHTTP(rec, req)
	return rec
}

// newProcessID creates one process and returns its id.
func newProcessID(t *testing.T) string {
	t.Helper()
	body := mustCreate(t, "POST", "/api/processes", `{"name":"Policy"}`, http.StatusCreated)
	return body["process"].(map[string]any)["id"].(string)
}

// TestPolicyRoutes covers rows H1 to H11.
func TestPolicyRoutes(t *testing.T) {
	newTestAPI(t)

	t.Run("H1 H2 put then get", func(t *testing.T) {
		id := newProcessID(t)
		body := []byte("%PDF-1.4 test")
		rec := putPolicyRaw(t, id, body, "Home%20loan.pdf")
		if rec.Code != http.StatusOK {
			t.Fatalf("put: status %d: %s", rec.Code, rec.Body.String())
		}
		p := decode(t, rec)["policy"].(map[string]any)
		sum := sha256.Sum256(body)
		if p["process_id"] != id || p["file_name"] != "Home loan.pdf" ||
			p["mime"] != "application/pdf" || p["size"] != float64(13) ||
			p["sha256"] != hex.EncodeToString(sum[:]) || p["created_at"] == "" {
			t.Errorf("policy = %v", p)
		}
		get := do(t, "GET", "/api/processes/"+id+"/policy", "", "")
		if get.Code != http.StatusOK || !bytes.Equal(get.Body.Bytes(), body) {
			t.Fatalf("get: status %d, body %q", get.Code, get.Body.String())
		}
		if ct := get.Header().Get("Content-Type"); ct != "application/pdf" {
			t.Errorf("Content-Type = %q", ct)
		}
		if fn := get.Header().Get("X-File-Name"); fn != "Home%20loan.pdf" {
			t.Errorf("X-File-Name = %q", fn)
		}
		if cc := get.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("Cache-Control = %q", cc)
		}
	})

	t.Run("H3 unknown process", func(t *testing.T) {
		id := "00000000-0000-0000-0000-0000000000ff"
		checkError(t, putPolicyRaw(t, id, []byte("%PDF-1.4"), ""),
			http.StatusNotFound, "not_found", "no process "+id)
	})

	t.Run("H4 empty body", func(t *testing.T) {
		checkError(t, putPolicyRaw(t, newProcessID(t), nil, ""),
			http.StatusBadRequest, "invalid_policy", "the body is empty")
	})

	t.Run("H5 not a PDF", func(t *testing.T) {
		checkError(t, putPolicyRaw(t, newProcessID(t), []byte("hello"), ""),
			http.StatusBadRequest, "invalid_policy", "the file is not a PDF")
	})

	t.Run("H6 too large", func(t *testing.T) {
		id := newProcessID(t)
		body := append([]byte("%PDF-"), make([]byte, 20<<20)...)
		checkError(t, putPolicyRaw(t, id, body, ""),
			http.StatusRequestEntityTooLarge, "too_large", "the policy file must stay under 20 MiB")
		checkError(t, do(t, "GET", "/api/processes/"+id+"/policy", "", ""),
			http.StatusNotFound, "not_found", "no policy "+id)
	})

	t.Run("H7 default name", func(t *testing.T) {
		rec := putPolicyRaw(t, newProcessID(t), []byte("%PDF-1.4"), "")
		if rec.Code != http.StatusOK {
			t.Fatalf("put: status %d: %s", rec.Code, rec.Body.String())
		}
		if name := decode(t, rec)["policy"].(map[string]any)["file_name"]; name != "policy.pdf" {
			t.Errorf("file_name = %v, want policy.pdf", name)
		}
	})

	t.Run("H8 no file", func(t *testing.T) {
		id := newProcessID(t)
		checkError(t, do(t, "GET", "/api/processes/"+id+"/policy", "", ""),
			http.StatusNotFound, "not_found", "no policy "+id)
	})

	t.Run("H9 non-uuid", func(t *testing.T) {
		checkError(t, do(t, "GET", "/api/processes/not-a-uuid/policy", "", ""),
			http.StatusNotFound, "not_found", "no policy not-a-uuid")
	})

	t.Run("H10 seed policy", func(t *testing.T) {
		want, err := os.ReadFile("../../examples/home-loan/policy.pdf")
		if err != nil {
			t.Fatal(err)
		}
		rec := do(t, "GET", "/api/processes/"+seedProcessID+"/policy", "", "")
		if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), want) {
			t.Fatalf("seed: status %d, %d bytes, want %d bytes", rec.Code, rec.Body.Len(), len(want))
		}
	})

	t.Run("H11 replace", func(t *testing.T) {
		id := newProcessID(t)
		for _, b := range []string{"%PDF-1 a", "%PDF-1 b"} {
			if rec := putPolicyRaw(t, id, []byte(b), ""); rec.Code != http.StatusOK {
				t.Fatalf("put %q: status %d", b, rec.Code)
			}
		}
		rec := do(t, "GET", "/api/processes/"+id+"/policy", "", "")
		if rec.Body.String() != "%PDF-1 b" {
			t.Errorf("get = %q, want %%PDF-1 b", rec.Body.String())
		}
	})
}

// TestPolicyFileName checks the decode, trim and cut of the file name.
func TestPolicyFileName(t *testing.T) {
	long := string(bytes.Repeat([]byte("a"), 199)) + "é"
	for _, c := range []struct{ in, want string }{
		{"Home%20loan.pdf", "Home loan.pdf"},
		{"bad%zz.pdf", "bad%zz.pdf"},
		{"   ", "policy.pdf"},
		{"%FF.pdf", ".pdf"},
		{"%FF", "policy.pdf"},
		{long, long[:199]},
	} {
		if got := policyFileName(c.in); got != c.want {
			t.Errorf("policyFileName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
