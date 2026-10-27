// Package api serves the Zotra HTTP API and the built web app.
package api

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
)

// NewHandler returns the handler of Zotra: the API routes and the web app.
// A non-empty feedbackDir mounts the feedback routes.
func NewHandler(static fs.FS, version string, feedbackDir string) http.Handler {
	mux := http.NewServeMux()

	health := map[string]string{"status": "ok", "version": version}
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		b, _ := json.Marshal(health)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(b)
	})

	// The /api/ fallback below matches every method. It swallows the
	// default 405 of ServeMux. This route gives the 405 back, with the
	// same response that the mux writes on its own.
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Allow", "GET")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	})

	// The feedback routes exist only when the directory is set.
	// They stay before the /api/ fallback, which answers 404 for
	// every other /api/ path.
	if feedbackDir != "" {
		newFeedbackStore(feedbackDir, version).mount(mux)
	}

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found",
			fmt.Sprintf("no route for %s %s", r.Method, r.URL.Path))
	})

	files := http.FileServerFS(static)
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name != "" {
			if _, err := fs.Stat(static, name); err == nil {
				files.ServeHTTP(w, r)
				return
			}
		}
		// SPA fallback: every unknown path gets index.html.
		http.ServeFileFS(w, r, static, "index.html")
	}))

	return mux
}

// writeError writes the JSON error body of the API.
func writeError(w http.ResponseWriter, status int, code, message string) {
	var body struct {
		Error struct {
			Code    string   `json:"code"`
			Message string   `json:"message"`
			Details []string `json:"details"`
		} `json:"error"`
	}
	body.Error.Code = code
	body.Error.Message = message
	body.Error.Details = []string{}
	b, _ := json.Marshal(body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}
