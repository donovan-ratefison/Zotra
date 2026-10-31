package api

// The tests of the audit routes. Each test opens a fresh store and
// seeds its chains: the intact chains run through real commands, the
// broken chain is hand built with garbage hashes.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// auditAnswer is the decoded body of the audit route.
type auditAnswer struct {
	Events []store.EventRow `json:"events"`
	Total  int              `json:"total"`
}

// verifyAnswer is the decoded body of the audit verify route.
type verifyAnswer struct {
	Cases  int           `json:"cases"`
	Events int           `json:"events"`
	Broken []brokenChain `json:"broken"`
}

// decodeAudit unmarshals one answer of the audit route.
func decodeAudit(t *testing.T, rec *httptest.ResponseRecorder) auditAnswer {
	t.Helper()
	var body auditAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal answer: %v: %s", err, rec.Body.String())
	}
	return body
}

// decodeVerify unmarshals one answer of the audit verify route.
func decodeVerify(t *testing.T, rec *httptest.ResponseRecorder) verifyAnswer {
	t.Helper()
	var body verifyAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal answer: %v: %s", err, rec.Body.String())
	}
	return body
}

// auditEvents builds a case_created chain of n events, all at the
// given time. The route reads rows, it does not fold.
func auditEvents(caseID, versionID string, n int, at time.Time) []engine.Event {
	events := make([]engine.Event, n)
	for i := 0; i < n; i++ {
		payload := `{"version_id":"` + versionID + `","data":{}}`
		if i > 0 {
			payload = `{"edge_id":"e01"}`
		}
		typ := "case_created"
		if i > 0 {
			typ = "edge_taken"
		}
		events[i] = engine.Event{
			CaseID: caseID, Seq: i + 1, Type: typ, At: at, Actor: "system",
			Payload: json.RawMessage(payload), PrevHash: "p", Hash: "h",
		}
	}
	return events
}

// seedAuditCase appends n events of one case at the given time.
func seedAuditCase(t *testing.T, st *store.Store, versionID string, n int, at time.Time) string {
	t.Helper()
	caseID := createCase(t, versionID, false)
	if err := st.AppendEvents(context.Background(), caseID,
		auditEvents(caseID, versionID, n, at)); err != nil {
		t.Fatalf("append audit events: %v", err)
	}
	return caseID
}

// 1.
func TestAuditLimitAndTotal(t *testing.T) {
	st := newSupTestAPI(t)
	now := time.Now().UTC().Truncate(time.Second)
	seedAuditCase(t, st, seedVersionID, 1, now.Add(-3*time.Hour))
	seedAuditCase(t, st, seedVersionID, 1, now.Add(-2*time.Hour))
	newest := seedAuditCase(t, st, seedVersionID, 2, now.Add(-1*time.Hour))

	rec := do(t, "GET", "/api/audit?limit=2", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeAudit(t, rec)

	if len(body.Events) != 2 {
		t.Fatalf("events = %d, want 2", len(body.Events))
	}
	if body.Total != 4 {
		t.Errorf("total = %d, want 4", body.Total)
	}
	// Newest first: both rows carry the reference of the newest case.
	for i, e := range body.Events {
		if e.CaseID != newest {
			t.Errorf("events[%d].case_id = %s, want %s", i, e.CaseID, newest)
		}
		if e.Reference == "" {
			t.Errorf("events[%d]: empty reference", i)
		}
	}
	if body.Events[0].Seq != 2 || body.Events[1].Seq != 1 {
		t.Errorf("seqs = %d, %d, want 2 then 1 (newest first)",
			body.Events[0].Seq, body.Events[1].Seq)
	}
}

// 2.
func TestAuditRefusesBadLimit(t *testing.T) {
	newSupTestAPI(t)
	for _, raw := range []string{"0", "501", "x"} {
		rec := do(t, "GET", "/api/audit?limit="+raw, "", "")
		checkError(t, rec, http.StatusBadRequest, "invalid_limit",
			"the limit must be between 1 and 500")
	}
}

// 3.
func TestAuditDefaultLimit(t *testing.T) {
	st := newSupTestAPI(t)
	seedAuditCase(t, st, seedVersionID, 2, time.Now().UTC().Truncate(time.Second))

	rec := do(t, "GET", "/api/audit", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeAudit(t, rec)
	if len(body.Events) != 2 {
		t.Errorf("events = %d, want 2", len(body.Events))
	}
	if body.Total != 2 {
		t.Errorf("total = %d, want 2", body.Total)
	}
}

// 4.
func TestAuditVerifyFindsBrokenChain(t *testing.T) {
	st := newSupTestAPI(t)
	seedCase(t, seedVersionID, []cmdRow{cmdStart})
	seedCase(t, seedVersionID, []cmdRow{cmdStart})
	now := time.Now().UTC().Truncate(time.Second)
	bad := createCase(t, seedVersionID, false)
	broken := []engine.Event{
		{CaseID: bad, Seq: 1, Type: "case_created", At: now, Actor: "system",
			Payload: json.RawMessage(
				`{"version_id":"` + seedVersionID + `","data":{}}`),
			PrevHash: engine.ZeroHash, Hash: "bad1"},
		{CaseID: bad, Seq: 2, Type: "edge_taken", At: now, Actor: "system",
			Payload: json.RawMessage(`{"edge_id":"e01"}`),
			PrevHash: "bad1", Hash: "bad2"},
	}
	if err := st.AppendEvents(context.Background(), bad, broken); err != nil {
		t.Fatalf("append broken chain: %v", err)
	}

	rec := do(t, "GET", "/api/audit/verify", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeVerify(t, rec)

	if body.Cases != 3 {
		t.Errorf("cases = %d, want 3", body.Cases)
	}
	if body.Events != 8 {
		t.Errorf("events = %d, want 8", body.Events)
	}
	if len(body.Broken) != 1 || body.Broken[0].CaseID != bad ||
		body.Broken[0].Seq != 1 {
		t.Errorf("broken = %+v, want [{%s 1}]", body.Broken, bad)
	}
}

// 5.
func TestAuditVerifyIntactChains(t *testing.T) {
	newSupTestAPI(t)
	seedCase(t, seedVersionID, []cmdRow{cmdStart})
	seedCase(t, seedVersionID, []cmdRow{cmdStart})

	rec := do(t, "GET", "/api/audit/verify", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeVerify(t, rec)

	if body.Cases != 2 {
		t.Errorf("cases = %d, want 2", body.Cases)
	}
	if body.Events != 6 {
		t.Errorf("events = %d, want 6", body.Events)
	}
	if body.Broken == nil || len(body.Broken) != 0 {
		t.Errorf("broken = %v, want []", body.Broken)
	}
}

// T4 and T5: the audit list and total skip the test case; the chain
// check still reads both cases.
func TestAuditSkipsTestCase(t *testing.T) {
	newSupTestAPI(t)
	realCase := analysisCaseOf(t, false)
	test := analysisCaseOf(t, true)

	rec := do(t, "GET", "/api/audit?limit=500", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeAudit(t, rec)
	if body.Total != 11 || len(body.Events) != 11 {
		t.Errorf("total = %d, events = %d, want 11 and 11",
			body.Total, len(body.Events))
	}
	for i, e := range body.Events {
		if e.CaseID != realCase {
			t.Errorf("events[%d].case_id = %s, want %s (not the test case %s)",
				i, e.CaseID, realCase, test)
		}
	}

	rec = do(t, "GET", "/api/audit/verify", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("verify status = %d: %s", rec.Code, rec.Body.String())
	}
	verify := decodeVerify(t, rec)
	if verify.Cases != 2 || verify.Events != 22 || len(verify.Broken) != 0 {
		t.Errorf("verify = %+v, want 2 cases, 22 events, no break", verify)
	}
}
