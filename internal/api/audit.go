package api

// The audit routes: the newest events of every case, and the hash
// chain check of every case. The view is read only.

import (
	"net/http"
	"strconv"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// audit answers GET /api/audit?limit=N. An absent limit gives 50; a
// present limit must parse as an integer from 1 to 500.
func (d apiDeps) audit(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 500 {
			writeError(w, http.StatusBadRequest, "invalid_limit",
				"the limit must be between 1 and 500")
			return
		}
		limit = n
	}
	rows, err := d.st.ListRecentEvents(r.Context(), limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if rows == nil {
		rows = []store.EventRow{}
	}
	total, err := d.st.CountEvents(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": rows, "total": total})
}

// brokenChain is one case with a broken hash chain: the case id and
// the first bad seq.
type brokenChain struct {
	CaseID string `json:"case_id"`
	Seq    int    `json:"seq"`
}

// auditVerify answers GET /api/audit/verify: the hash chain check of
// every case. A case with no event counts as verified.
func (d apiDeps) auditVerify(w http.ResponseWriter, r *http.Request) {
	cases, err := d.st.ListCases(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	broken := []brokenChain{}
	eventCount := 0
	for _, c := range cases {
		events, err := d.st.ListEvents(r.Context(), c.ID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		eventCount += len(events)
		if len(events) == 0 {
			continue
		}
		if bad := engine.Verify(events); bad > 0 {
			broken = append(broken, brokenChain{CaseID: c.ID, Seq: bad})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"cases":  len(cases),
		"events": eventCount,
		"broken": broken,
	})
}
