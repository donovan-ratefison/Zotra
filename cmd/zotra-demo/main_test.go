package main

import (
	"strings"
	"testing"
)

func TestCliArgs(t *testing.T) { // D1 to D4
	rows := []struct {
		name           string
		args           []string
		stdout, stderr string
		code           int
		stop           bool
	}{
		{"D1", nil, "", "", 0, false},
		{"D2", []string{"--version"}, "zotra-demo dev\n", "", 0, true},
		{"D3", []string{"-h"}, demoUsage, "", 0, true},
		{"D4", []string{"x"}, "", "zotra-demo: unknown argument \"x\". Run zotra-demo --help.\n", 2, true},
	}
	for _, r := range rows {
		var stdout, stderr strings.Builder
		code, stop := cliArgs(r.args, &stdout, &stderr)
		if code != r.code || stop != r.stop || stdout.String() != r.stdout || stderr.String() != r.stderr {
			t.Errorf("%s: got %d, %v, stdout %q, stderr %q", r.name, code, stop, stdout.String(), stderr.String())
		}
	}
}
