// Package coverage counts, for each edge of a process definition,
// how many test cases took it. The counts come from edge_taken
// events.
package coverage

import (
	"encoding/json"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
)

// EdgeCount is the take count of one edge.
type EdgeCount struct {
	EdgeID string
	Count  int
}

// Report lists every edge of the definition, in definition order.
type Report struct {
	Edges []EdgeCount
}

// Red returns the ids of the edges with a count of 0, in definition
// order.
func (r Report) Red() []string {
	var out []string
	for _, e := range r.Edges {
		if e.Count == 0 {
			out = append(out, e.EdgeID)
		}
	}
	return out
}

// Taken returns the number of edges with a count above 0.
func (r Report) Taken() int {
	n := 0
	for _, e := range r.Edges {
		if e.Count > 0 {
			n++
		}
	}
	return n
}

// OfCases builds the report of one version. def gives the edges in
// order. eventsByCase holds the events of one test case per entry,
// keyed by case id. An edge counts once per case that took it, also
// when the case took it several times. An edge_taken payload that
// names an edge outside the definition is ignored.
func OfCases(def process.Definition, eventsByCase map[string][]engine.Event) Report {
	// One set of edge ids per case.
	sets := make(map[string]map[string]bool, len(eventsByCase))
	for caseID, events := range eventsByCase {
		set := make(map[string]bool)
		for _, e := range events {
			if e.Type != engine.EventEdgeTaken {
				continue
			}
			var p engine.EdgeTakenPayload
			// A payload that does not unmarshal leaves the
			// zero id "". No definition edge has the id "",
			// so the event names an edge outside the
			// definition and is ignored.
			_ = json.Unmarshal(e.Payload, &p)
			set[p.EdgeID] = true
		}
		sets[caseID] = set
	}
	// One count per definition edge, over the sets. make keeps
	// Edges never nil, also for an empty input.
	edges := make([]EdgeCount, 0, len(def.Edges))
	for _, edge := range def.Edges {
		n := 0
		for _, set := range sets {
			if set[edge.ID] {
				n++
			}
		}
		edges = append(edges, EdgeCount{EdgeID: edge.ID, Count: n})
	}
	return Report{Edges: edges}
}
