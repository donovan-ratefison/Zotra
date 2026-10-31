package main

import (
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
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

func TestCliArgs(t *testing.T) { // Z1 to Z6
	rows := []struct {
		name           string
		args           []string
		stdout, stderr string
		code           int
		stop           bool
	}{
		{"Z1", nil, "", "", 0, false},
		{"Z2", []string{"--version"}, "zotra dev\n", "", 0, true},
		{"Z2", []string{"-version"}, "zotra dev\n", "", 0, true},
		{"Z3", []string{"--help"}, zotraUsage, "", 0, true},
		{"Z3", []string{"-help"}, zotraUsage, "", 0, true},
		{"Z3", []string{"-h"}, zotraUsage, "", 0, true},
		{"Z5", []string{"--port"}, "", "zotra: unknown argument \"--port\". Run zotra --help.\n", 2, true},
		{"Z6", []string{"--version", "extra"}, "", "zotra: unknown argument \"--version\". Run zotra --help.\n", 2, true},
	}
	for _, r := range rows {
		var stdout, stderr strings.Builder
		code, stop := cliArgs(r.args, &stdout, &stderr)
		if code != r.code || stop != r.stop || stdout.String() != r.stdout || stderr.String() != r.stderr {
			t.Errorf("%s %v: got %d, %v, stdout %q, stderr %q", r.name, r.args, code, stop, stdout.String(), stderr.String())
		}
	}
	// Z4
	if !strings.HasPrefix(zotraUsage, "Usage: zotra [") || !strings.HasSuffix(zotraUsage, "fails.\n") {
		t.Errorf("Z4: usage %q", zotraUsage)
	}
}

func TestUsageListsEnv(t *testing.T) { // Z7
	re := regexp.MustCompile(`Getenv\("(ZOTRA_[A-Z_]+)"\)`)
	found := 0
	for _, root := range []string{"../../internal", ".."} {
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return err
			}
			src, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			for _, m := range re.FindAllStringSubmatch(string(src), -1) {
				found++
				name := m[1]
				if strings.HasPrefix(name, "ZOTRA_TEST_") || name == "ZOTRA_DEMO_ADDR" {
					continue
				}
				if !strings.Contains(zotraUsage, "  "+name+" ") {
					t.Errorf("Z7: %s (%s) is not in zotraUsage", name, path)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if found == 0 {
		t.Fatal("Z7: no Getenv call found")
	}
}
