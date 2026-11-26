package api

import (
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func TestNewHandler(t *testing.T) {
	static := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<p>index</p>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log(1)")},
	}
	t.Setenv("ZOTRA_AI_MODE", "")
	handler := NewHandler(static, "test", nil, "")

	tests := []struct {
		name       string
		method     string
		target     string
		wantStatus int
		wantJSON   bool
		wantBody   []string
	}{
		{name: "health", method: "GET", target: "/api/health",
			wantStatus: 200, wantJSON: true,
			wantBody: []string{`"status":"ok"`, `"version":"test"`, `"ai_mode":"cache"`}},
		{name: "wrong method on health", method: "POST", target: "/api/health",
			wantStatus: 405},
		{name: "unknown api route", method: "GET", target: "/api/nothing",
			wantStatus: 404, wantJSON: true,
			wantBody: []string{`"code":"not_found"`}},
		{name: "root", method: "GET", target: "/",
			wantStatus: 200, wantBody: []string{"<p>index</p>"}},
		{name: "asset", method: "GET", target: "/assets/app.js",
			wantStatus: 200, wantBody: []string{"console.log(1)"}},
		{name: "spa fallback", method: "GET", target: "/studio/p/42",
			wantStatus: 200, wantBody: []string{"<p>index</p>"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.target, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if tt.wantJSON {
				if got := rec.Header().Get("Content-Type"); got != "application/json" {
					t.Errorf("Content-Type = %q, want application/json", got)
				}
			}
			for _, want := range tt.wantBody {
				if !strings.Contains(rec.Body.String(), want) {
					t.Errorf("body does not contain %q: %q", want, rec.Body.String())
				}
			}
		})
	}
}

func TestHealthAIMode(t *testing.T) {
	t.Setenv("ZOTRA_AI_MODE", "replay")
	handler := NewHandler(fstest.MapFS{}, "test", nil, "")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
	if !strings.Contains(rec.Body.String(), `"ai_mode":"replay"`) {
		t.Errorf("body does not contain ai_mode replay: %q", rec.Body.String())
	}
}

func TestHealthDemoNotice(t *testing.T) {
	tests := []struct {
		name  string
		value string
		set   bool
		want  string
	}{
		{name: "text is trimmed", value: "  Demo text  ", set: true, want: `"demo_notice":"Demo text"`},
		{name: "blank text", value: "   ", set: true},
		{name: "unset"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// t.Setenv restores the old value at the end of the test.
			t.Setenv("ZOTRA_DEMO_NOTICE", tt.value)
			if !tt.set {
				os.Unsetenv("ZOTRA_DEMO_NOTICE")
			}
			handler := NewHandler(fstest.MapFS{}, "test", nil, "")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))
			body := rec.Body.String()
			if tt.want != "" {
				if !strings.Contains(body, tt.want) {
					t.Errorf("body does not contain %q: %q", tt.want, body)
				}
			} else if strings.Contains(body, "demo_notice") {
				t.Errorf("body contains demo_notice: %q", body)
			}
		})
	}
}
