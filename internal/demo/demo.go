// Package demo is a small core banking service for the demo of the
// example process.
package demo

import (
	"encoding/json"
	"net/http"
)

// Handler serves the two demo endpoints of the core banking:
// GET /blacklist?client_id=<id> -> {"listed": <bool>}
// GET /loans?client_id=<id> -> {"monthly_total": <number>}
// The data is fixed: the client ids "blocked" and "loaded", and
// every other id. A missing client_id is "every other id", because
// the engine fetch sends no query. No write, no state.
func Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /blacklist", func(w http.ResponseWriter, r *http.Request) {
		write(w, http.StatusOK, map[string]any{"listed": r.URL.Query().Get("client_id") == "blocked"})
	})
	mux.HandleFunc("GET /loans", func(w http.ResponseWriter, r *http.Request) {
		total := 0.0
		if r.URL.Query().Get("client_id") == "loaded" {
			total = 800.0
		}
		write(w, http.StatusOK, map[string]any{"monthly_total": total})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		write(w, http.StatusNotFound, map[string]any{"error": map[string]any{
			"code": "not_found", "message": "no such endpoint", "details": []any{},
		}})
	})
	return mux
}

func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
