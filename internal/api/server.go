// Package api serves the Zotra HTTP API and the built web app.
package api

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"strings"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// msgInvalidJSON is the message of every invalid_json answer.
const msgInvalidJSON = "the request body is not valid JSON"

// apiDeps carries the dependencies of the store routes.
type apiDeps struct {
	st      *store.Store
	version string
	ai      *ai.Client
}

// NewHandler returns the handler of Zotra: the API routes and the web app.
// A non-empty feedbackDir mounts the feedback routes. A non-nil store
// mounts the process, version, case and inbox routes. A nil store
// answers 404 for them through the /api/ fallback.
func NewHandler(static fs.FS, version string, st *store.Store, feedbackDir string) http.Handler {
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

	// The store routes exist only when the database is wired. Each
	// pattern carries one method: a wrong method falls to the /api/
	// fallback below and answers 404 not_found.
	if st != nil {
		d := apiDeps{st: st, version: version, ai: ai.New(ai.LoadConfig())}
		mux.HandleFunc("GET /api/processes", d.listProcesses)
		mux.HandleFunc("POST /api/processes", d.createProcess)
		mux.HandleFunc("POST /api/processes/{id}/archive", d.archiveProcess)
		mux.HandleFunc("POST /api/processes/{id}/restore", d.restoreProcess)
		mux.HandleFunc("GET /api/processes/{id}/versions", d.listVersions)
		mux.HandleFunc("POST /api/processes/{id}/versions", d.createVersion)
		mux.HandleFunc("GET /api/versions/{id}", d.readVersion)
		mux.HandleFunc("PUT /api/versions/{id}", d.updateVersion)
		mux.HandleFunc("POST /api/versions/{id}/validate", d.validateVersion)
		mux.HandleFunc("POST /api/versions/{id}/freeze", d.freezeVersion)
		mux.HandleFunc("POST /api/versions/{id}/publish", d.publishVersion)
		mux.HandleFunc("POST /api/versions/{id}/fork", d.forkVersion)
		mux.HandleFunc("POST /api/cases", d.createCase)
		mux.HandleFunc("GET /api/cases/{id}", d.readCase)
		mux.HandleFunc("GET /api/cases/{id}/events", d.listEvents)
		mux.HandleFunc("POST /api/cases/{id}/commands", d.runCommand)
		mux.HandleFunc("GET /api/cases/{id}/verify", d.verifyCase)
		mux.HandleFunc("GET /api/versions/{id}/supervision", d.supervision)
		mux.HandleFunc("GET /api/audit", d.audit)
		mux.HandleFunc("GET /api/audit/verify", d.auditVerify)
		mux.HandleFunc("GET /api/inbox", d.listInbox)
		mux.HandleFunc("GET /api/users", d.listUsers)
		mux.HandleFunc("POST /api/ai/generate-tests", d.generateTests)
		mux.HandleFunc("GET /api/versions/{id}/coverage", d.coverage)
		mux.HandleFunc("POST /api/ai/policy-to-process", d.policyToProcess)
		mux.HandleFunc("POST /api/ai/explain-check", d.explainCheck)
		mux.HandleFunc("POST /api/ai/change-process", d.changeProcess)
		mux.HandleFunc("POST /api/ai/restate-change", d.restateChange)
		mux.HandleFunc("POST /api/cases/{id}/documents", d.uploadDocument)
		mux.HandleFunc("GET /api/cases/{id}/documents", d.listCaseDocuments)
		mux.HandleFunc("GET /api/documents/{id}", d.readDocument)
		mux.HandleFunc("GET /api/documents/{id}/bytes", d.readDocumentBytes)
		mux.HandleFunc("POST /api/documents/{id}/zones", d.documentZones)
		mux.HandleFunc("POST /api/documents/{id}/read", d.documentRead)
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

// writeJSON writes one JSON answer with the status.
func writeJSON(w http.ResponseWriter, status int, body any) {
	b, err := json.Marshal(body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

// writeStoreError maps a store error to the API answer. The store
// returns untyped errors, so the mapping reads the error text.
func writeStoreError(w http.ResponseWriter, err error) {
	text := err.Error()
	// <kind> <id> does not exist: 404, or 403 for the user kind.
	for _, kind := range []string{"user", "process", "version", "case", "document"} {
		prefix := kind + " "
		suffix := " does not exist"
		if strings.HasPrefix(text, prefix) && strings.HasSuffix(text, suffix) {
			id := strings.TrimSuffix(strings.TrimPrefix(text, prefix), suffix)
			if kind == "user" {
				writeError(w, http.StatusForbidden, "forbidden", "unknown user "+id)
				return
			}
			writeError(w, http.StatusNotFound, "not_found", "no "+kind+" "+id)
			return
		}
	}
	// version <id> is not a draft, version <id> is not frozen: 409.
	if strings.HasPrefix(text, "version ") &&
		(strings.Contains(text, " is not a ") || strings.Contains(text, " is not ")) {
		writeError(w, http.StatusConflict, "conflict", text)
		return
	}
	writeError(w, http.StatusInternalServerError, "internal",
		"cannot complete the request")
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

// writeErrorDetails writes the JSON error body with one object per
// detail: {"path": ..., "message": ...}. A nil or empty slice gives
// []. It serves the AI answers that failed validation.
func writeErrorDetails(w http.ResponseWriter, status int, code,
	message string, errs []process.Error) {
	details := make([]process.Error, 0, len(errs))
	details = append(details, errs...)
	var body struct {
		Error struct {
			Code    string          `json:"code"`
			Message string          `json:"message"`
			Details []process.Error `json:"details"`
		} `json:"error"`
	}
	body.Error.Code = code
	body.Error.Message = message
	body.Error.Details = details
	b, _ := json.Marshal(body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}
