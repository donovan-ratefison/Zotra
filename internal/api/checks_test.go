package api

import (
	"net/http"
	"testing"
)

// getChecks calls the checks route and returns the decoded body.
func getChecks(t *testing.T, caseID string) map[string]any {
	t.Helper()
	rec := do(t, "GET", "/api/cases/"+caseID+"/checks", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("checks: status %d: %s", rec.Code, rec.Body.String())
	}
	return decode(t, rec)
}

// eventCount returns the number of events of the case.
func eventCount(t *testing.T, caseID string) int {
	t.Helper()
	rec := do(t, "GET", "/api/cases/"+caseID+"/events", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("events: status %d: %s", rec.Code, rec.Body.String())
	}
	return len(decode(t, rec)["events"].([]any))
}

// A1 to A5, E7.
func TestCaseChecks(t *testing.T) {
	newTestAPI(t)

	t.Run("A1 pass and E7 no write", func(t *testing.T) {
		caseID := analysisCase(t)
		before := eventCount(t, caseID)
		body := getChecks(t, caseID)
		if after := eventCount(t, caseID); after != before {
			t.Errorf("events = %d after the call, want %d", after, before)
		}
		if body["node_id"] != "analysis" {
			t.Errorf("node_id = %v, want analysis", body["node_id"])
		}
		checks := body["checks"].([]any)
		ids := []string{"analysis-debt-ratio", "analysis-blacklist", "analysis-existing-loans"}
		if len(checks) != len(ids) {
			t.Fatalf("checks = %v, want 3", checks)
		}
		for i, c := range checks {
			m := c.(map[string]any)
			if len(m) != 5 || m["id"] != ids[i] || m["passed"] != true || m["error"] != nil ||
				m["message"] == "" || m["expression"] == "" {
				t.Errorf("check %d = %v", i, m)
			}
		}
	})

	t.Run("A2 fail", func(t *testing.T) {
		// 300000 over 240 months at 3.5 percent with 4500 of income
		// gives a debt ratio of about 0.387, and no comment.
		caseID := seedCase(t, seedVersionID, []cmdRow{
			cmdStart,
			{entrySubmit("300000.0", "ID card", "Salary slips",
				"Bank statements", "Property title"), "u-advisor"},
		})
		first := getChecks(t, caseID)["checks"].([]any)[0].(map[string]any)
		if first["id"] != "analysis-debt-ratio" || first["passed"] != false || first["error"] != nil {
			t.Errorf("first check = %v, want passed false", first)
		}
	})

	t.Run("A3 unknown case", func(t *testing.T) {
		rec := do(t, "GET", "/api/cases/9b2f7c1e-4d3a-4e8b-9f61-2c5d8a7e0b13/checks", "", "")
		checkError(t, rec, http.StatusNotFound, "not_found",
			"no case 9b2f7c1e-4d3a-4e8b-9f61-2c5d8a7e0b13")
	})

	t.Run("A4 closed case", func(t *testing.T) {
		caseID := seedCase(t, seedVersionID, append(approvedRun("240000.0"),
			cmdDecide("approve", "u-director"), cmdEmptySubmit("u-legal"),
			cmdEmptySubmit("u-advisor"), cmdRelease))
		rec := do(t, "GET", "/api/cases/"+caseID+"/checks", "", "")
		checkError(t, rec, http.StatusConflict, "not_a_task", "the case is not on a task")
	})

	t.Run("A5 case not started", func(t *testing.T) {
		caseID := createCase(t, seedVersionID, true)
		rec := do(t, "GET", "/api/cases/"+caseID+"/checks", "", "")
		checkError(t, rec, http.StatusConflict, "not_a_task", "the case is not on a task")
	})
}
