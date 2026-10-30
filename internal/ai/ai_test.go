package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	usageBody      = `{"choices":[{"message":{"content":"{}"}}],"usage":{"prompt_tokens":1000,"completion_tokens":500}}`
	noUsageBody    = `{"choices":[{"message":{"content":"{}"}}]}`
	inputNamesBody = `{"output":[],"usage":{"input_tokens":2000,"output_tokens":0}}`
	plainBody      = `ok`
	cachedBody     = `{"status":200,"headers":{"Content-Type":["application/json"]},"body":"{\"cached\":true}"}`
)

// aiCapture is one captured request of the capturing server.
type aiCapture struct {
	Method string
	Path   string
	Auth   string
	Body   []byte
}

// newAIServer returns one server that counts its requests and always
// answers body with status 200.
func newAIServer(t *testing.T, body string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var count atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		count.Add(1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &count
}

// writeCacheFile writes <dir>/<CacheKey(method, uri, body)>.json with
// cached as content. uri is the request URI, path plus query. It does
// not create dir.
func writeCacheFile(t *testing.T, dir, method, uri string, body []byte, cached string) {
	t.Helper()
	path := filepath.Join(dir, CacheKey(method, uri, body)+".json")
	if err := os.WriteFile(path, []byte(cached), 0o644); err != nil {
		t.Fatal(err)
	}
}

// newConfig builds one Config for one row.
func newConfig(mode, cacheDir, baseURL string, budget float64) Config {
	return Config{
		BaseURL:   baseURL,
		APIKey:    "k",
		TextModel: "muse-spark-1.3",
		SAMModel:  "sam-3.1",
		Mode:      mode,
		CacheDir:  cacheDir,
		BudgetUSD: budget,
	}
}

// budgetPath returns the path of the budget file of dir.
func budgetPath(dir string) string {
	return filepath.Join(dir, "budget.json")
}

// post returns one POST request with body.
func post(t *testing.T, url, body string) *http.Request {
	t.Helper()
	req, err := http.NewRequest("POST", url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	return req
}

// readBody reads and closes one response body.
func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := resp.Body.Close(); err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestLoadConfig(t *testing.T) {
	t.Run("defaults", func(t *testing.T) {
		for _, v := range []string{
			"ZOTRA_AI_BASE_URL", "ZOTRA_AI_API_KEY", "ZOTRA_AI_TEXT_MODEL",
			"ZOTRA_AI_SAM_MODEL", "ZOTRA_AI_MODE", "ZOTRA_AI_CACHE_DIR",
			"ZOTRA_AI_BUDGET_USD",
		} {
			t.Setenv(v, "")
		}
		cfg := LoadConfig()
		if cfg.BaseURL != "https://api.meta.ai/v1" || cfg.APIKey != "" ||
			cfg.TextModel != "muse-spark-1.3" || cfg.SAMModel != "sam-3.1" ||
			cfg.Mode != "cache" || cfg.CacheDir != "local/ai-cache" ||
			cfg.BudgetUSD != 2 {
			t.Fatalf("wrong defaults: %+v", cfg)
		}
	})
	t.Run("env values", func(t *testing.T) {
		dir := t.TempDir()
		cacheDir := filepath.Join(dir, "cache")
		t.Setenv("ZOTRA_AI_BASE_URL", "http://127.0.0.1:9")
		t.Setenv("ZOTRA_AI_API_KEY", "k2")
		t.Setenv("ZOTRA_AI_TEXT_MODEL", "model-b")
		t.Setenv("ZOTRA_AI_SAM_MODEL", "model-s")
		t.Setenv("ZOTRA_AI_MODE", "replay")
		t.Setenv("ZOTRA_AI_CACHE_DIR", cacheDir)
		t.Setenv("ZOTRA_AI_BUDGET_USD", "5")
		cfg := LoadConfig()
		if cfg.BaseURL != "http://127.0.0.1:9" || cfg.APIKey != "k2" ||
			cfg.TextModel != "model-b" || cfg.SAMModel != "model-s" ||
			cfg.Mode != "replay" || cfg.CacheDir != cacheDir ||
			cfg.BudgetUSD != 5 {
			t.Fatalf("env values not used: %+v", cfg)
		}
	})
	t.Run("bogus values", func(t *testing.T) {
		t.Setenv("ZOTRA_AI_MODE", "bogus")
		t.Setenv("ZOTRA_AI_BUDGET_USD", "abc")
		cfg := LoadConfig()
		if cfg.Mode != "cache" || cfg.BudgetUSD != 2 {
			t.Fatalf("bogus values not refused: %+v", cfg)
		}
	})
}

func TestTransportOff(t *testing.T) {
	srv, count := newAIServer(t, noUsageBody)
	cfg := newConfig("off", t.TempDir(), srv.URL, 2)
	tr := NewTransport(cfg, nil)
	resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", plainBody))
	if err == nil || err.Error() != "ai: off" || resp != nil {
		t.Fatalf("off mode: err=%v, resp=%v", err, resp)
	}
	if n := count.Load(); n != 0 {
		t.Fatalf("off mode made %d calls, want 0", n)
	}
}

func TestTransportReplayMiss(t *testing.T) {
	srv, count := newAIServer(t, noUsageBody)
	cfg := newConfig("replay", t.TempDir(), srv.URL, 2)
	tr := NewTransport(cfg, nil)
	_, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", plainBody))
	want := "replay: no cached response for " + CacheKey("POST", "/v1/x", []byte(plainBody))
	if err == nil || err.Error() != want {
		t.Fatalf("replay miss: got %v, want %q", err, want)
	}
	if n := count.Load(); n != 0 {
		t.Fatalf("replay miss made %d calls, want 0", n)
	}
}

func TestTransportCacheHit(t *testing.T) {
	srv, count := newAIServer(t, noUsageBody)
	dir := t.TempDir()
	writeCacheFile(t, dir, "POST", "/v1/x", []byte(plainBody), cachedBody)
	cfg := newConfig("cache", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", plainBody))
	if err != nil {
		t.Fatal(err)
	}
	if body := readBody(t, resp); resp.StatusCode != 200 || body != `{"cached":true}` {
		t.Fatalf("cache hit: status=%d, body=%q", resp.StatusCode, body)
	}
	if n := count.Load(); n != 0 {
		t.Fatalf("cache hit made %d calls, want 0", n)
	}
}

func TestTransportCacheRoundTrip(t *testing.T) {
	srv, count := newAIServer(t, noUsageBody)
	dir := filepath.Join(t.TempDir(), "cache")
	cfg := newConfig("cache", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	key := CacheKey("POST", "/v1/x", []byte(plainBody))

	for i := 0; i < 2; i++ {
		resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", plainBody))
		if err != nil {
			t.Fatal(err)
		}
		if body := readBody(t, resp); body != noUsageBody {
			t.Fatalf("call %d: body=%q", i+1, body)
		}
	}
	if n := count.Load(); n != 1 {
		t.Fatalf("server called %d times, want 1", n)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("cache dir not created: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dir, key+".json"))
	if err != nil {
		t.Fatalf("cache file not written: %v", err)
	}
	var e cacheEntry
	if err := json.Unmarshal(b, &e); err != nil {
		t.Fatal(err)
	}
	if e.Status != 200 || e.Body != noUsageBody ||
		e.Headers.Get("Content-Type") != "application/json" {
		t.Fatalf("wrong cache file: %+v", e)
	}
}

func TestTransportLive(t *testing.T) {
	srv, count := newAIServer(t, noUsageBody)
	dir := t.TempDir()
	cfg := newConfig("live", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", plainBody))
	if err != nil {
		t.Fatal(err)
	}
	if body := readBody(t, resp); resp.StatusCode != 200 || body != noUsageBody {
		t.Fatalf("live call: status=%d, body=%q", resp.StatusCode, body)
	}
	if n := count.Load(); n != 1 {
		t.Fatalf("server called %d times, want 1", n)
	}
	key := CacheKey("POST", "/v1/x", []byte(plainBody))
	if _, err := os.Stat(filepath.Join(dir, key+".json")); !os.IsNotExist(err) {
		t.Fatalf("live mode wrote a cache file: %v", err)
	}
}

func TestBudgetStop(t *testing.T) {
	srv, count := newAIServer(t, noUsageBody)
	dir := t.TempDir()
	today := time.Now().UTC().Format("2006-01-02")
	b, err := json.Marshal(budgetEntry{Date: today, Spent: 2.0})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(budgetPath(dir), b, 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := newConfig("live", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	_, err = tr.RoundTrip(post(t, srv.URL+"/v1/x", plainBody))
	want := fmt.Sprintf("ai: budget of 2.00 USD reached for %s", today)
	if err == nil || err.Error() != want {
		t.Fatalf("budget stop: got %v, want %q", err, want)
	}
	if n := count.Load(); n != 0 {
		t.Fatalf("budget stop made %d calls, want 0", n)
	}
}

func TestBudgetCounts(t *testing.T) {
	srv, _ := newAIServer(t, usageBody)
	dir := t.TempDir()
	cfg := newConfig("cache", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", `{"model":"muse-spark-1.3"}`))
	if err != nil {
		t.Fatal(err)
	}
	readBody(t, resp)
	b, err := os.ReadFile(budgetPath(dir))
	if err != nil {
		t.Fatalf("budget file not written: %v", err)
	}
	var e budgetEntry
	if err := json.Unmarshal(b, &e); err != nil {
		t.Fatal(err)
	}
	if e.Date != time.Now().UTC().Format("2006-01-02") {
		t.Fatalf("budget date %q is not today", e.Date)
	}
	if e.Spent < 0.003375-1e-9 || e.Spent > 0.003375+1e-9 {
		t.Fatalf("spent %v, want 0.003375", e.Spent)
	}
}

func TestBudgetResets(t *testing.T) {
	srv, _ := newAIServer(t, noUsageBody)
	dir := t.TempDir()
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	b, err := json.Marshal(budgetEntry{Date: yesterday, Spent: 5.0})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(budgetPath(dir), b, 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := newConfig("cache", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", `{"model":"muse-spark-1.3"}`))
	if err != nil {
		t.Fatal(err)
	}
	readBody(t, resp)
	b, err = os.ReadFile(budgetPath(dir))
	if err != nil {
		t.Fatalf("budget file not written: %v", err)
	}
	var e budgetEntry
	if err := json.Unmarshal(b, &e); err != nil {
		t.Fatal(err)
	}
	if e.Date != time.Now().UTC().Format("2006-01-02") {
		t.Fatalf("budget date %q is not today", e.Date)
	}
	if e.Spent != 0 {
		t.Fatalf("spent %v after the reset, want exactly 0", e.Spent)
	}
}

func TestChatCompletion(t *testing.T) {
	ch := make(chan aiCapture, 4)
	var count atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		body, _ := io.ReadAll(r.Body)
		ch <- aiCapture{Method: r.Method, Path: r.URL.Path,
			Auth: r.Header.Get("Authorization"), Body: body}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, usageBody)
	}))
	t.Cleanup(srv.Close)

	messages := []Message{
		{Role: "system", Content: "You convert a policy to a process."},
		{Role: "user", Content: "p1-1 The bank lends money."},
	}
	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name": map[string]any{"type": "string"},
		},
	}
	dir := t.TempDir()

	cfg := newConfig("cache", dir, srv.URL, 2)
	got, err := New(cfg).ChatCompletion(context.Background(), messages, "process", schema)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != usageBody {
		t.Fatalf("phase 1: body=%q", got)
	}

	cap1 := <-ch
	if cap1.Method != "POST" {
		t.Fatalf("captured method %q, want POST", cap1.Method)
	}
	if cap1.Auth != "Bearer k" {
		t.Fatalf("captured authorization %q, want %q", cap1.Auth, "Bearer k")
	}
	var sent struct {
		Model          string    `json:"model"`
		Messages       []Message `json:"messages"`
		ResponseFormat struct {
			Type       string `json:"type"`
			JSONSchema struct {
				Name   string         `json:"name"`
				Strict bool           `json:"strict"`
				Schema map[string]any `json:"schema"`
			} `json:"json_schema"`
		} `json:"response_format"`
	}
	if err := json.Unmarshal(cap1.Body, &sent); err != nil {
		t.Fatal(err)
	}
	if sent.Model != "muse-spark-1.3" {
		t.Fatalf("sent model %q", sent.Model)
	}
	if !reflect.DeepEqual(sent.Messages, messages) {
		t.Fatalf("sent messages %+v", sent.Messages)
	}
	if sent.ResponseFormat.Type != "json_schema" {
		t.Fatalf("sent response_format type %q", sent.ResponseFormat.Type)
	}
	js := sent.ResponseFormat.JSONSchema
	if js.Name != "process" || !js.Strict || !reflect.DeepEqual(js.Schema, schema) {
		t.Fatalf("sent json_schema %+v", js)
	}

	cfg2 := newConfig("replay", dir, srv.URL, 2)
	got2, err := New(cfg2).ChatCompletion(context.Background(), messages, "process", schema)
	if err != nil {
		t.Fatal(err)
	}
	if string(got2) != usageBody {
		t.Fatalf("phase 2: body=%q", got2)
	}
	if n := count.Load(); n != 1 {
		t.Fatalf("phase 2: server called %d times, want 1", n)
	}
}

func TestResponses(t *testing.T) {
	ch := make(chan aiCapture, 4)
	var count atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		body, _ := io.ReadAll(r.Body)
		ch <- aiCapture{Method: r.Method, Path: r.URL.Path,
			Auth: r.Header.Get("Authorization"), Body: body}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, usageBody)
	}))
	t.Cleanup(srv.Close)

	payload := []byte(`{"model":"sam-3.1","input":"x"}`)
	dir := t.TempDir()

	cfg := newConfig("cache", dir, srv.URL, 2)
	got, err := New(cfg).Responses(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != usageBody {
		t.Fatalf("phase 1: body=%q", got)
	}
	cap1 := <-ch
	if cap1.Method != "POST" || cap1.Path != "/responses" {
		t.Fatalf("captured %s %s, want POST /responses", cap1.Method, cap1.Path)
	}
	if !bytes.Equal(cap1.Body, payload) {
		t.Fatalf("captured body %q, want the payload", cap1.Body)
	}

	cfg2 := newConfig("replay", dir, srv.URL, 2)
	got2, err := New(cfg2).Responses(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if string(got2) != usageBody {
		t.Fatalf("phase 2: body=%q", got2)
	}
	if n := count.Load(); n != 1 {
		t.Fatalf("phase 2: server called %d times, want 1", n)
	}
}

func TestServerErrorNotCached(t *testing.T) {
	var count atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := count.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if n == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprint(w, "boom")
			return
		}
		fmt.Fprint(w, usageBody)
	}))
	t.Cleanup(srv.Close)
	dir := t.TempDir()
	cfg := newConfig("cache", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	key := CacheKey("POST", "/v1/x", []byte(`{"model":"muse-spark-1.3"}`))

	resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", `{"model":"muse-spark-1.3"}`))
	if err != nil {
		t.Fatal(err)
	}
	if body := readBody(t, resp); resp.StatusCode != 500 || body != "boom" {
		t.Fatalf("call 1: status=%d, body=%q", resp.StatusCode, body)
	}
	if _, err := os.Stat(filepath.Join(dir, key+".json")); !os.IsNotExist(err) {
		t.Fatalf("call 1 wrote a cache file: %v", err)
	}

	resp, err = tr.RoundTrip(post(t, srv.URL+"/v1/x", `{"model":"muse-spark-1.3"}`))
	if err != nil {
		t.Fatal(err)
	}
	if body := readBody(t, resp); resp.StatusCode != 200 || body != usageBody {
		t.Fatalf("call 2: status=%d, body=%q", resp.StatusCode, body)
	}
	if n := count.Load(); n != 2 {
		t.Fatalf("call 2: server called %d times, want 2", n)
	}
	if _, err := os.Stat(filepath.Join(dir, key+".json")); err != nil {
		t.Fatalf("call 2 wrote no cache file: %v", err)
	}

	resp, err = tr.RoundTrip(post(t, srv.URL+"/v1/x", `{"model":"muse-spark-1.3"}`))
	if err != nil {
		t.Fatal(err)
	}
	if body := readBody(t, resp); resp.StatusCode != 200 || body != usageBody {
		t.Fatalf("call 3: status=%d, body=%q", resp.StatusCode, body)
	}
	if n := count.Load(); n != 2 {
		t.Fatalf("call 3: server called %d times, want 2", n)
	}
}

func TestUsageNames(t *testing.T) {
	srv, _ := newAIServer(t, inputNamesBody)
	dir := t.TempDir()
	cfg := newConfig("cache", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", `{"model":"sam-3.1"}`))
	if err != nil {
		t.Fatal(err)
	}
	readBody(t, resp)
	b, err := os.ReadFile(budgetPath(dir))
	if err != nil {
		t.Fatalf("budget file not written: %v", err)
	}
	var e budgetEntry
	if err := json.Unmarshal(b, &e); err != nil {
		t.Fatal(err)
	}
	if e.Date != time.Now().UTC().Format("2006-01-02") {
		t.Fatalf("budget date %q is not today", e.Date)
	}
	if e.Spent < 0.0025-1e-9 || e.Spent > 0.0025+1e-9 {
		t.Fatalf("spent %v, want 0.0025", e.Spent)
	}
}

func TestNetworkError(t *testing.T) {
	srv, _ := newAIServer(t, noUsageBody)
	url := srv.URL
	srv.Close()
	dir := t.TempDir()
	cfg := newConfig("cache", dir, url, 2)
	tr := NewTransport(cfg, nil)
	if _, err := tr.RoundTrip(post(t, url+"/v1/x", plainBody)); err == nil {
		t.Fatal("closed server: want an error")
	}
	key := CacheKey("POST", "/v1/x", []byte(plainBody))
	if _, err := os.Stat(filepath.Join(dir, key+".json")); !os.IsNotExist(err) {
		t.Fatalf("network error wrote a cache file: %v", err)
	}
	if _, err := os.Stat(budgetPath(dir)); !os.IsNotExist(err) {
		t.Fatalf("network error wrote a budget file: %v", err)
	}
}

func TestClientStatusError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, "err")
	}))
	t.Cleanup(srv.Close)
	cfg := newConfig("live", t.TempDir(), srv.URL, 2)
	_, err := New(cfg).ChatCompletion(context.Background(),
		[]Message{{Role: "user", Content: "x"}}, "process",
		map[string]any{"type": "object"})
	want := "ai: status 500 from /chat/completions"
	if err == nil || err.Error() != want {
		t.Fatalf("status error: got %v, want %q", err, want)
	}
}

func TestCostLog(t *testing.T) {
	srv, _ := newAIServer(t, usageBody)
	dir := t.TempDir()
	cfg := newConfig("cache", dir, srv.URL, 2)
	tr := NewTransport(cfg, nil)
	var buf bytes.Buffer
	w := log.Writer()
	flags := log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	defer func() { log.SetOutput(w); log.SetFlags(flags) }()
	resp, err := tr.RoundTrip(post(t, srv.URL+"/v1/x", `{"model":"muse-spark-1.3"}`))
	if err != nil {
		t.Fatal(err)
	}
	readBody(t, resp)
	want := "ai: model muse-spark-1.3 cost $0.0034 (spent $0.0034 of $2.00)"
	if got := strings.TrimSpace(buf.String()); got != want {
		t.Fatalf("log line %q, want %q", got, want)
	}
}

func TestPricePerMillion(t *testing.T) {
	for _, c := range []struct {
		model   string
		in, out float64
	}{
		{"muse-spark-1.3", 1.25, 4.25},
		{"muse-spark-1.3-contributor", 0.10, 0.20},
		{"muse-wonder-1.0", 4, 20},
		{"unknown", 1.25, 4.25},
	} {
		in, out := pricePerMillion(c.model)
		if in != c.in || out != c.out {
			t.Errorf("%s: got %v/%v, want %v/%v", c.model, in, out, c.in, c.out)
		}
	}
}
