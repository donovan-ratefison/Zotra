package ai

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Transport is an http.RoundTripper with four modes: live, cache,
// replay and off, and a daily budget guard.
type Transport struct {
	cfg  Config
	next http.RoundTripper
	mu   sync.Mutex
}

// cacheEntry is one cached response, as stored in <CacheDir>/<key>.json.
type cacheEntry struct {
	Status  int         `json:"status"`
	Headers http.Header `json:"headers"`
	Body    string      `json:"body"`
}

// budgetEntry is the content of <CacheDir>/budget.json.
type budgetEntry struct {
	Date  string  `json:"date"`
	Spent float64 `json:"spent"`
}

// NewTransport returns the transport of one configuration. The real
// calls go through next; a nil next means http.DefaultTransport.
func NewTransport(cfg Config, next http.RoundTripper) *Transport {
	return &Transport{cfg: cfg, next: next}
}

// CacheKey returns the cache key of one request: the sha256 hex of
// the method, the request URI and the body, joined by newlines. The
// API key never enters the key.
func CacheKey(method, requestURI string, body []byte) string {
	h := sha256.New()
	h.Write([]byte(method))
	h.Write([]byte("\n"))
	h.Write([]byte(requestURI))
	h.Write([]byte("\n"))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

// RoundTrip answers one request in the mode of the configuration.
func (t *Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.cfg.Mode == "off" {
		return nil, errors.New("ai: off")
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, err
	}
	req.Body = io.NopCloser(bytes.NewReader(body))
	key := CacheKey(req.Method, req.URL.RequestURI(), body)

	switch t.cfg.Mode {
	case "cache", "replay":
		if resp, ok := t.readCache(filepath.Join(t.cfg.CacheDir, key+".json")); ok {
			return resp, nil
		}
		if t.cfg.Mode == "replay" {
			return nil, fmt.Errorf("replay: no cached response for %s", key)
		}
	}

	resp, err := t.realCall(req, body)
	if err != nil {
		return nil, err
	}
	// The cache holds complete answers only: a 2xx status. A refused
	// answer (400 and the like) reaches the API again on the next
	// call. The budget cost keeps its own rule below 500.
	if t.cfg.Mode == "cache" && resp.StatusCode >= 200 && resp.StatusCode <= 299 {
		if werr := t.writeCache(filepath.Join(t.cfg.CacheDir, key+".json"), resp.StatusCode, resp.Header, bodyOf(resp)); werr != nil {
			return nil, werr
		}
	}
	return resp, nil
}

// realCall makes one real call under the budget mutex, from the
// guard to the budget write. Two concurrent real calls therefore
// cannot lose a cost.
func (t *Transport) realCall(req *http.Request, body []byte) (*http.Response, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	today := time.Now().UTC().Format("2006-01-02")
	spent := t.spentToday(today)
	if spent >= t.cfg.BudgetUSD {
		return nil, fmt.Errorf("ai: budget of %.2f USD reached for %s", t.cfg.BudgetUSD, today)
	}

	next := t.next
	if next == nil {
		next = http.DefaultTransport
	}
	resp, err := next.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	respBody, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return nil, err
	}
	resp.Body = io.NopCloser(bytes.NewReader(respBody))

	cost := 0.0
	if resp.StatusCode < 500 {
		cost = costOf(body, respBody)
	}
	spent += cost
	t.writeBudget(today, spent)
	log.Printf("ai: model %s cost $%.4f (spent $%.4f of $%.2f)",
		modelOf(body), cost, spent, t.cfg.BudgetUSD)
	return resp, nil
}

// spentToday reads the budget file. An unreadable or absent file, or
// a date that is not today, starts a fresh day at 0.
func (t *Transport) spentToday(today string) float64 {
	b, err := os.ReadFile(filepath.Join(t.cfg.CacheDir, "budget.json"))
	if err != nil {
		return 0
	}
	var e budgetEntry
	if err := json.Unmarshal(b, &e); err != nil || e.Date != today {
		return 0
	}
	return e.Spent
}

// writeBudget writes the budget file after each real call, also when
// the cost is 0.
func (t *Transport) writeBudget(today string, spent float64) {
	if err := os.MkdirAll(t.cfg.CacheDir, 0o755); err != nil {
		log.Printf("ai: budget store not written: %v", err)
		return
	}
	b, err := json.Marshal(budgetEntry{Date: today, Spent: spent})
	if err != nil {
		log.Printf("ai: budget store not written: %v", err)
		return
	}
	if werr := writeFile(filepath.Join(t.cfg.CacheDir, "budget.json"), b); werr != nil {
		log.Printf("ai: budget store not written: %v", werr)
	}
}

// costOf parses the usage object of one response body and returns
// the cost of the call. The model name comes from the request body.
func costOf(reqBody, respBody []byte) float64 {
	model := modelOf(reqBody)
	in, out := pricePerMillion(model)
	var r struct {
		Usage struct {
			PromptTokens     float64 `json:"prompt_tokens"`
			InputTokens      float64 `json:"input_tokens"`
			CompletionTokens float64 `json:"completion_tokens"`
			OutputTokens     float64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(respBody, &r); err != nil {
		return 0
	}
	u := r.Usage
	return (u.PromptTokens+u.InputTokens)/1e6*in + (u.CompletionTokens+u.OutputTokens)/1e6*out
}

// modelOf reads the model field of one request body.
func modelOf(body []byte) string {
	var r struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return ""
	}
	return r.Model
}

// readCache reads one cache file. An unreadable or unparsable file is
// a miss.
func (t *Transport) readCache(path string) (*http.Response, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	var e cacheEntry
	if err := json.Unmarshal(b, &e); err != nil {
		return nil, false
	}
	return &http.Response{
		StatusCode:    e.Status,
		Header:        e.Headers,
		Body:          io.NopCloser(strings.NewReader(e.Body)),
		ContentLength: int64(len(e.Body)),
	}, true
}

// writeCache writes one cache file with two-space indentation, over a
// temporary file in the same directory, then a rename.
func (t *Transport) writeCache(path string, status int, headers http.Header, body []byte) error {
	if err := os.MkdirAll(t.cfg.CacheDir, 0o755); err != nil {
		return err
	}
	entry := cacheEntry{Status: status, Headers: headers, Body: string(body)}
	b, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(path, b)
}

// writeFile writes b to path over a temporary file in the same
// directory, then a rename.
func writeFile(path string, b []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "zotra-ai-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(b); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return nil
}

// bodyOf reads one response body and puts an equivalent reader back.
func bodyOf(resp *http.Response) []byte {
	b, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return nil
	}
	resp.Body = io.NopCloser(bytes.NewReader(b))
	return b
}
