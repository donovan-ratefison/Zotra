package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// scanPNG is pngMagic plus n zero bytes.
func scanPNG(n int) []byte {
	return append(append([]byte{}, pngMagic...), make([]byte, n)...)
}

// scanURL is the PNG data URL of b.
func scanURL(b []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b)
}

// scanBody builds the request body of the given pages.
func scanBody(t *testing.T, pages ...string) string {
	t.Helper()
	b, err := json.Marshal(map[string][]string{"pages": pages})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func postScan(t *testing.T, body string) *scanResult {
	t.Helper()
	rec := do(t, "POST", "/api/ai/read-policy-scan", body, "")
	res := &scanResult{code: rec.Code, raw: rec.Body.String()}
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &res.body); err != nil {
			t.Fatalf("unmarshal: %v: %s", err, res.raw)
		}
	}
	return res
}

type scanResult struct {
	code int
	raw  string
	body struct {
		Paragraphs []paragraphIn `json:"paragraphs"`
		Dropped    int           `json:"dropped"`
	}
}

// B1 to B8: the refusals. No AI request in them.
func TestReadPolicyScanRefusals(t *testing.T) {
	f := newFakeAI(t, chatEnvelope(`{"paragraphs":[{"page":1,"text":"Ok"}]}`))
	aiLive(t, f.srv.URL)
	newTestAPI(t)
	eleven := make([]string, 11)
	for i := range eleven {
		eleven[i] = scanURL(scanPNG(1))
	}
	cases := []struct {
		name, body, code, msg string
		status                int
	}{
		{"B1 body above the cap", strings.Repeat(" ", 44<<20+1), "too_large", "the scan must stay under 44 MiB", 413},
		{"B2 not json", `{`, "invalid_json", msgInvalidJSON, 400},
		{"B3 no page", `{"pages":[]}`, "invalid_pages", msgInvalidPages, 400},
		{"B4 11 pages", scanBody(t, eleven...), "invalid_pages", msgInvalidPages, 400},
		{"B5 jpeg", scanBody(t, "data:image/jpeg;base64,/9j/"), "invalid_pages", msgInvalidPages, 400},
		{"B6 bad base64", scanBody(t, "data:image/png;base64,***"), "invalid_pages", msgInvalidPages, 400},
		{"B7 not png", scanBody(t, scanURL([]byte("GIF89a"))), "invalid_pages", msgInvalidPages, 400},
		{"B8 page above 3 MiB", scanBody(t, scanURL(scanPNG(3<<20))), "invalid_pages", msgInvalidPages, 400},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := do(t, "POST", "/api/ai/read-policy-scan", c.body, "")
			checkError(t, rec, c.status, c.code, c.msg)
		})
	}
	if f.count != 0 {
		t.Errorf("AI requests = %d, want 0", f.count)
	}
	// B8: a page of exactly 3 MiB passes the checks and reaches the stub.
	res := postScan(t, scanBody(t, scanURL(scanPNG(3<<20-8))))
	if res.code != http.StatusOK || f.count != 1 {
		t.Errorf("3 MiB page: status %d, requests %d, want 200 and 1: %s", res.code, f.count, res.raw)
	}
}

// B9: a good answer gives ids in page order.
func TestReadPolicyScanGood(t *testing.T) {
	f := newFakeAI(t, chatEnvelope(`{"paragraphs":[{"page":2,"text":"B"},{"page":1,"text":" A1 "},{"page":1,"text":"A2"}]}`))
	aiLive(t, f.srv.URL)
	newTestAPI(t)
	res := postScan(t, scanBody(t, scanURL(scanPNG(1)), scanURL(scanPNG(2))))
	if res.code != http.StatusOK {
		t.Fatalf("status %d: %s", res.code, res.raw)
	}
	got := fmt.Sprint(res.body.Paragraphs)
	if want := "[{p1-1 A1} {p1-2 A2} {p2-1 B}]"; got != want || res.body.Dropped != 0 {
		t.Errorf("paragraphs = %s dropped %d, want %s dropped 0", got, res.body.Dropped, want)
	}
	if !validParagraphs(res.body.Paragraphs) {
		t.Errorf("validParagraphs = false")
	}
	if f.count != 1 {
		t.Errorf("AI requests = %d, want 1", f.count)
	}
	var req struct {
		Model    string `json:"model"`
		Messages []struct {
			Content []json.RawMessage `json:"content"`
		} `json:"messages"`
		ResponseFormat struct {
			JSONSchema struct {
				Name string `json:"name"`
			} `json:"json_schema"`
		} `json:"response_format"`
	}
	if err := json.Unmarshal([]byte(f.body), &req); err != nil {
		t.Fatalf("request: %v", err)
	}
	if req.Model != "muse-spark-1.3" || len(req.Messages) != 1 ||
		len(req.Messages[0].Content) != 3 || req.ResponseFormat.JSONSchema.Name != "policy_scan" {
		t.Errorf("request = model %q, %d messages, schema %q", req.Model, len(req.Messages), req.ResponseFormat.JSONSchema.Name)
	}
}

// B10, B13: the item checks and the cap of 500.
func TestReadPolicyScanDropped(t *testing.T) {
	many := make([]string, 501)
	for i := range many {
		many[i] = `{"page":1,"text":"T"}`
	}
	cases := []struct {
		name, content, want string
		n, dropped          int
	}{
		{"B10 bad items", `{"paragraphs":[{"page":0,"text":"A"},{"page":2,"text":"B"},{"page":1,"text":"  "},{"page":1,"text":"` +
			strings.Repeat("é", 5001) + `"},{"page":1,"text":"Ok"}]}`, "p1-1", 1, 4},
		{"B13 501 items", `{"paragraphs":[` + strings.Join(many, ",") + `]}`, "p1-500", 500, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFakeAI(t, chatEnvelope(c.content))
			aiLive(t, f.srv.URL)
			newTestAPI(t)
			res := postScan(t, scanBody(t, scanURL(scanPNG(1))))
			if res.code != http.StatusOK {
				t.Fatalf("status %d: %s", res.code, res.raw)
			}
			ps := res.body.Paragraphs
			if len(ps) != c.n || ps[len(ps)-1].ID != c.want || res.body.Dropped != c.dropped {
				t.Errorf("got %d items, last %q, dropped %d; want %d, %q, %d",
					len(ps), ps[len(ps)-1].ID, res.body.Dropped, c.n, c.want, c.dropped)
			}
		})
	}
}

// B11, B12: bad and empty answers.
func TestReadPolicyScanBadAnswer(t *testing.T) {
	cases := []struct{ name, content, code, msg string }{
		{"B11 not json", "not json", "invalid_output", msgNoContent},
		{"B12 no paragraph", `{"paragraphs":[]}`, "no_text", "The AI found no text on these pages."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFakeAI(t, chatEnvelope(c.content))
			aiLive(t, f.srv.URL)
			newTestAPI(t)
			rec := do(t, "POST", "/api/ai/read-policy-scan", scanBody(t, scanURL(scanPNG(1))), "")
			checkError(t, rec, http.StatusUnprocessableEntity, c.code, c.msg)
		})
	}
}

// B14: the AI layer is off.
func TestReadPolicyScanAIOff(t *testing.T) {
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", t.TempDir())
	newTestAPI(t)
	rec := do(t, "POST", "/api/ai/read-policy-scan", scanBody(t, scanURL(scanPNG(1))), "")
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable", "The AI layer is off.")
}
