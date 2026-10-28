package api

// The coverage route: GET /api/versions/{id}/coverage. The branch
// coverage of the test cases of one version. The engine computes
// the counts: the route loads the test cases of the version and
// their events, and coverage.OfCases counts each edge.

import (
	"net/http"

	"github.com/donovan-ratefison/zotra/internal/coverage"
	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
)

// coverageEdgeDTO is one entry of the edges list of the answer.
type coverageEdgeDTO struct {
	EdgeID string `json:"edge_id"`
	Count  int    `json:"count"`
}

// coverage answers 200 with the report of one version: the taken
// and total counts, then one count per edge, in definition order.
// Only the test cases of the version count.
func (d apiDeps) coverage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	v, err := d.st.GetVersion(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	def, err := process.Decode(v.Definition)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	cs, err := d.st.ListCases(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	eventsByCase := map[string][]engine.Event{}
	for _, c := range cs {
		if c.VersionID != id || !c.IsTest {
			continue
		}
		events, err := d.st.ListEvents(r.Context(), c.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal",
				"cannot complete the request")
			return
		}
		eventsByCase[c.ID] = events
	}
	report := coverage.OfCases(def, eventsByCase)
	edges := make([]coverageEdgeDTO, len(report.Edges))
	for i, e := range report.Edges {
		edges[i] = coverageEdgeDTO{EdgeID: e.EdgeID, Count: e.Count}
	}
	writeJSON(w, http.StatusOK, struct {
		VersionID string            `json:"version_id"`
		Taken     int               `json:"taken"`
		Total     int               `json:"total"`
		Edges     []coverageEdgeDTO `json:"edges"`
	}{VersionID: id, Taken: report.Taken(), Total: len(report.Edges),
		Edges: edges})
}
