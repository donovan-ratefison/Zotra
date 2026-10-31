package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/donovan-ratefison/zotra/internal/api"
	"github.com/donovan-ratefison/zotra/internal/store"
)

func TestRunArgs(t *testing.T) { // R1 to R8
	rows := []struct {
		name, dbURL string
		args        []string
		want        string
		prefix      bool
	}{
		{"R1", "", nil, "ZOTRA_DATABASE_URL is required", false},
		{"R2", "x", []string{"-cases", "0"}, "-cases must hold 1 to 500", false},
		{"R3", "x", []string{"-cases", "501"}, "-cases must hold 1 to 500", false},
		{"R4", "x", []string{"-days", "0"}, "-days must hold 1 to 90", false},
		{"R5", "x", []string{"-days", "91"}, "-days must hold 1 to 90", false},
		{"R6", "x", []string{"-nope"}, "flag provided but not defined: -nope", false},
		{"R7", "x", []string{"-cases", "abc"}, `invalid value "abc" for flag -cases`, true},
		{"R8", "postgres://zotra:zotra@127.0.0.1:1/none?sslmode=disable", nil, "open store: ", true},
	}
	for _, r := range rows {
		err := run(context.Background(), r.args, r.dbURL, io.Discard)
		if err == nil {
			t.Errorf("%s: no error, want %q", r.name, r.want)
			continue
		}
		if got := err.Error(); got != r.want && !(r.prefix && strings.HasPrefix(got, r.want)) {
			t.Errorf("%s: error %q, want %q", r.name, got, r.want)
		}
	}
}

func TestVersionFlag(t *testing.T) { // V1, V2, H1
	var h1 strings.Builder
	if err := run(context.Background(), []string{"--version"}, "", &h1); err != nil || h1.String() != "zotra-history dev\n" {
		t.Errorf("H1: output %q, error %v", h1.String(), err)
	}
	var out strings.Builder
	if err := run(context.Background(), []string{"-version"}, "", &out); err != nil {
		t.Fatalf("V1: %v", err)
	}
	if got := out.String(); got != "zotra-history dev\n" {
		t.Errorf("V1: output %q", got)
	}
	err := run(context.Background(), nil, "", io.Discard)
	if err == nil || err.Error() != "ZOTRA_DATABASE_URL is required" {
		t.Errorf("V2: error %v", err)
	}
}

func TestHelpFlag(t *testing.T) { // H2
	for _, arg := range []string{"-h", "-help", "--help"} {
		var out strings.Builder
		if err := run(context.Background(), []string{arg}, "", &out); err != nil {
			t.Errorf("H2 %s: error %v", arg, err)
		}
		if out.String() != historyUsage {
			t.Errorf("H2 %s: output %q", arg, out.String())
		}
	}
}

// wipedDB creates the test database if it is missing, wipes its schema,
// and returns its URL. It copies the wipe of the api tests.
func wipedDB(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	raw := os.Getenv("ZOTRA_TEST_DATABASE_URL")
	if raw == "" {
		raw = "postgres://zotra:zotra@127.0.0.1:5434/zotra_test?sslmode=disable"
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse test url: %v", err)
	}
	testDB := strings.TrimPrefix(u.Path, "/")
	adminURL := *u
	adminURL.Path = "/zotra"
	if db := os.Getenv("ZOTRA_TEST_ADMIN_DB"); db != "" {
		adminURL.Path = "/" + db
	}
	admin, err := pgxpool.New(ctx, adminURL.String())
	if err != nil {
		t.Fatalf("connect to admin database: %v", err)
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
	defer wipe.Close()
	for _, stmt := range []string{"DROP SCHEMA public CASCADE", "CREATE SCHEMA public"} {
		if _, err := wipe.Exec(ctx, stmt); err != nil {
			t.Fatalf("wipe schema: %v", err)
		}
	}
	return raw
}

func openStore(t *testing.T, raw string) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), raw)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(st.Close)
	return st
}

func TestRefusal(t *testing.T) { // R9, R10
	ctx := context.Background()
	raw := wipedDB(t)
	st := openStore(t, raw)
	v, err := st.Fork(ctx, exampleVersionID, "other")
	if err != nil {
		t.Fatal(err)
	}
	c, err := st.CreateCase(ctx, v.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	want := "refused: real case " + c.Reference + " is on another version"
	if err := run(ctx, nil, raw, io.Discard); err == nil || err.Error() != want {
		t.Errorf("R9: error %v, want %q", err, want)
	}

	raw = wipedDB(t)
	st = openStore(t, raw)
	if _, err := st.CreateCase(ctx, exampleVersionID, false); err != nil {
		t.Fatal(err)
	}
	want = "refused: the example version already has real cases"
	if err := run(ctx, nil, raw, io.Discard); err == nil || err.Error() != want {
		t.Errorf("R10: error %v, want %q", err, want)
	}
}

func getJSON(t *testing.T, h http.Handler, path string, out any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: status %d: %s", path, rec.Code, rec.Body)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
}

type count struct{ Open, Late int }

func TestPlay(t *testing.T) { // S1 to S6
	ctx := context.Background()
	raw := wipedDB(t)
	st := openStore(t, raw)
	fork, err := st.Fork(ctx, exampleVersionID, "other")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{exampleVersionID, fork.ID} {
		if _, err := st.CreateCase(ctx, id, true); err != nil {
			t.Fatal(err)
		}
	}

	// S1
	var out strings.Builder
	if err := run(ctx, []string{"-cases", "20"}, raw, &out); err != nil {
		t.Fatalf("S1: %v", err)
	}
	if want := "played 20 cases: 15 closed, 5 open (1 late)\n"; out.String() != want {
		t.Errorf("S1: output %q, want %q", out.String(), want)
	}

	h := api.NewHandler(fstest.MapFS{"index.html": {Data: []byte("<html></html>")}}, "v-test", st, "")
	base := "/api/versions/" + exampleVersionID

	// S2
	var sup struct {
		TotalOpen int `json:"total_open"`
		TotalLate int `json:"total_late"`
		Nodes     []struct {
			NodeID     string `json:"node_id"`
			Open, Late int
		}
		People []struct {
			UserID     string `json:"user_id"`
			Open, Late int
		}
		Cases []struct {
			Reference string
			Returned  bool
		}
	}
	getJSON(t, h, base+"/supervision", &sup)
	if sup.TotalOpen != 5 || sup.TotalLate != 1 {
		t.Errorf("S2: open %d late %d, want 5 1", sup.TotalOpen, sup.TotalLate)
	}
	wantNodes := map[string]count{"entry": {1, 0}, "analysis": {1, 0}, "decision": {1, 1},
		"offer": {1, 0}, "signing": {1, 0}, "release": {0, 0}}
	for _, n := range sup.Nodes {
		if w, ok := wantNodes[n.NodeID]; ok && (count{n.Open, n.Late}) != w {
			t.Errorf("S2: node %s %d/%d, want %v", n.NodeID, n.Open, n.Late, w)
		}
	}
	people := map[string]count{}
	for _, p := range sup.People {
		people[p.UserID] = count{p.Open, p.Late}
	}
	wantPeople := map[string]count{"u-analyst": {1, 0}, "u-director": {1, 1}, "u-legal": {1, 0}, "u-advisor": {1, 0}}
	if len(people) != len(wantPeople) {
		t.Errorf("S2: people %v, want %v", people, wantPeople)
	}
	for id, w := range wantPeople {
		if people[id] != w {
			t.Errorf("S2: person %s %v, want %v", id, people[id], w)
		}
	}
	for _, c := range sup.Cases {
		if c.Returned {
			t.Errorf("S2: case %s returned", c.Reference)
		}
	}

	// S3
	var flow struct {
		Closed int
		Ends   []struct {
			NodeID string `json:"node_id"`
			Cases  int
		}
		Edges []struct {
			EdgeID string `json:"edge_id"`
			Passes int
		}
		Returns int
	}
	getJSON(t, h, base+"/flow?days=30", &flow)
	if flow.Closed != 15 || flow.Returns != 2 {
		t.Errorf("S3: closed %d returns %d, want 15 2", flow.Closed, flow.Returns)
	}
	ends := map[string]int{}
	for _, e := range flow.Ends {
		ends[e.NodeID] = e.Cases
	}
	if ends["released"] != 13 || ends["refused"] != 2 {
		t.Errorf("S3: ends %v, want released 13 refused 2", ends)
	}
	passes := map[string]int{}
	for _, e := range flow.Edges {
		passes[e.EdgeID] = e.Passes
	}
	for id, w := range map[string]int{"e11": 2, "e10": 1, "e06": 1} {
		if passes[id] != w {
			t.Errorf("S3: edge %s passes %d, want %d", id, passes[id], w)
		}
	}

	// S4 and S5
	var audit struct {
		Cases, Events int
		Broken        []any
	}
	getJSON(t, h, "/api/audit/verify", &audit)
	if audit.Cases != 22 || len(audit.Broken) != 0 {
		t.Errorf("S4: audit %+v, want 22 cases, no break", audit)
	}
	cases, err := st.ListCases(ctx)
	if err != nil {
		t.Fatal(err)
	}
	played, scans := 0, 0
	for _, c := range cases {
		events, err := st.ListEvents(ctx, c.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(events) == 0 {
			continue
		}
		played++
		if c.IsTest || !c.CreatedAt.Equal(events[0].At) {
			t.Errorf("S4: case %s is_test %v created %v, event 1 at %v", c.Reference, c.IsTest, c.CreatedAt, events[0].At)
		}
		docs, err := st.ListCaseDocuments(ctx, c.ID)
		if err != nil {
			t.Fatal(err)
		}
		scans += len(docs)
	}
	if played != 20 {
		t.Errorf("S4: %d played cases, want 20", played)
	}
	if scans != 117 {
		t.Errorf("S5: %d scans, want 117", scans)
	}

	// S6
	want := "refused: the example version already has real cases"
	if err := run(ctx, []string{"-cases", "20"}, raw, io.Discard); err == nil || err.Error() != want {
		t.Errorf("S6: error %v, want %q", err, want)
	}
	var again struct{ Cases, Events int }
	getJSON(t, h, "/api/audit/verify", &again)
	if again.Cases != audit.Cases || again.Events != audit.Events {
		t.Errorf("S6: audit %+v, want %d cases %d events", again, audit.Cases, audit.Events)
	}
}
