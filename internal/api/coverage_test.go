package api

// The tests of the coverage route. Each row opens a fresh store and
// seeds the test cases it needs. The route makes no AI call.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// coverageBody is the decoded answer of the coverage route.
type coverageBody struct {
	VersionID string `json:"version_id"`
	Taken     int    `json:"taken"`
	Total     int    `json:"total"`
	Edges     []struct {
		EdgeID string `json:"edge_id"`
		Count  int    `json:"count"`
	} `json:"edges"`
}

// decodeCoverage unmarshals one answer of the coverage route.
func decodeCoverage(t *testing.T, rec *httptest.ResponseRecorder) coverageBody {
	t.Helper()
	var body coverageBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal answer: %v: %s", err, rec.Body.String())
	}
	return body
}

// checkRow1Report asserts the report of row 1: 14 edges in
// definition order, e01 taken once, every other edge at 0. A start
// emits 3 events and takes e01 only; the empty case adds nothing.
func checkRow1Report(t *testing.T, body coverageBody) {
	t.Helper()
	if body.Total != 14 {
		t.Errorf("total = %d, want 14", body.Total)
	}
	if body.Taken != 1 {
		t.Errorf("taken = %d, want 1", body.Taken)
	}
	if len(body.Edges) != 14 {
		t.Fatalf("edges = %d, want 14", len(body.Edges))
	}
	for i, e := range body.Edges {
		if e.EdgeID != red14[i] {
			t.Errorf("edges[%d].edge_id = %q, want %q (definition order)",
				i, e.EdgeID, red14[i])
		}
		want := 0
		if i == 0 {
			want = 1
		}
		if e.Count != want {
			t.Errorf("%s count = %d, want %d", e.EdgeID, e.Count, want)
		}
	}
}

// 1.
func TestCoverageReport(t *testing.T) {
	newTestAPI(t)
	seedCase(t, seedVersionID, []cmdRow{cmdStart})
	createCase(t, seedVersionID, true)

	rec := do(t, "GET", "/api/versions/"+seedVersionID+"/coverage", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeCoverage(t, rec)
	if body.VersionID != seedVersionID {
		t.Errorf("version_id = %q, want %q", body.VersionID, seedVersionID)
	}
	checkRow1Report(t, body)
}

// 2.
func TestCoverageIgnoresNonTestCases(t *testing.T) {
	newTestAPI(t)
	seedCase(t, seedVersionID, []cmdRow{cmdStart})
	createCase(t, seedVersionID, true)
	// A non-test case of the same version, started: its events do
	// not count.
	nonTest := createCase(t, seedVersionID, false)
	rec := do(t, "POST", "/api/cases/"+nonTest+"/commands",
		cmdStart.body, cmdStart.user)
	if rec.Code != http.StatusOK {
		t.Fatalf("command status = %d: %s", rec.Code, rec.Body.String())
	}

	rec = do(t, "GET", "/api/versions/"+seedVersionID+"/coverage", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	checkRow1Report(t, decodeCoverage(t, rec))
}

// 3.
func TestCoverageUnknownVersion(t *testing.T) {
	newTestAPI(t)

	rec := do(t, "GET", "/api/versions/ghost/coverage", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no version ghost")
}
