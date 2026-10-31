package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/rules"
)

// Seed row ids of the example process.
const (
	seedProcessID  = "00000000-0000-0000-0000-000000000001"
	seedVersionID  = "00000000-0000-0000-0000-000000000002"
	uuidPattern    = `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`
	defaultTestURL = "postgres://zotra:zotra@127.0.0.1:5434/zotra_test?sslmode=disable"
	defaultAdminDB = "zotra"
)

// testURL returns the URL of the test database.
func testURL(t *testing.T) string {
	t.Helper()
	raw := os.Getenv("ZOTRA_TEST_DATABASE_URL")
	if raw == "" {
		raw = defaultTestURL
	}
	return raw
}

// openTestStore creates the test database if it is missing, wipes its
// schema, and opens the store (migrate plus seed). A missing server
// fails the test: the database is part of the contract.
func openTestStore(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()
	raw := testURL(t)

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

	s, err := Open(ctx, raw)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

// wantErr fails when err does not carry exactly text.
func wantErr(t *testing.T, err error, text string) {
	t.Helper()
	if err == nil {
		t.Fatalf("error is nil, want %q", text)
	}
	if err.Error() != text {
		t.Fatalf("error is %q, want %q", err.Error(), text)
	}
}

// wantErrPrefix fails when err does not start with prefix.
func wantErrPrefix(t *testing.T, err error, prefix string) {
	t.Helper()
	if err == nil {
		t.Fatalf("error is nil, want prefix %q", prefix)
	}
	if !strings.HasPrefix(err.Error(), prefix) {
		t.Fatalf("error is %q, want prefix %q", err.Error(), prefix)
	}
}

// sameDefinition compares two definitions by value. The jsonb column
// re-renders the bytes, so the values are unmarshaled and compared.
func sameDefinition(t *testing.T, got, want []byte) {
	t.Helper()
	var gotValue, wantValue map[string]any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("unmarshal got definition: %v", err)
	}
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("unmarshal want definition: %v", err)
	}
	gotJSON, _ := json.Marshal(gotValue)
	wantJSON, _ := json.Marshal(wantValue)
	if !bytes.Equal(gotJSON, wantJSON) {
		t.Fatal("definition values differ")
	}
}

// seedDefinition decodes the embedded example process.
func seedDefinition(t *testing.T) process.Definition {
	t.Helper()
	def, err := process.Decode(seedProcess)
	if err != nil {
		t.Fatalf("decode seed definition: %v", err)
	}
	return def
}

// startEvents runs the Start command of rows 7, 8 and 9 on the seed
// definition. The at value has no part under a microsecond.
func startEvents(t *testing.T, def process.Definition, caseID, versionID string) []engine.Event {
	t.Helper()
	events, err := engine.Handle(def, engine.State{}, engine.Start{
		CaseID:    caseID,
		VersionID: versionID,
		Actor:     "u-advisor",
		Data:      map[string]any{},
	}, time.Date(2026, 10, 27, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Handle Start: %v", err)
	}
	return events
}

// TestOpenSeed checks the fresh schema: the migration and the seed
// give the demo users, the example process and version 1 published.
func TestOpenSeed(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	users, err := s.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if len(users) != 5 {
		t.Fatalf("ListUsers gives %d users, want 5", len(users))
	}
	wantUsers := []User{
		{ID: "u-advisor", Name: "Demo Advisor", RoleIDs: []string{"advisor"}},
		{ID: "u-analyst", Name: "Demo Analyst", RoleIDs: []string{"analyst"}},
		{ID: "u-backoffice", Name: "Demo Back-office", RoleIDs: []string{"backoffice"}},
		{ID: "u-director", Name: "Demo Director", RoleIDs: []string{"director"}},
		{ID: "u-legal", Name: "Demo Legal Officer", RoleIDs: []string{"legal"}},
	}
	for i, want := range wantUsers {
		got := users[i]
		if got.ID != want.ID || got.Name != want.Name ||
			strings.Join(got.RoleIDs, ",") != strings.Join(want.RoleIDs, ",") {
			t.Fatalf("user %d is %+v, want %+v", i, got, want)
		}
	}

	processes, err := s.ListProcesses(ctx)
	if err != nil {
		t.Fatalf("ListProcesses: %v", err)
	}
	if len(processes) != 1 {
		t.Fatalf("ListProcesses gives %d rows, want 1", len(processes))
	}
	if processes[0].Name != "Home loan" {
		t.Fatalf("process name is %q, want Home loan", processes[0].Name)
	}
	if processes[0].ID != seedProcessID {
		t.Fatalf("process id is %q, want %q", processes[0].ID, seedProcessID)
	}

	v, err := s.GetVersion(ctx, seedVersionID)
	if err != nil {
		t.Fatalf("GetVersion: %v", err)
	}
	if v.Number != 1 || v.Label != "Initial" || v.Status != StatusPublished {
		t.Fatalf("version is number %d label %q status %q, want 1, Initial, published",
			v.Number, v.Label, v.Status)
	}
	if v.FrozenAt == nil {
		t.Fatal("frozen_at is null, want the insert time")
	}
	if errs := rules.ValidateDocument(v.Definition); len(errs) != 0 {
		t.Fatalf("seed definition is not valid: %+v", errs)
	}
}

// TestOpenTwice opens a second time on the same database. The seed
// changes nothing.
func TestOpenTwice(t *testing.T) {
	ctx := context.Background()
	openTestStore(t)

	second, err := Open(ctx, testURL(t))
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	defer second.Close()

	users, err := second.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if len(users) != 5 {
		t.Fatalf("ListUsers gives %d users, want 5", len(users))
	}
	processes, err := second.ListProcesses(ctx)
	if err != nil {
		t.Fatalf("ListProcesses: %v", err)
	}
	if len(processes) != 1 {
		t.Fatalf("ListProcesses gives %d rows, want 1", len(processes))
	}
	versions, err := second.ListVersions(ctx, seedProcessID)
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if len(versions) != 1 {
		t.Fatalf("ListVersions gives %d rows, want 1", len(versions))
	}
}

// TestUsers reads one user and refuses a ghost.
func TestUsers(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	u, err := s.UserByID(ctx, "u-advisor")
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if len(u.RoleIDs) != 1 || u.RoleIDs[0] != "advisor" {
		t.Fatalf("roles are %v, want [advisor]", u.RoleIDs)
	}
	_, err = s.UserByID(ctx, "ghost")
	wantErr(t, err, "user ghost does not exist")
}

// TestProcesses creates a process and refuses a ghost.
func TestProcesses(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	p, err := s.CreateProcess(ctx, "Test process")
	if err != nil {
		t.Fatalf("CreateProcess: %v", err)
	}
	if !regexp.MustCompile(uuidPattern).MatchString(p.ID) {
		t.Fatalf("id is %q, want a uuid version 4 string", p.ID)
	}
	if p.Name != "Test process" {
		t.Fatalf("name is %q, want Test process", p.Name)
	}
	processes, err := s.ListProcesses(ctx)
	if err != nil {
		t.Fatalf("ListProcesses: %v", err)
	}
	if len(processes) != 2 {
		t.Fatalf("ListProcesses gives %d rows, want 2", len(processes))
	}
	_, err = s.ProcessByID(ctx, "ghost")
	wantErr(t, err, "process ghost does not exist")
}

// TestVersions walks the full version lifecycle on a new process.
func TestVersions(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	p, err := s.CreateProcess(ctx, "Test process")
	if err != nil {
		t.Fatalf("CreateProcess: %v", err)
	}
	def := append([]byte(nil), seedProcess...)

	v1, err := s.CreateVersion(ctx, p.ID, nil, "Initial", def)
	if err != nil {
		t.Fatalf("CreateVersion 1: %v", err)
	}
	if v1.Number != 1 || v1.Status != StatusDraft {
		t.Fatalf("version 1 is number %d status %q, want 1, draft", v1.Number, v1.Status)
	}
	v2, err := s.CreateVersion(ctx, p.ID, nil, "Second", def)
	if err != nil {
		t.Fatalf("CreateVersion 2: %v", err)
	}
	if v2.Number != 2 {
		t.Fatalf("version 2 has number %d, want 2", v2.Number)
	}

	changed := []byte(`{"name":"Changed"}`)
	if err := s.UpdateDraft(ctx, v1.ID, changed); err != nil {
		t.Fatalf("UpdateDraft: %v", err)
	}
	got, err := s.GetVersion(ctx, v1.ID)
	if err != nil {
		t.Fatalf("GetVersion: %v", err)
	}
	sameDefinition(t, got.Definition, changed)

	if err := s.Freeze(ctx, v1.ID); err != nil {
		t.Fatalf("Freeze: %v", err)
	}
	got, err = s.GetVersion(ctx, v1.ID)
	if err != nil {
		t.Fatalf("GetVersion: %v", err)
	}
	if got.Status != StatusFrozen {
		t.Fatalf("status is %q, want frozen", got.Status)
	}
	if got.FrozenAt == nil {
		t.Fatal("frozen_at is null, want the freeze time")
	}

	err = s.UpdateDraft(ctx, v1.ID, changed)
	wantErr(t, err, fmt.Sprintf("version %s is not a draft", v1.ID))
	err = s.Freeze(ctx, v1.ID)
	wantErr(t, err, fmt.Sprintf("version %s is not a draft", v1.ID))
	err = s.Publish(ctx, v2.ID)
	wantErr(t, err, fmt.Sprintf("version %s is not frozen", v2.ID))

	if err := s.Publish(ctx, v1.ID); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	got, err = s.GetVersion(ctx, v1.ID)
	if err != nil {
		t.Fatalf("GetVersion: %v", err)
	}
	if got.Status != StatusPublished {
		t.Fatalf("status is %q, want published", got.Status)
	}

	fork, err := s.Fork(ctx, v1.ID, "Forked")
	if err != nil {
		t.Fatalf("Fork: %v", err)
	}
	if fork.Status != StatusDraft || fork.Number != 3 || fork.Label != "Forked" {
		t.Fatalf("fork is status %q number %d label %q, want draft, 3, Forked",
			fork.Status, fork.Number, fork.Label)
	}
	if fork.ParentID == nil || *fork.ParentID != v1.ID {
		t.Fatalf("fork parent is %v, want %s", fork.ParentID, v1.ID)
	}
	sameDefinition(t, fork.Definition, changed)

	_, err = s.CreateVersion(ctx, "ghost", nil, "", def)
	wantErr(t, err, "process ghost does not exist")
	_, err = s.GetVersion(ctx, "ghost")
	wantErr(t, err, "version ghost does not exist")
}

// TestCases creates two cases on the seeded version and refuses a
// ghost version and a ghost case.
func TestCases(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	year := time.Now().UTC().Year()
	c1, err := s.CreateCase(ctx, seedVersionID, false)
	if err != nil {
		t.Fatalf("CreateCase 1: %v", err)
	}
	if want := fmt.Sprintf("CASE-%d-0001", year); c1.Reference != want {
		t.Fatalf("reference 1 is %q, want %q", c1.Reference, want)
	}
	if c1.IsTest {
		t.Fatal("case 1 is a test case, want false")
	}
	c2, err := s.CreateCase(ctx, seedVersionID, true)
	if err != nil {
		t.Fatalf("CreateCase 2: %v", err)
	}
	if want := fmt.Sprintf("CASE-%d-0002", year); c2.Reference != want {
		t.Fatalf("reference 2 is %q, want %q", c2.Reference, want)
	}
	if !c2.IsTest {
		t.Fatal("case 2 is not a test case, want true")
	}

	_, err = s.CreateCase(ctx, "ghost", false)
	wantErr(t, err, "version ghost does not exist")

	got, err := s.GetCase(ctx, c1.ID)
	if err != nil {
		t.Fatalf("GetCase: %v", err)
	}
	if got.ID != c1.ID || got.VersionID != c1.VersionID ||
		got.Reference != c1.Reference || got.IsTest != c1.IsTest ||
		!got.CreatedAt.Equal(c1.CreatedAt) {
		t.Fatalf("GetCase gives %+v, want %+v", got, c1)
	}
	_, err = s.GetCase(ctx, "ghost")
	wantErr(t, err, "case ghost does not exist")
}

var (
	at1 = time.Date(2025, 12, 31, 22, 0, 0, 0, time.UTC)
	at2 = time.Date(2025, 6, 1, 8, 30, 0, 0, time.UTC)
	at3 = time.Date(2026, 10, 12, 6, 15, 30, 0, time.UTC)
)

// TestCreateCaseAt creates cases at given times: the year of the
// reference is the UTC year of the time. CreateCase uses the current
// time.
func TestCreateCaseAt(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	// A1
	c1, err := s.CreateCaseAt(ctx, seedVersionID, false, at1)
	if err != nil {
		t.Fatalf("A1: %v", err)
	}
	if c1.Reference != "CASE-2025-0001" || !c1.CreatedAt.Equal(at1) || c1.IsTest {
		t.Fatalf("A1 gives %+v", c1)
	}
	got, err := s.GetCase(ctx, c1.ID)
	if err != nil || !got.CreatedAt.Equal(at1) {
		t.Fatalf("A1 GetCase gives %+v, %v", got, err)
	}

	// A2
	c2, err := s.CreateCaseAt(ctx, seedVersionID, true, at2)
	if err != nil {
		t.Fatalf("A2: %v", err)
	}
	if c2.Reference != "CASE-2025-0002" || !c2.IsTest {
		t.Fatalf("A2 gives %+v", c2)
	}

	// A3
	before := time.Now()
	c3, err := s.CreateCase(ctx, seedVersionID, false)
	after := time.Now()
	if err != nil {
		t.Fatalf("A3: %v", err)
	}
	year := c3.CreatedAt.UTC().Year()
	if want := fmt.Sprintf("CASE-%d-0001", year); c3.Reference != want {
		t.Fatalf("A3 reference is %q, want %q", c3.Reference, want)
	}
	if c3.CreatedAt.Before(before.Truncate(time.Microsecond)) || c3.CreatedAt.After(after) {
		t.Fatalf("A3 created at %v, want between %v and %v", c3.CreatedAt, before, after)
	}

	// A4, A5
	_, err = s.CreateCaseAt(ctx, "00000000-0000-0000-0000-0000000000f1", false, at1)
	wantErr(t, err, "version 00000000-0000-0000-0000-0000000000f1 does not exist")
	_, err = s.CreateCaseAt(ctx, "ghost", false, at1)
	wantErr(t, err, "version ghost does not exist")

	// A6
	c6, err := s.CreateCaseAt(ctx, seedVersionID, false, at3)
	if err != nil {
		t.Fatalf("A6: %v", err)
	}
	want := "CASE-2026-0001"
	if year == 2026 {
		want = "CASE-2026-0002"
	}
	if c6.Reference != want || !c6.CreatedAt.Equal(at3) {
		t.Fatalf("A6 gives %+v, want reference %q", c6, want)
	}
}

// TestSaveDocumentAt stores scans at given times. SaveDocument uses
// the current time.
func TestSaveDocumentAt(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	c, err := s.CreateCaseAt(ctx, seedVersionID, false, at1)
	if err != nil {
		t.Fatalf("CreateCaseAt: %v", err)
	}

	// D1
	d1, err := s.SaveDocumentAt(ctx, &c.ID, "ID card.png", "image/png", "abc", []byte{1}, at3)
	if err != nil || !d1.CreatedAt.Equal(at3) {
		t.Fatalf("D1 gives %+v, %v", d1, err)
	}
	docs, err := s.ListCaseDocuments(ctx, c.ID)
	if err != nil || len(docs) != 1 || !docs[0].CreatedAt.Equal(at3) || docs[0].Name != "ID card.png" {
		t.Fatalf("D1 list gives %+v, %v", docs, err)
	}

	// D2
	d2, err := s.SaveDocumentAt(ctx, nil, "x.png", "image/png", "abc", []byte{1}, at2)
	if err != nil || d2.CaseID != nil || !d2.CreatedAt.Equal(at2) {
		t.Fatalf("D2 gives %+v, %v", d2, err)
	}

	// D3
	before := time.Now()
	d3, err := s.SaveDocument(ctx, &c.ID, "b.png", "image/png", "abc", []byte{2})
	after := time.Now()
	if err != nil {
		t.Fatalf("D3: %v", err)
	}
	if d3.CreatedAt.Before(before.Truncate(time.Microsecond)) || d3.CreatedAt.After(after) {
		t.Fatalf("D3 created at %v, want between %v and %v", d3.CreatedAt, before, after)
	}
	docs, err = s.ListCaseDocuments(ctx, c.ID)
	if err != nil || len(docs) != 2 || docs[0].Name != "b.png" {
		t.Fatalf("D3 list gives %+v, %v", docs, err)
	}
}

// TestEvents appends the events of one Start command and reads them
// back. The hash chain survives the round trip.
func TestEvents(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	def := seedDefinition(t)

	c, err := s.CreateCase(ctx, seedVersionID, false)
	if err != nil {
		t.Fatalf("CreateCase: %v", err)
	}
	events := startEvents(t, def, c.ID, seedVersionID)
	if len(events) != 3 {
		t.Fatalf("Start gives %d events, want 3", len(events))
	}
	if err := s.AppendEvents(ctx, c.ID, events); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}

	got, err := s.ListEvents(ctx, c.ID)
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("ListEvents gives %d events, want 3", len(got))
	}
	for i, want := range events {
		e := got[i]
		if e.Type != want.Type || e.Seq != want.Seq || e.Actor != want.Actor ||
			e.PrevHash != want.PrevHash || e.Hash != want.Hash ||
			string(e.Payload) != string(want.Payload) {
			t.Fatalf("event %d is %+v, want %+v", i, e, want)
		}
	}
	if bad := engine.Verify(got); bad != 0 {
		t.Fatalf("Verify of the listed events reports seq %d, want 0", bad)
	}
}

// TestAppendRefusals walks the five refusals of AppendEvents on the
// log of row 7, which holds 3 events.
func TestAppendRefusals(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	def := seedDefinition(t)

	c, err := s.CreateCase(ctx, seedVersionID, false)
	if err != nil {
		t.Fatalf("CreateCase: %v", err)
	}
	events := startEvents(t, def, c.ID, seedVersionID)
	if err := s.AppendEvents(ctx, c.ID, events); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}

	// The gap rule fires before any insert: the next seq must be 4.
	err = s.AppendEvents(ctx, c.ID, events)
	wantErr(t, err, "append: first seq 1 must be 4")

	// A payload that is not valid JSON fails the insert. The slice
	// has 3 hand-made events, seqs 4, 5 and 6; the first carries the
	// bad payload.
	bad := []engine.Event{
		{
			CaseID:   c.ID,
			Seq:      4,
			Type:     engine.EventDataSubmitted,
			At:       time.Date(2026, 10, 27, 8, 30, 0, 0, time.UTC),
			Actor:    "u-advisor",
			Payload:  json.RawMessage("{oops"),
			PrevHash: events[2].Hash,
			Hash:     "not-a-hash",
		},
		{
			CaseID:   c.ID,
			Seq:      5,
			Type:     engine.EventDataSubmitted,
			At:       time.Date(2026, 10, 27, 8, 30, 0, 0, time.UTC),
			Actor:    "u-advisor",
			Payload:  json.RawMessage(`{}`),
			PrevHash: "not-a-hash",
			Hash:     "not-a-hash",
		},
		{
			CaseID:   c.ID,
			Seq:      6,
			Type:     engine.EventDataSubmitted,
			At:       time.Date(2026, 10, 27, 8, 30, 0, 0, time.UTC),
			Actor:    "u-advisor",
			Payload:  json.RawMessage(`{}`),
			PrevHash: "not-a-hash",
			Hash:     "not-a-hash",
		},
	}
	err = s.AppendEvents(ctx, c.ID, bad)
	wantErrPrefix(t, err, "append event 4:")

	// An event of another case is refused.
	foreign := []engine.Event{{
		CaseID:   "other",
		Seq:      4,
		Type:     engine.EventDataSubmitted,
		At:       time.Date(2026, 10, 27, 8, 30, 0, 0, time.UTC),
		Actor:    "u-advisor",
		Payload:  json.RawMessage(`{}`),
		PrevHash: events[2].Hash,
		Hash:     "not-a-hash",
	}}
	err = s.AppendEvents(ctx, c.ID, foreign)
	wantErr(t, err, "event 4: case id other does not match")

	// An unknown case is refused.
	err = s.AppendEvents(ctx, "ghost", []engine.Event{{
		CaseID: "ghost", Seq: 1, Type: engine.EventCaseCreated,
		At: time.Date(2026, 10, 27, 8, 30, 0, 0, time.UTC), Actor: "u-advisor",
		Payload: json.RawMessage(`{}`), PrevHash: engine.ZeroHash, Hash: "not-a-hash",
	}})
	wantErr(t, err, "case ghost does not exist")

	// An empty slice is refused.
	err = s.AppendEvents(ctx, c.ID, nil)
	wantErr(t, err, "no events")
}

// TestTrigger proves that the trigger refuses UPDATE and DELETE on
// events. The table holds rows, so the row trigger fires.
func TestTrigger(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	def := seedDefinition(t)

	c, err := s.CreateCase(ctx, seedVersionID, false)
	if err != nil {
		t.Fatalf("CreateCase: %v", err)
	}
	events := startEvents(t, def, c.ID, seedVersionID)
	if err := s.AppendEvents(ctx, c.ID, events); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}

	for _, stmt := range []string{
		"UPDATE events SET actor = 'x'",
		"DELETE FROM events",
	} {
		if _, err := s.pool().Exec(ctx, stmt); err == nil {
			t.Fatalf("%q succeeded, want an append-only error", stmt)
		} else if !strings.Contains(err.Error(), "events is append-only") {
			t.Fatalf("%q gave %q, want events is append-only", stmt, err.Error())
		}
	}
}

// TestSeedFileSync keeps the embedded seed file a byte copy of the
// example. The paths are relative to the package directory.
func TestSeedFileSync(t *testing.T) {
	seed, err := os.ReadFile("seed/example-process.json")
	if err != nil {
		t.Fatalf("read seed file: %v", err)
	}
	example, err := os.ReadFile("../../examples/home-loan/process.json")
	if err != nil {
		t.Fatalf("read example file: %v", err)
	}
	if !bytes.Equal(seed, example) {
		t.Fatal("seed/example-process.json is not a byte copy of examples/home-loan/process.json")
	}
}

// TestSeedPolicySync (row P1) keeps the embedded seed policy a byte
// copy of the example policy.
func TestSeedPolicySync(t *testing.T) {
	seed, err := os.ReadFile("seed/home-loan-policy.pdf")
	if err != nil {
		t.Fatalf("read seed policy: %v", err)
	}
	example, err := os.ReadFile("../../examples/home-loan/policy.pdf")
	if err != nil {
		t.Fatalf("read example policy: %v", err)
	}
	if !bytes.Equal(seed, example) {
		t.Fatal("seed/home-loan-policy.pdf is not a byte copy of examples/home-loan/policy.pdf")
	}
}

// TestPolicyFile covers rows P2 to P5.
func TestPolicyFile(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	// P2: the seed gives the example policy to the seed process.
	seed, err := s.GetPolicyFile(ctx, seedProcessID)
	if err != nil {
		t.Fatalf("GetPolicyFile seed: %v", err)
	}
	sum := sha256.Sum256(seedPolicy)
	if seed.FileName != "home-loan-policy.pdf" || seed.MIME != "application/pdf" ||
		!bytes.Equal(seed.Bytes, seedPolicy) || seed.SHA256 != hex.EncodeToString(sum[:]) {
		t.Errorf("seed policy = %q %q sha %q (%d bytes), want the seed file",
			seed.FileName, seed.MIME, seed.SHA256, len(seed.Bytes))
	}

	// P3: a second save replaces the first file.
	p, err := s.CreateProcess(ctx, "Policy test")
	if err != nil {
		t.Fatalf("CreateProcess: %v", err)
	}
	if _, err := s.SavePolicyFile(ctx, p.ID, "a.pdf", "sha-a", []byte("%PDF-1 a")); err != nil {
		t.Fatalf("SavePolicyFile a: %v", err)
	}
	if _, err := s.SavePolicyFile(ctx, p.ID, "b.pdf", "sha-b", []byte("%PDF-1 b")); err != nil {
		t.Fatalf("SavePolicyFile b: %v", err)
	}
	got, err := s.GetPolicyFile(ctx, p.ID)
	if err != nil {
		t.Fatalf("GetPolicyFile: %v", err)
	}
	if got.FileName != "b.pdf" || string(got.Bytes) != "%PDF-1 b" || got.SHA256 != "sha-b" {
		t.Errorf("policy = %q %q %q, want b.pdf %%PDF-1 b sha-b", got.FileName, got.Bytes, got.SHA256)
	}

	// P4: a non-uuid id and a process with no file give the absent error.
	if _, err := s.GetPolicyFile(ctx, "not-a-uuid"); err == nil ||
		err.Error() != "policy not-a-uuid does not exist" {
		t.Errorf("non-uuid: err = %v", err)
	}
	empty, err := s.CreateProcess(ctx, "No policy")
	if err != nil {
		t.Fatalf("CreateProcess: %v", err)
	}
	if _, err := s.GetPolicyFile(ctx, empty.ID); err == nil ||
		err.Error() != "policy "+empty.ID+" does not exist" {
		t.Errorf("no file: err = %v", err)
	}

	// P5: a second seed keeps the file of the user.
	if _, err := s.SavePolicyFile(ctx, seedProcessID, "user.pdf", "sha-u", []byte("%PDF-1 u")); err != nil {
		t.Fatalf("SavePolicyFile seed: %v", err)
	}
	if err := Seed(ctx, s); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	kept, err := s.GetPolicyFile(ctx, seedProcessID)
	if err != nil {
		t.Fatalf("GetPolicyFile after seed: %v", err)
	}
	if kept.FileName != "user.pdf" || string(kept.Bytes) != "%PDF-1 u" {
		t.Errorf("after seed = %q %q, want user.pdf %%PDF-1 u", kept.FileName, kept.Bytes)
	}
}

// TestArchiveProcess covers rows S1 to S3: archive, archive again,
// restore, and the refused ids.
func TestArchiveProcess(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	// S1: the archived process stays in the list, with archived_at.
	first, err := s.SetProcessArchived(ctx, seedProcessID, true)
	if err != nil {
		t.Fatalf("archive: %v", err)
	}
	if first.ArchivedAt == nil {
		t.Fatal("ArchivedAt is nil after archive")
	}
	processes, err := s.ListProcesses(ctx)
	if err != nil {
		t.Fatalf("ListProcesses: %v", err)
	}
	if len(processes) != 1 || processes[0].ID != seedProcessID || processes[0].ArchivedAt == nil {
		t.Fatalf("list = %+v, want the seed process with ArchivedAt", processes)
	}

	// S2: a second archive keeps the first archived_at.
	second, err := s.SetProcessArchived(ctx, seedProcessID, true)
	if err != nil {
		t.Fatalf("archive again: %v", err)
	}
	if second.ArchivedAt == nil || !second.ArchivedAt.Equal(*first.ArchivedAt) {
		t.Fatalf("second ArchivedAt = %v, want %v", second.ArchivedAt, first.ArchivedAt)
	}

	// S3: restore clears it; unknown and non-UUID ids are refused.
	restored, err := s.SetProcessArchived(ctx, seedProcessID, false)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.ArchivedAt != nil {
		t.Fatalf("ArchivedAt = %v after restore, want nil", restored.ArchivedAt)
	}
	byID, err := s.ProcessByID(ctx, seedProcessID)
	if err != nil || byID.ArchivedAt != nil {
		t.Fatalf("ProcessByID = %+v, %v; want ArchivedAt nil", byID, err)
	}
	ghost := "00000000-0000-0000-0000-0000000000ff"
	_, err = s.SetProcessArchived(ctx, ghost, true)
	wantErr(t, err, "process "+ghost+" does not exist")
	_, err = s.SetProcessArchived(ctx, "x", false)
	wantErr(t, err, "process x does not exist")
}
