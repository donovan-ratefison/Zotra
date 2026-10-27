package api

// The tests of the store routes. Each test opens a fresh store: the
// rows share no state.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// Seed row ids of the example process, and the test database names.
// The api package cannot import the _test helper of the store
// package, so openTestStore is a copy.
const (
	seedProcessID  = "00000000-0000-0000-0000-000000000001"
	seedVersionID  = "00000000-0000-0000-0000-000000000002"
	defaultTestURL = "postgres://zotra:zotra@127.0.0.1:5434/zotra_test?sslmode=disable"
	defaultAdminDB = "zotra"
)

// testAPIHandler is the handler under test. newTestAPI sets it for
// the current test; the tests of the package run sequentially.
var testAPIHandler http.Handler

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
func openTestStore(t *testing.T) *store.Store {
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

	s, err := store.Open(ctx, raw)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

// newTestAPI opens the test store and the handler with it.
func newTestAPI(t *testing.T) http.Handler {
	t.Helper()
	st := openTestStore(t)
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<p>index</p>")}}
	h := NewHandler(static, "v-test", st, "")
	testAPIHandler = h
	return h
}

// do runs one request against testAPIHandler. An empty body sends no
// body. A non-empty user sets the X-Zotra-User header. The error
// assertions use the checkError helper of feedback_test.go.
func do(t *testing.T, method, path, body, user string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	if user != "" {
		req.Header.Set("X-Zotra-User", user)
	}
	rec := httptest.NewRecorder()
	testAPIHandler.ServeHTTP(rec, req)
	return rec
}

// decode unmarshals a success body.
func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal body: %v: %s", err, rec.Body.String())
	}
	return body
}

// exampleDefinition reads the example process bytes.
func exampleDefinition(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../../examples/home-loan/process.json")
	if err != nil {
		t.Fatalf("read example definition: %v", err)
	}
	return b
}

// entryValues is the JSON body of the entry submit: the 8 values of
// the engine scenario.
func entryValues() string {
	return `{"client_name":"Ravina Soa","profession":"Engineer",` +
		`"amount":240000.0,"duration_months":240,"down_payment":40000.0,` +
		`"annual_rate":0.035,"monthly_income":4500.0,` +
		`"documents":["ID card","Salary slips","Bank statements","Property title"]}`
}

// mustCreate runs a call that must answer 201 or 200 and returns the
// decoded body.
func mustCreate(t *testing.T, method, path, body string, status int) map[string]any {
	t.Helper()
	rec := do(t, method, path, body, "")
	if rec.Code != status {
		t.Fatalf("%s %s: status %d, want %d: %s",
			method, path, rec.Code, status, rec.Body.String())
	}
	return decode(t, rec)
}

// createProcessVersion creates a process and its first version with
// the given definition. It returns the version id.
func createProcessVersion(t *testing.T, definition []byte, label string) string {
	t.Helper()
	body := mustCreate(t, "POST", "/api/processes", `{"name":"Test"}`, http.StatusCreated)
	processID := body["process"].(map[string]any)["id"].(string)
	vbody, err := json.Marshal(map[string]any{
		"label":      label,
		"definition": json.RawMessage(definition),
	})
	if err != nil {
		t.Fatalf("marshal version body: %v", err)
	}
	vbodyMap := mustCreate(t, "POST", "/api/processes/"+processID+"/versions",
		string(vbody), http.StatusCreated)
	return vbodyMap["version"].(map[string]any)["id"].(string)
}

// createCase creates a case on the version. It returns the case id.
func createCase(t *testing.T, versionID string, isTest bool) string {
	t.Helper()
	body := fmt.Sprintf(`{"version_id":%q,"is_test":%t}`, versionID, isTest)
	cbody := mustCreate(t, "POST", "/api/cases", body, http.StatusCreated)
	return cbody["case"].(map[string]any)["id"].(string)
}

// analysisCase creates a case on the seeded version and runs start
// plus the entry submit. The case sits on analysis with 9 events.
func analysisCase(t *testing.T) string {
	t.Helper()
	caseID := createCase(t, seedVersionID, true)
	for _, cmd := range []struct{ body, user string }{
		{`{"type":"start","data":{}}`, "u-advisor"},
		{`{"type":"submit","values":` + entryValues() + `}`, "u-advisor"},
	} {
		rec := do(t, "POST", "/api/cases/"+caseID+"/commands", cmd.body, cmd.user)
		if rec.Code != http.StatusOK {
			t.Fatalf("command %s: status %d: %s", cmd.body, rec.Code, rec.Body.String())
		}
	}
	return caseID
}

// 1.
func TestProcesses(t *testing.T) {
	newTestAPI(t)

	// Create a process: the answer reads through the wrapper.
	rec := do(t, "POST", "/api/processes", `{"name":"Test"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create process: status %d: %s", rec.Code, rec.Body.String())
	}
	process := decode(t, rec)["process"].(map[string]any)
	if process["name"] != "Test" {
		t.Errorf("name = %v, want Test", process["name"])
	}
	processID, ok := process["id"].(string)
	if !ok || processID == "" {
		t.Fatalf("create process: no id: %v", process)
	}

	// The list holds the seed process and the new one, in store order.
	rec = do(t, "GET", "/api/processes", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list processes: status %d: %s", rec.Code, rec.Body.String())
	}
	list := decode(t, rec)["processes"].([]any)
	if len(list) != 2 {
		t.Fatalf("processes = %d, want 2", len(list))
	}
	if got := list[0].(map[string]any)["name"]; got != "Home loan" {
		t.Errorf("first process = %v, want Home loan", got)
	}
	if got := list[1].(map[string]any)["name"]; got != "Test" {
		t.Errorf("second process = %v, want Test", got)
	}

	// Create a draft version with the example bytes.
	vbody, err := json.Marshal(map[string]any{
		"label":      "Draft 1",
		"definition": json.RawMessage(exampleDefinition(t)),
	})
	if err != nil {
		t.Fatalf("marshal version body: %v", err)
	}
	rec = do(t, "POST", "/api/processes/"+processID+"/versions", string(vbody), "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create version: status %d: %s", rec.Code, rec.Body.String())
	}
	version := decode(t, rec)["version"].(map[string]any)
	if version["number"] != float64(1) {
		t.Errorf("number = %v, want 1", version["number"])
	}
	if version["status"] != "draft" {
		t.Errorf("status = %v, want draft", version["status"])
	}
	if version["label"] != "Draft 1" {
		t.Errorf("label = %v, want Draft 1", version["label"])
	}
	if version["parent_id"] != nil {
		t.Errorf("parent_id = %v, want null", version["parent_id"])
	}
	// The definition embeds as JSON, never base64.
	got, ok := version["definition"].(map[string]any)
	if !ok {
		t.Fatalf("definition is not embedded JSON: %T", version["definition"])
	}
	var wantDef any
	if err := json.Unmarshal(exampleDefinition(t), &wantDef); err != nil {
		t.Fatalf("unmarshal example: %v", err)
	}
	if !reflect.DeepEqual(got, wantDef) {
		t.Error("definition differs from the example bytes")
	}

	// The versions list holds it.
	rec = do(t, "GET", "/api/processes/"+processID+"/versions", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list versions: status %d: %s", rec.Code, rec.Body.String())
	}
	versions := decode(t, rec)["versions"].([]any)
	if len(versions) != 1 {
		t.Fatalf("versions = %d, want 1", len(versions))
	}
	first := versions[0].(map[string]any)
	if first["label"] != "Draft 1" || first["number"] != float64(1) {
		t.Errorf("versions[0] = %v", first)
	}
}

// 2.
func TestProcessRefusals(t *testing.T) {
	newTestAPI(t)

	rec := do(t, "POST", "/api/processes", `{bad`, "")
	checkError(t, rec, http.StatusBadRequest, "invalid_json", msgInvalidJSON)

	rec = do(t, "POST", "/api/processes", `{"name":""}`, "")
	checkError(t, rec, http.StatusBadRequest, "invalid_name", "name is required")

	// The valid create makes the process for the next calls.
	body := mustCreate(t, "POST", "/api/processes", `{"name":"Test"}`, http.StatusCreated)
	processID := body["process"].(map[string]any)["id"].(string)

	rec = do(t, "POST", "/api/processes/"+processID+"/versions", `{"label":"x"}`, "")
	checkError(t, rec, http.StatusBadRequest, "invalid_definition",
		"definition must be a JSON object")

	rec = do(t, "POST", "/api/processes/ghost/versions",
		`{"label":"x","definition":{}}`, "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no process ghost")

	rec = do(t, "GET", "/api/processes/ghost/versions", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no process ghost")
}

// 3.
func TestVersionsLifecycle(t *testing.T) {
	newTestAPI(t)
	versionID := createProcessVersion(t, exampleDefinition(t), "Draft 1")

	// GET: the full shape.
	rec := do(t, "GET", "/api/versions/"+versionID, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get version: status %d: %s", rec.Code, rec.Body.String())
	}
	version := decode(t, rec)["version"].(map[string]any)
	if version["id"] != versionID || version["status"] != "draft" ||
		version["parent_id"] != nil || version["frozen_at"] != nil {
		t.Errorf("version shape = %v", version)
	}
	if _, ok := version["definition"].(map[string]any); !ok {
		t.Errorf("definition is not embedded JSON: %T", version["definition"])
	}

	// PUT: a changed definition, stored by value.
	changed := bytes.ReplaceAll(exampleDefinition(t), []byte("#0f4c45"), []byte("#123456"))
	putBody, err := json.Marshal(map[string]any{"definition": json.RawMessage(changed)})
	if err != nil {
		t.Fatalf("marshal put body: %v", err)
	}
	rec = do(t, "PUT", "/api/versions/"+versionID, string(putBody), "")
	if rec.Code != http.StatusOK {
		t.Fatalf("put version: status %d: %s", rec.Code, rec.Body.String())
	}
	gotDef := decode(t, rec)["version"].(map[string]any)["definition"]
	var wantDef any
	if err := json.Unmarshal(changed, &wantDef); err != nil {
		t.Fatalf("unmarshal changed: %v", err)
	}
	if !reflect.DeepEqual(gotDef, wantDef) {
		t.Error("PUT did not store the new bytes by value")
	}

	// PUT without definition.
	rec = do(t, "PUT", "/api/versions/"+versionID, `{"label":"x"}`, "")
	checkError(t, rec, http.StatusBadRequest, "invalid_definition",
		"definition must be a JSON object")

	// validate: the example is valid.
	rec = do(t, "POST", "/api/versions/"+versionID+"/validate", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("validate: status %d: %s", rec.Code, rec.Body.String())
	}
	if errs := decode(t, rec)["errors"].([]any); len(errs) != 0 {
		t.Errorf("errors = %v, want []", errs)
	}

	// freeze.
	rec = do(t, "POST", "/api/versions/"+versionID+"/freeze", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("freeze: status %d: %s", rec.Code, rec.Body.String())
	}
	if decode(t, rec)["version"].(map[string]any)["frozen_at"] == nil {
		t.Error("frozen_at is null after freeze")
	}

	// PUT on a frozen version.
	rec = do(t, "PUT", "/api/versions/"+versionID, string(putBody), "")
	checkError(t, rec, http.StatusConflict, "conflict",
		"version "+versionID+" is not a draft")

	// publish.
	rec = do(t, "POST", "/api/versions/"+versionID+"/publish", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("publish: status %d: %s", rec.Code, rec.Body.String())
	}
	if got := decode(t, rec)["version"].(map[string]any)["status"]; got != "published" {
		t.Errorf("status = %v, want published", got)
	}

	// freeze again: Freeze refuses every status other than draft.
	rec = do(t, "POST", "/api/versions/"+versionID+"/freeze", "", "")
	checkError(t, rec, http.StatusConflict, "conflict",
		"version "+versionID+" is not a draft")

	// fork: the new draft has the next number and the parent id.
	rec = do(t, "POST", "/api/versions/"+versionID+"/fork", `{"label":"Variant"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("fork: status %d: %s", rec.Code, rec.Body.String())
	}
	fork := decode(t, rec)["version"].(map[string]any)
	if fork["number"] != float64(2) {
		t.Errorf("fork number = %v, want 2", fork["number"])
	}
	if fork["parent_id"] != versionID {
		t.Errorf("fork parent_id = %v, want %s", fork["parent_id"], versionID)
	}
	if fork["status"] != "draft" {
		t.Errorf("fork status = %v, want draft", fork["status"])
	}
	forkID := fork["id"].(string)

	// validate the fork: the same valid definition.
	rec = do(t, "POST", "/api/versions/"+forkID+"/validate", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("validate fork: status %d: %s", rec.Code, rec.Body.String())
	}
	if errs := decode(t, rec)["errors"].([]any); len(errs) != 0 {
		t.Errorf("fork errors = %v, want []", errs)
	}

	// GET ghost.
	rec = do(t, "GET", "/api/versions/ghost", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no version ghost")
}

// 4.
func TestValidateErrors(t *testing.T) {
	newTestAPI(t)
	broken := bytes.ReplaceAll(exampleDefinition(t),
		[]byte(`"schema_version": "1"`), []byte(`"schema_version": "2"`))
	versionID := createProcessVersion(t, broken, "Broken")

	rec := do(t, "POST", "/api/versions/"+versionID+"/validate", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("validate: status %d: %s", rec.Code, rec.Body.String())
	}
	errs := decode(t, rec)["errors"].([]any)
	if len(errs) == 0 {
		t.Fatal("errors = [], want at least one")
	}
	first := errs[0].(map[string]any)
	if first["path"] != "/schema_version" {
		t.Errorf("first path = %v, want /schema_version", first["path"])
	}
}

// 5.
func TestCasesAndCommands(t *testing.T) {
	newTestAPI(t)

	// Create the case on the seeded published version.
	rec := do(t, "POST", "/api/cases",
		fmt.Sprintf(`{"version_id":%q,"is_test":true}`, seedVersionID), "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create case: status %d: %s", rec.Code, rec.Body.String())
	}
	cse := decode(t, rec)["case"].(map[string]any)
	year := time.Now().UTC().Format("2006")
	if cse["reference"] != "CASE-"+year+"-0001" {
		t.Errorf("reference = %v, want CASE-%s-0001", cse["reference"], year)
	}
	if cse["is_test"] != true {
		t.Errorf("is_test = %v, want true", cse["is_test"])
	}
	caseID := cse["id"].(string)

	// GET the fresh case: the zero state.
	rec = do(t, "GET", "/api/cases/"+caseID, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get case: status %d: %s", rec.Code, rec.Body.String())
	}
	state := decode(t, rec)["state"].(map[string]any)
	if state["seq"] != float64(0) || state["status"] != "open" ||
		state["node_id"] != "" || state["prev_hash"] != engine.ZeroHash {
		t.Errorf("zero state = %v", state)
	}

	cmd := func(body, user string) map[string]any {
		t.Helper()
		rec := do(t, "POST", "/api/cases/"+caseID+"/commands", body, user)
		if rec.Code != http.StatusOK {
			t.Fatalf("command %s: status %d: %s", body, rec.Code, rec.Body.String())
		}
		return decode(t, rec)
	}

	// start: 3 events, node entry, seq 3.
	ans := cmd(`{"type":"start","data":{}}`, "u-advisor")
	if n := len(ans["events"].([]any)); n != 3 {
		t.Errorf("start events = %d, want 3", n)
	}
	st := ans["state"].(map[string]any)
	if st["node_id"] != "entry" || st["seq"] != float64(3) {
		t.Errorf("start state = %v", st)
	}

	// entry submit: 6 events, node analysis, seq 9, monthly_payment.
	ans = cmd(`{"type":"submit","values":`+entryValues()+`}`, "u-advisor")
	if n := len(ans["events"].([]any)); n != 6 {
		t.Errorf("submit events = %d, want 6", n)
	}
	st = ans["state"].(map[string]any)
	if st["node_id"] != "analysis" || st["seq"] != float64(9) {
		t.Errorf("submit state = %v", st)
	}
	payment := st["data"].(map[string]any)["monthly_payment"].(float64)
	if math.Abs(payment-1391.903) > 0.01 {
		t.Errorf("monthly_payment = %v, want 1391.903 (+/- 0.01)", payment)
	}

	// take: 1 event, the analyst is the assignee.
	ans = cmd(`{"type":"take"}`, "u-analyst")
	if n := len(ans["events"].([]any)); n != 1 {
		t.Errorf("take events = %d, want 1", n)
	}
	if got := ans["state"].(map[string]any)["assignee"]; got != "u-analyst" {
		t.Errorf("assignee = %v, want u-analyst", got)
	}

	// decide favorable: 6 events, the case moves to decision.
	ans = cmd(`{"type":"decide","decision":"favorable"}`, "u-analyst")
	if n := len(ans["events"].([]any)); n != 6 {
		t.Errorf("decide events = %d, want 6", n)
	}
	st = ans["state"].(map[string]any)
	if st["node_id"] != "decision" {
		t.Errorf("decide state = %v, want node decision", st)
	}

	// events: 16, in seq order.
	rec = do(t, "GET", "/api/cases/"+caseID+"/events", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("events: status %d: %s", rec.Code, rec.Body.String())
	}
	events := decode(t, rec)["events"].([]any)
	if len(events) != 16 {
		t.Fatalf("events = %d, want 16", len(events))
	}
	for i, e := range events {
		if got := e.(map[string]any)["seq"]; got != float64(i+1) {
			t.Fatalf("event %d has seq %v", i, got)
		}
	}

	// verify: the chain is intact.
	rec = do(t, "GET", "/api/cases/"+caseID+"/verify", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("verify: status %d: %s", rec.Code, rec.Body.String())
	}
	if got := decode(t, rec)["verify"]; got != float64(0) {
		t.Errorf("verify = %v, want 0", got)
	}

	// at=9: the state after 9 events sits on analysis.
	rec = do(t, "GET", "/api/cases/"+caseID+"?at=9", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("at=9: status %d: %s", rec.Code, rec.Body.String())
	}
	st = decode(t, rec)["state"].(map[string]any)
	if st["node_id"] != "analysis" || st["seq"] != float64(9) {
		t.Errorf("at=9 state = %v", st)
	}

	// at=999: out of range.
	rec = do(t, "GET", "/api/cases/"+caseID+"?at=999", "", "")
	checkError(t, rec, http.StatusBadRequest, "invalid_query", "at must hold 0 to 16")
}

// 6.
func TestCommandRefusals(t *testing.T) {
	newTestAPI(t)
	caseID := analysisCase(t)

	// start again.
	rec := do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"start","data":{}}`, "u-advisor")
	checkError(t, rec, http.StatusConflict, "conflict", "case already started")

	// an unknown field.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"submit","values":{"ghost":1}}`, "u-analyst")
	checkError(t, rec, http.StatusConflict, "conflict", "unknown field ghost")

	// a decision the node does not declare.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"decide","decision":"maybe"}`, "u-analyst")
	checkError(t, rec, http.StatusConflict, "conflict",
		"decision maybe is not a decision of node analysis")

	// an empty document hash.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"sign","document_hash":""}`, "u-analyst")
	checkError(t, rec, http.StatusBadRequest, "invalid_command",
		"document hash is required")

	// an unknown type.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"bogus"}`, "u-analyst")
	checkError(t, rec, http.StatusBadRequest, "invalid_command",
		"unknown command type bogus")

	// no header.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"decide","decision":"favorable"}`, "")
	checkError(t, rec, http.StatusUnauthorized, "unauthorized",
		"the X-Zotra-User header is required")

	// a role the user lacks.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"decide","decision":"favorable"}`, "u-legal")
	checkError(t, rec, http.StatusForbidden, "forbidden",
		"step analysis waits for role analyst")

	// an unknown case.
	rec = do(t, "POST", "/api/cases/ghost/commands",
		`{"type":"decide","decision":"favorable"}`, "u-analyst")
	checkError(t, rec, http.StatusNotFound, "not_found", "no case ghost")
}

// 7.
func TestInbox(t *testing.T) {
	newTestAPI(t)
	caseID := analysisCase(t)

	// The analyst sees the case on analysis.
	rec := do(t, "GET", "/api/inbox", "", "u-analyst")
	if rec.Code != http.StatusOK {
		t.Fatalf("inbox: status %d: %s", rec.Code, rec.Body.String())
	}
	body := decode(t, rec)
	user := body["user"].(map[string]any)
	if user["id"] != "u-analyst" || user["name"] != "Demo Analyst" {
		t.Errorf("user = %v", user)
	}
	roles := user["role_ids"].([]any)
	if len(roles) != 1 || roles[0] != "analyst" {
		t.Errorf("role_ids = %v, want [analyst]", roles)
	}
	cases := body["cases"].([]any)
	if len(cases) != 1 {
		t.Fatalf("cases = %d, want 1", len(cases))
	}
	cse := cases[0].(map[string]any)
	if cse["id"] != caseID || cse["node_id"] != "analysis" || cse["status"] != "open" {
		t.Errorf("inbox case = %v", cse)
	}

	// The decide moves the case to decision.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"decide","decision":"favorable"}`, "u-analyst")
	if rec.Code != http.StatusOK {
		t.Fatalf("decide: status %d: %s", rec.Code, rec.Body.String())
	}

	// The director sees it on decision.
	rec = do(t, "GET", "/api/inbox", "", "u-director")
	if rec.Code != http.StatusOK {
		t.Fatalf("inbox director: status %d: %s", rec.Code, rec.Body.String())
	}
	cases = decode(t, rec)["cases"].([]any)
	if len(cases) != 1 {
		t.Fatalf("director cases = %d, want 1", len(cases))
	}
	if got := cases[0].(map[string]any)["node_id"]; got != "decision" {
		t.Errorf("director node_id = %v, want decision", got)
	}

	// The back office sees nothing.
	rec = do(t, "GET", "/api/inbox", "", "u-backoffice")
	if rec.Code != http.StatusOK {
		t.Fatalf("inbox backoffice: status %d: %s", rec.Code, rec.Body.String())
	}
	if n := len(decode(t, rec)["cases"].([]any)); n != 0 {
		t.Errorf("backoffice cases = %d, want 0", n)
	}
}

// 8.
func TestNoStore(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<p>index</p>")}}
	testAPIHandler = NewHandler(static, "v-test", nil, "")

	rec := do(t, "GET", "/api/processes", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no route for GET /api/processes")

	rec = do(t, "GET", "/api/inbox", "", "u-advisor")
	checkError(t, rec, http.StatusNotFound, "not_found", "no route for GET /api/inbox")
}

// 9.
func TestBrokenDefinitionCase(t *testing.T) {
	newTestAPI(t)

	body := mustCreate(t, "POST", "/api/processes", `{"name":"Broken"}`, http.StatusCreated)
	processID := body["process"].(map[string]any)["id"].(string)

	// A JSON object that the create route accepts and Decode refuses.
	vbody := mustCreate(t, "POST", "/api/processes/"+processID+"/versions",
		`{"label":"Broken","definition":{"schema_version":1}}`, http.StatusCreated)
	versionID := vbody["version"].(map[string]any)["id"].(string)

	caseID := createCase(t, versionID, false)

	rec := do(t, "GET", "/api/cases/"+caseID, "", "")
	checkError(t, rec, http.StatusInternalServerError, "internal",
		"cannot complete the request")

	// The command loads the state first: the same answer.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands", `{"type":"take"}`, "u-advisor")
	checkError(t, rec, http.StatusInternalServerError, "internal",
		"cannot complete the request")
}

// 10.
func TestCommandEdgeStates(t *testing.T) {
	newTestAPI(t)

	// A fresh case: take answers case not started.
	caseID := createCase(t, seedVersionID, true)
	rec := do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"take"}`, "u-advisor")
	checkError(t, rec, http.StatusConflict, "conflict", "case not started")

	// The full run on a fresh case.
	caseID = createCase(t, seedVersionID, true)
	run := []struct{ body, user string }{
		{`{"type":"start","data":{}}`, "u-advisor"},
		{`{"type":"submit","values":` + entryValues() + `}`, "u-advisor"},
		{`{"type":"take"}`, "u-analyst"},
		{`{"type":"decide","decision":"favorable"}`, "u-analyst"},
		{`{"type":"sign","document_hash":"sha256-1"}`, "u-director"},
		{`{"type":"decide","decision":"approve"}`, "u-director"},
		{`{"type":"submit","values":{}}`, "u-legal"},
		{`{"type":"submit","values":{}}`, "u-advisor"},
		{`{"type":"submit","values":{"release_date":"2099-01-01T00:00:00Z"}}`, "u-backoffice"},
	}
	for _, step := range run {
		rec := do(t, "POST", "/api/cases/"+caseID+"/commands", step.body, step.user)
		if rec.Code != http.StatusOK {
			t.Fatalf("command %s as %s: status %d: %s",
				step.body, step.user, rec.Code, rec.Body.String())
		}
	}

	// The case is closed: the end node has no role, so the engine
	// answers.
	rec = do(t, "POST", "/api/cases/"+caseID+"/commands",
		`{"type":"take"}`, "u-backoffice")
	checkError(t, rec, http.StatusConflict, "conflict", "case closed")
}

// 11.
func TestMoreRefusals(t *testing.T) {
	newTestAPI(t)
	caseID := analysisCase(t)

	// decide without decision.
	rec := do(t, "POST", "/api/cases/"+caseID+"/commands", `{"type":"decide"}`, "u-analyst")
	checkError(t, rec, http.StatusBadRequest, "invalid_command", "decision is required")

	// at not an integer. The case has 9 events.
	rec = do(t, "GET", "/api/cases/"+caseID+"?at=abc", "", "")
	checkError(t, rec, http.StatusBadRequest, "invalid_query", "at must hold 0 to 9")

	// an unknown version.
	rec = do(t, "POST", "/api/cases", `{"version_id":"ghost"}`, "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no version ghost")

	// an unknown user.
	rec = do(t, "GET", "/api/inbox", "", "u-ghost")
	checkError(t, rec, http.StatusForbidden, "forbidden", "unknown user u-ghost")

	// a body that does not parse.
	rec = do(t, "POST", "/api/cases", `{bad`, "")
	checkError(t, rec, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
}
