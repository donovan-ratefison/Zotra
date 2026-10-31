package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthcheck(t *testing.T) { // H1 to H6
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			http.NotFound(w, r)
		}
	}))
	defer ok.Close()
	_, port, _ := net.SplitHostPort(ok.Listener.Addr().String())

	for name, addr := range map[string]string{
		"H1": "127.0.0.1:" + port,
		"H2": ":" + port,
		"H3": "0.0.0.0:" + port,
	} {
		if err := healthcheck(addr); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}

	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer down.Close()
	if err := healthcheck(down.Listener.Addr().String()); err == nil || !strings.Contains(err.Error(), "503") {
		t.Errorf("H4: error %v, want 503", err)
	}

	closed := httptest.NewServer(http.NotFoundHandler())
	addr := closed.Listener.Addr().String()
	closed.Close()
	if err := healthcheck(addr); err == nil {
		t.Error("H5: no error on a closed port")
	}

	if err := healthcheck("nonsense"); err == nil {
		t.Error("H6: no error on an address with no port")
	}
}
