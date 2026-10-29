package api

// The supervision route: the open cases of a version per step, with
// counts, lateness, a heat value per step and the load per
// participant. The view is read only.

import (
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"sort"
	"time"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
)

// supNode is one step of the supervision answer.
type supNode struct {
	NodeID      string `json:"node_id"`
	Open        int    `json:"open"`
	Late        int    `json:"late"`
	MedianHours int    `json:"median_hours"`
}

// supPerson is one assignee of the load card.
type supPerson struct {
	UserID string `json:"user_id"`
	Open   int    `json:"open"`
	Late   int    `json:"late"`
}

// supCase is one open case of the step table.
type supCase struct {
	CaseID    string         `json:"case_id"`
	Reference string         `json:"reference"`
	NodeID    string         `json:"node_id"`
	Assignee  string         `json:"assignee"`
	AgeHours  int            `json:"age_hours"`
	Late      bool           `json:"late"`
	Data      map[string]any `json:"data"`
}

// nodeCount holds the open and late counters of one step.
type nodeCount struct {
	open int
	late int
}

// supervision answers GET /api/versions/{id}/supervision.
func (d apiDeps) supervision(w http.ResponseWriter, r *http.Request) {
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
	now := time.Now().UTC()
	cases, err := d.st.ListCases(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}

	nodeByID := map[string]process.Node{}
	for _, n := range def.Nodes {
		nodeByID[n.ID] = n
	}
	agesByNode := map[string][]float64{}
	countsByNode := map[string]nodeCount{}
	personIdx := map[string]int{}
	people := []supPerson{}
	casesOut := []supCase{}
	totalOpen, totalLate := 0, 0

	for _, c := range cases {
		if c.VersionID != id {
			continue
		}
		_, events, st, err := d.foldCaseState(r.Context(), c)
		if err != nil {
			// A case that cannot fold is skipped, so the
			// supervision stays usable (the inbox precedent).
			slog.Warn("supervision: skip case", "case", c.ID, "error", err)
			continue
		}
		// A case with no event waits for start and counts nowhere.
		if len(events) == 0 || st.Status != engine.StatusOpen {
			continue
		}
		node, ok := nodeByID[st.NodeID]
		if !ok {
			continue
		}
		age := stepAgeHours(events, st.NodeID, now)
		late := node.DeadlineHours != nil && age > float64(*node.DeadlineHours)

		totalOpen++
		if late {
			totalLate++
		}
		agesByNode[st.NodeID] = append(agesByNode[st.NodeID], age)
		counts := countsByNode[st.NodeID]
		counts.open++
		if late {
			counts.late++
		}
		countsByNode[st.NodeID] = counts
		if st.Assignee != "" {
			if idx, ok := personIdx[st.Assignee]; ok {
				people[idx].Open++
				if late {
					people[idx].Late++
				}
			} else {
				personIdx[st.Assignee] = len(people)
				person := supPerson{UserID: st.Assignee, Open: 1}
				if late {
					person.Late = 1
				}
				people = append(people, person)
			}
		}
		casesOut = append(casesOut, supCase{
			CaseID:    c.ID,
			Reference: c.Reference,
			NodeID:    st.NodeID,
			Assignee:  st.Assignee,
			AgeHours:  int(math.Floor(age)),
			Late:      late,
			Data:      st.Data,
		})
	}

	nodes := []supNode{}
	for _, n := range def.Nodes {
		if n.Type == "start" {
			continue
		}
		nodes = append(nodes, supNode{
			NodeID:      n.ID,
			Open:        countsByNode[n.ID].open,
			Late:        countsByNode[n.ID].late,
			MedianHours: lowerMedian(agesByNode[n.ID]),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"version_id":  id,
		"total_open":  totalOpen,
		"total_late":  totalLate,
		"nodes":       nodes,
		"people":      people,
		"cases":       casesOut,
	})
}

// stepAgeHours gives the age of an open case in hours: now minus the
// at of the last step_entered with the payload node id of the state,
// else the at of the first event.
func stepAgeHours(events []engine.Event, nodeID string, now time.Time) float64 {
	at := events[0].At
	for _, e := range events {
		if e.Type != engine.EventStepEntered {
			continue
		}
		var p engine.StepEnteredPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil || p.NodeID != nodeID {
			continue
		}
		at = e.At
	}
	return now.Sub(at).Hours()
}

// lowerMedian gives the lower median of the ages, floored to an
// integer: the sorted value at index (n-1)/2. No age gives 0.
func lowerMedian(hours []float64) int {
	if len(hours) == 0 {
		return 0
	}
	sorted := slices.Clone(hours)
	sort.Float64s(sorted)
	return int(math.Floor(sorted[(len(sorted)-1)/2]))
}
