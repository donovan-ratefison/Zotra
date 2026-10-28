package api

// The tests of the users route (lot 3.1): the seeded users, and the
// no-store fallback.

import (
	"net/http"
	"testing"
	"testing/fstest"
)

// 1. The five seeded users, in id order, with the seed names and
// role ids.
func TestListUsers(t *testing.T) {
	newTestAPI(t)

	rec := do(t, "GET", "/api/users", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/users: status %d, want 200: %s",
			rec.Code, rec.Body.String())
	}
	users, ok := decode(t, rec)["users"].([]any)
	if !ok {
		t.Fatalf("users is not a list: %s", rec.Body.String())
	}
	if len(users) != 5 {
		t.Fatalf("users = %d entries, want 5", len(users))
	}
	want := []struct{ id, name, role string }{
		{"u-advisor", "Demo Advisor", "advisor"},
		{"u-analyst", "Demo Analyst", "analyst"},
		{"u-backoffice", "Demo Back-office", "backoffice"},
		{"u-director", "Demo Director", "director"},
		{"u-legal", "Demo Legal Officer", "legal"},
	}
	for i, w := range want {
		u, ok := users[i].(map[string]any)
		if !ok {
			t.Fatalf("user %d is not an object: %s", i, rec.Body.String())
		}
		if u["id"] != w.id {
			t.Errorf("user %d id = %v, want %s", i, u["id"], w.id)
		}
		if u["name"] != w.name {
			t.Errorf("user %d name = %v, want %s", i, u["name"], w.name)
		}
		roles, ok := u["role_ids"].([]any)
		if !ok || len(roles) != 1 || roles[0] != w.role {
			t.Errorf("user %d role_ids = %v, want [%s]", i, u["role_ids"], w.role)
		}
	}
}

// 2. A handler with no store answers 404 through the /api/ fallback.
func TestListUsersNoStore(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<p>index</p>")}}
	testAPIHandler = NewHandler(static, "v-test", nil, "")

	rec := do(t, "GET", "/api/users", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no route for GET /api/users")
}
