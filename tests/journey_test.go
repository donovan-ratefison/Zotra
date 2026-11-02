// Package tests holds the black-box tests that cross the packages.
package tests

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/donovan-ratefison/zotra/internal/api"
	"github.com/donovan-ratefison/zotra/internal/store"
)

const (
	defaultTestURL = "postgres://zotra:zotra@127.0.0.1:5434/zotra_test?sslmode=disable"
	defaultAdminDB = "zotra"
)

// openTestStore creates the test database if it is missing, wipes its
// schema, and opens the store (migrate plus seed). It is a copy of the
// helper of the api tests: Go does not export a _test.go helper.
func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()
	raw := os.Getenv("ZOTRA_TEST_DATABASE_URL")
	if raw == "" {
		raw = defaultTestURL
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse test url: %v", err)
	}
	testDB := strings.TrimPrefix(u.Path, "/")
	adminDB := os.Getenv("ZOTRA_TEST_ADMIN_DB")
	if adminDB == "" {
		adminDB = defaultAdminDB
	}
	adminURL := *u
	adminURL.Path = "/" + adminDB

	admin, err := pgxpool.New(ctx, adminURL.String())
	if err != nil {
		t.Fatalf("connect to admin database %s: %v", adminDB, err)
	}
	// A duplicate database (SQLSTATE 42P04) means it already exists.
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+testDB); err != nil {
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42P04" {
			admin.Close()
			t.Fatalf("create test database %s: %v", testDB, err)
		}
	}
	admin.Close()

	wipe, err := pgxpool.New(ctx, raw)
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	for _, stmt := range []string{"DROP SCHEMA public CASCADE", "CREATE SCHEMA public"} {
		if _, err := wipe.Exec(ctx, stmt); err != nil {
			wipe.Close()
			t.Fatalf("wipe schema: %v", err)
		}
	}
	wipe.Close()

	s, err := store.Open(ctx, raw)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

// client sends the calls of the journey to one server.
type client struct {
	t    *testing.T
	base string
}

// do sends one call, checks the status, and decodes the JSON answer.
// An empty user sends no X-Zotra-User header.
func (c client) do(method, path, user, contentType string, body io.Reader, want int) map[string]any {
	c.t.Helper()
	req, err := http.NewRequest(method, c.base+path, body)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if user != "" {
		req.Header.Set("X-Zotra-User", user)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != want {
		c.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		c.t.Fatalf("%s %s: decode %q: %v", method, path, raw, err)
	}
	return out
}

func (c client) json(method, path, user string, body any, want int) map[string]any {
	c.t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			c.t.Fatalf("marshal: %v", err)
		}
		r = bytes.NewReader(b)
	}
	return c.do(method, path, user, "application/json", r, want)
}

// command runs one case command and returns the new state.
func (c client) command(caseID, user string, body map[string]any) map[string]any {
	c.t.Helper()
	return c.json(http.MethodPost, "/api/cases/"+caseID+"/commands", user, body, http.StatusOK)["state"].(map[string]any)
}

// refuse runs one command that the API must refuse, and checks the
// status, the error code and the message.
func (c client) refuse(caseID, user string, body map[string]any, status int, code, message string) {
	c.t.Helper()
	got := c.json(http.MethodPost, "/api/cases/"+caseID+"/commands", user, body, status)
	e, _ := got["error"].(map[string]any)
	if e["code"] != code || e["message"] != message {
		c.t.Fatalf("refusal: got %v, want %s %q", got, code, message)
	}
}

// upload sends one PNG scan to the case, as the user, and returns its
// id and its SHA-256 hex. Each n gives other bytes, so each scan is unique.
func (c client) upload(caseID, user, name string, n int) (string, string) {
	c.t.Helper()
	data := append([]byte("\x89PNG\r\n\x1a\n"), []byte(fmt.Sprintf("journey scan %d", n))...)
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", name+".png")
	if err == nil {
		_, err = fw.Write(data)
	}
	if err == nil {
		err = mw.Close()
	}
	if err != nil {
		c.t.Fatalf("multipart: %v", err)
	}
	got := c.do(http.MethodPost, "/api/cases/"+caseID+"/documents", user,
		mw.FormDataContentType(), &buf, http.StatusCreated)
	sum := sha256.Sum256(data)
	return got["document"].(map[string]any)["id"].(string), hex.EncodeToString(sum[:])
}

// atNode fails the test if the state is not open at the node.
func atNode(t *testing.T, row int, state map[string]any, node string) {
	t.Helper()
	if state["status"] != "open" || state["node_id"] != node {
		t.Fatalf("row %d: status %v at %v, want open at %s", row, state["status"], state["node_id"], node)
	}
	t.Logf("row %d: case at node %s", row, node)
}

// TestJourney plays the full life of a home loan through the public
// HTTP API: design, publish, one real case to the approved end, and
// the hash chain check.
func TestJourney(t *testing.T) {
	// The journey makes no AI call. With off, an AI call fails: the test
	// cannot reach the network or spend money.
	t.Setenv("ZOTRA_AI_MODE", "off")

	sources := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/blacklist":
			_, _ = io.WriteString(w, `{"listed": false}`)
		case "/loans":
			_, _ = io.WriteString(w, `{"monthly_total": 0}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(sources.Close)

	st := openTestStore(t)
	srv := httptest.NewServer(api.NewHandler(fstest.MapFS{}, "test", st, t.TempDir()))
	t.Cleanup(srv.Close)
	c := client{t: t, base: srv.URL}

	// The definition of the example, with the sources on the stub.
	raw, err := os.ReadFile("../examples/home-loan/process.json")
	if err != nil {
		t.Fatalf("read definition: %v", err)
	}
	var def map[string]any
	if err := json.Unmarshal(raw, &def); err != nil {
		t.Fatalf("decode definition: %v", err)
	}
	paths := map[string]string{"blacklist": "/blacklist", "existing_loans": "/loans"}
	for _, s := range def["sources"].([]any) {
		src := s.(map[string]any)
		path, ok := paths[src["id"].(string)]
		if !ok {
			t.Fatalf("unknown source %v", src["id"])
		}
		src["url"] = sources.URL + path
	}

	// Row 1: health.
	if got := c.json(http.MethodGet, "/api/health", "", nil, http.StatusOK); got["status"] != "ok" {
		t.Fatalf("row 1: health %v", got)
	}
	t.Log("row 1: health ok")

	// Rows 2 to 5: design and publish.
	proc := c.json(http.MethodPost, "/api/processes", "", map[string]any{"name": "Journey home loan"}, http.StatusCreated)
	procID := proc["process"].(map[string]any)["id"].(string)
	t.Log("row 2: process created")
	ver := c.json(http.MethodPost, "/api/processes/"+procID+"/versions", "",
		map[string]any{"label": "Journey", "definition": def}, http.StatusCreated)
	verID := ver["version"].(map[string]any)["id"].(string)
	t.Log("row 3: version created")
	if errs, _ := c.json(http.MethodPost, "/api/versions/"+verID+"/validate", "", nil, http.StatusOK)["errors"].([]any); len(errs) != 0 {
		t.Fatalf("row 4: validation errors %v", errs)
	}
	t.Log("row 4: version valid")
	c.json(http.MethodPost, "/api/versions/"+verID+"/freeze", "", nil, http.StatusOK)
	if got := c.json(http.MethodPost, "/api/versions/"+verID+"/publish", "", nil, http.StatusOK); got["version"].(map[string]any)["status"] != "published" {
		t.Fatalf("row 5: publish %v", got)
	}
	t.Log("row 5: version published")

	// Rows 6 and 7: a real case starts.
	created := c.json(http.MethodPost, "/api/cases", "u-advisor",
		map[string]any{"version_id": verID, "is_test": false}, http.StatusCreated)
	caseID := created["case"].(map[string]any)["id"].(string)
	t.Log("row 6: case created")

	t.Run("R1 no user header", func(t *testing.T) {
		c := client{t: t, base: srv.URL}
		c.refuse(caseID, "", map[string]any{"type": "take"}, http.StatusUnauthorized,
			"unauthorized", "the X-Zotra-User header is required")
	})

	// Debt ratio 908.97 / 5000 = 0.1818, under 0.33.
	state := c.command(caseID, "u-advisor", map[string]any{"type": "start", "data": map[string]any{
		"client_name": "Journey Client", "profession": "Teacher", "amount": 150000,
		"duration_months": 240, "down_payment": 30000, "annual_rate": 0.04, "monthly_income": 5000}})
	atNode(t, 7, state, "entry")

	// Row 8: entry.
	c.command(caseID, "u-advisor", map[string]any{"type": "take"})
	ids := []string{}
	for k, name := range []string{"ID card", "Salary slips", "Bank statements", "Property title"} {
		id, _ := c.upload(caseID, "u-advisor", name, k)
		ids = append(ids, id)
	}
	state = c.command(caseID, "u-advisor", map[string]any{"type": "submit", "values": map[string]any{"documents": ids}})
	atNode(t, 8, state, "analysis")

	// Row 9: analysis.
	t.Run("R2 wrong role", func(t *testing.T) {
		c := client{t: t, base: srv.URL}
		c.refuse(caseID, "u-advisor", map[string]any{"type": "submit", "values": map[string]any{}},
			http.StatusForbidden, "forbidden", "step analysis waits for role analyst")
	})
	c.command(caseID, "u-analyst", map[string]any{"type": "take"})
	c.command(caseID, "u-analyst", map[string]any{"type": "submit", "values": map[string]any{
		"analysis_opinion": "favorable", "analysis_comment": "Stable income, the payment fits the budget."}})
	state = c.command(caseID, "u-analyst", map[string]any{"type": "decide", "decision": "favorable"})
	atNode(t, 9, state, "decision")

	// Row 10: decision, with a signature.
	c.command(caseID, "u-director", map[string]any{"type": "take"})
	_, sha := c.upload(caseID, "u-director", "Credit decision", 10)
	c.command(caseID, "u-director", map[string]any{"type": "sign", "document_hash": sha})
	c.command(caseID, "u-director", map[string]any{"type": "submit", "values": map[string]any{"credit_decision": "approve"}})
	t.Run("R3 empty decision", func(t *testing.T) {
		c := client{t: t, base: srv.URL}
		c.refuse(caseID, "u-director", map[string]any{"type": "decide", "decision": ""},
			http.StatusBadRequest, "invalid_command", "decision is required")
	})
	state = c.command(caseID, "u-director", map[string]any{"type": "decide", "decision": "approve"})
	atNode(t, 10, state, "offer")

	// Row 11: offer, with a signature.
	c.command(caseID, "u-legal", map[string]any{"type": "take"})
	c.upload(caseID, "u-legal", "Loan offer", 11)
	_, sha = c.upload(caseID, "u-legal", "Mortgage deed", 12)
	c.command(caseID, "u-legal", map[string]any{"type": "sign", "document_hash": sha})
	state = c.command(caseID, "u-legal", map[string]any{"type": "submit", "values": map[string]any{}})
	atNode(t, 11, state, "signing")

	// Row 12: signing.
	c.command(caseID, "u-advisor", map[string]any{"type": "take"})
	c.upload(caseID, "u-advisor", "Signed contract", 13)
	state = c.command(caseID, "u-advisor", map[string]any{"type": "submit", "values": map[string]any{}})
	atNode(t, 12, state, "release")

	// Row 13: release closes the case.
	c.command(caseID, "u-backoffice", map[string]any{"type": "take"})
	state = c.command(caseID, "u-backoffice", map[string]any{"type": "submit", "values": map[string]any{
		"release_date": time.Now().UTC().Add(48 * time.Hour).Format("2006-01-02")}})
	if state["status"] != "closed" || state["result"] != "approved" {
		t.Fatalf("row 13: status %v, result %v, want closed approved", state["status"], state["result"])
	}
	t.Log("row 13: case closed, result approved")

	t.Run("R4 take on a closed case", func(t *testing.T) {
		c := client{t: t, base: srv.URL}
		c.refuse(caseID, "u-backoffice", map[string]any{"type": "take"},
			http.StatusConflict, "conflict", "case closed")
	})

	// Rows 14 and 15: the hash chains.
	if got := c.json(http.MethodGet, "/api/cases/"+caseID+"/verify", "", nil, http.StatusOK); got["verify"] != float64(0) {
		t.Fatalf("row 14: verify %v, want 0", got["verify"])
	}
	t.Log("row 14: case chain intact")
	audit := c.json(http.MethodGet, "/api/audit/verify", "", nil, http.StatusOK)
	if broken, ok := audit["broken"].([]any); !ok || len(broken) != 0 {
		t.Fatalf("row 15: broken chains %v", audit["broken"])
	}
	t.Logf("row 15: audit verify, %v cases, %v events, no broken chain", audit["cases"], audit["events"])
}
