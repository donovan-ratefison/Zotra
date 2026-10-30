package sources

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/donovan-ratefison/zotra/internal/process"
)

// serve starts a test server with the handler and returns a source
// on its url.
func serve(t *testing.T, h http.HandlerFunc) process.Source {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return process.Source{ID: "blacklist", URL: srv.URL + "/api/blacklist"}
}

// S1.
func TestFetchObject(t *testing.T) {
	src := serve(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"listed":true}`))
	})
	got, err := Fetch(context.Background(), src)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if want := map[string]any{"listed": true}; !reflect.DeepEqual(got, want) {
		t.Errorf("Fetch = %v, want %v", got, want)
	}
}

// S2.
func TestFetchRefusals(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
		timeout time.Duration
		want    string
	}{
		{"status 500", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}, 0, "status 500"},
		{"array body", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`[]`))
		}, 0, "the body must be a JSON object"},
		{"null body", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`null`))
		}, 0, "the body must be a JSON object"},
		{"ctx deadline", func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-time.After(time.Second):
			case <-r.Context().Done():
			}
		}, 50 * time.Millisecond, "context deadline exceeded"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := serve(t, tt.handler)
			ctx := context.Background()
			if tt.timeout > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tt.timeout)
				defer cancel()
			}
			got, err := Fetch(ctx, src)
			if err == nil || err.Error() != tt.want {
				t.Errorf("Fetch error = %v, want %s", err, tt.want)
			}
			if got != nil {
				t.Errorf("Fetch = %v, want nil", got)
			}
		})
	}
}

func TestSimulated(t *testing.T) {
	src := process.Source{ID: "blacklist", TestValues: map[string]any{"listed": false}}
	got := Simulated(src)
	if !reflect.DeepEqual(got, map[string]any{"listed": false}) {
		t.Errorf("Simulated = %v, want listed false", got)
	}
	got["listed"] = true
	if src.TestValues["listed"] != false {
		t.Error("Simulated returned the definition map, want a copy")
	}
	if empty := Simulated(process.Source{}); empty == nil || len(empty) != 0 {
		t.Errorf("Simulated of nil test values = %#v, want an empty map", empty)
	}
}
