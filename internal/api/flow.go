package api

// The flow route: GET /api/versions/{id}/flow?days=N. The flow
// figures of one version for the live supervision: the closed cases
// per end with the average lead time, the passes per edge, the
// returns, and the work of today. The route reads the events of
// each case of the version, test cases included.

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
)

// flowEnd is one end node of the flow answer.
type flowEnd struct {
	NodeID       string  `json:"node_id"`
	Cases        int     `json:"cases"`
	AvgLeadHours float64 `json:"avg_lead_hours"`
}

// flowEdge is one edge of the flow answer.
type flowEdge struct {
	EdgeID string `json:"edge_id"`
	Passes int    `json:"passes"`
}

// flowToday holds the counts of today, since 00:00 UTC.
type flowToday struct {
	People int `json:"people"`
	Rules  int `json:"rules"`
}

// flowAnswer is the body of the flow route.
type flowAnswer struct {
	Days    int        `json:"days"`
	Closed  int        `json:"closed"`
	Ends    []flowEnd  `json:"ends"`
	Edges   []flowEdge `json:"edges"`
	Returns int        `json:"returns"`
	Today   flowToday  `json:"today"`
}

// peopleEvents are the event types of the commands take, submit,
// decide and sign.
var peopleEvents = map[string]bool{
	engine.EventStepAssigned:   true,
	engine.EventDataSubmitted:  true,
	engine.EventDecisionMade:   true,
	engine.EventSignatureAdded: true,
}

// flow answers GET /api/versions/{id}/flow.
func (d apiDeps) flow(w http.ResponseWriter, r *http.Request) {
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
	days := 30
	if q := r.URL.Query().Get("days"); q != "" {
		n, err := strconv.Atoi(q)
		if err != nil || n < 1 || n > 90 {
			writeError(w, http.StatusBadRequest, "invalid_query",
				"days must hold 1 to 90")
			return
		}
		days = n
	}
	cases, err := d.st.ListCases(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}

	now := time.Now().UTC()
	from := now.Add(-time.Duration(days) * 24 * time.Hour)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	ans := flowAnswer{Days: days, Ends: []flowEnd{}, Edges: []flowEdge{}}
	endIdx := map[string]int{}
	leadSum := map[string]float64{}
	for _, n := range def.Nodes {
		if n.Type == "end" {
			endIdx[n.ID] = len(ans.Ends)
			ans.Ends = append(ans.Ends, flowEnd{NodeID: n.ID})
		}
	}
	nodeType := map[string]string{}
	for _, n := range def.Nodes {
		nodeType[n.ID] = n.Type
	}
	edgeIdx := map[string]int{}
	fromGateway := map[string]bool{}
	for _, e := range def.Edges {
		edgeIdx[e.ID] = len(ans.Edges)
		ans.Edges = append(ans.Edges, flowEdge{EdgeID: e.ID})
		fromGateway[e.ID] = nodeType[e.From] == "gateway"
	}
	back := backEdges(def)

	for _, c := range cases {
		if c.VersionID != id {
			continue
		}
		events, err := d.st.ListEvents(r.Context(), c.ID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		for _, e := range events {
			inPeriod := !e.At.Before(from)
			today := !e.At.Before(midnight)
			switch {
			case e.Type == engine.EventEdgeTaken:
				var p engine.EdgeTakenPayload
				if json.Unmarshal(e.Payload, &p) != nil {
					continue
				}
				i, ok := edgeIdx[p.EdgeID]
				if !ok {
					continue
				}
				if inPeriod {
					ans.Edges[i].Passes++
					if back[p.EdgeID] {
						ans.Returns++
					}
				}
				if today && fromGateway[p.EdgeID] {
					ans.Today.Rules++
				}
			case e.Type == engine.EventCaseClosed && inPeriod:
				var p engine.CaseClosedPayload
				if json.Unmarshal(e.Payload, &p) != nil {
					continue
				}
				if i, ok := endIdx[p.NodeID]; ok {
					ans.Ends[i].Cases++
					leadSum[p.NodeID] += e.At.Sub(events[0].At).Hours()
				}
			case peopleEvents[e.Type] && today:
				ans.Today.People++
			}
		}
	}

	for i, end := range ans.Ends {
		ans.Closed += end.Cases
		if end.Cases > 0 {
			ans.Ends[i].AvgLeadHours =
				math.Round(leadSum[end.NodeID]/float64(end.Cases)*10) / 10
		}
	}
	writeJSON(w, http.StatusOK, ans)
}

// backEdges gives the back edges of a definition: the edges that go
// to a node on the stack of a depth-first walk from the start, so
// the edges that close a loop. The nodes that the start does not
// reach continue the walk, in definition order.
func backEdges(def process.Definition) map[string]bool {
	back := map[string]bool{}
	open := map[string]bool{}
	seen := map[string]bool{}
	var visit func(id string)
	visit = func(id string) {
		seen[id], open[id] = true, true
		for _, e := range def.Edges {
			if e.From != id {
				continue
			}
			if open[e.To] {
				back[e.ID] = true
			} else if !seen[e.To] {
				visit(e.To)
			}
		}
		open[id] = false
	}
	for _, n := range def.Nodes {
		if n.Type == "start" {
			visit(n.ID)
		}
	}
	for _, n := range def.Nodes {
		if !seen[n.ID] {
			visit(n.ID)
		}
	}
	return back
}
