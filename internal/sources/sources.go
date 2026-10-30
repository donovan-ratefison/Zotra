// Package sources reads the external HTTP JSON sources of a process:
// a GET on the source url for a real case, the test values for a test
// case.
package sources

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"time"

	"github.com/donovan-ratefison/zotra/internal/process"
)

// FetchTimeout bounds one fetch.
const FetchTimeout = 5 * time.Second

// maxBody bounds the body of one answer, so a large answer cannot
// fill the memory.
const maxBody = 1 << 20

var client = &http.Client{Timeout: FetchTimeout}

// Simulated returns a copy of the test_values of the source, never
// nil.
func Simulated(src process.Source) map[string]any {
	out := make(map[string]any, len(src.TestValues))
	maps.Copy(out, src.TestValues)
	return out
}

// Fetch GETs the url with the FetchTimeout client, honors the ctx
// deadline, and returns the parsed JSON object. It returns the bare
// reason: "status 500" for a non-200 answer, "the body must be a JSON
// object" for a body that is not an object, and for a transport error
// the error text, or the ctx error when the ctx ended.
func Fetch(ctx context.Context, src process.Source) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src.URL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var values map[string]any
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&values); err != nil || values == nil {
		return nil, errors.New("the body must be a JSON object")
	}
	return values, nil
}
