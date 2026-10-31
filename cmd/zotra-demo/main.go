// Command zotra-demo serves the demo core banking endpoints of the
// example process.
package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/donovan-ratefison/zotra/internal/demo"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

const demoUsage = `Usage: zotra-demo [--version | --help]

zotra-demo serves the demo core banking endpoints of the example process.
Environment variables:

  ZOTRA_DEMO_ADDR  Listen address. Default 127.0.0.1:8097.
`

func main() {
	if code, stop := cliArgs(os.Args[1:], os.Stdout, os.Stderr); stop {
		os.Exit(code)
	}
	addr := os.Getenv("ZOTRA_DEMO_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8097"
	}
	log.Printf("zotra-demo %s listens on %s", version, addr)
	log.Fatal(http.ListenAndServe(addr, demo.Handler()))
}

// cliArgs handles the arguments. stop is true when the command must
// stop with the exit code code. No argument starts the server.
func cliArgs(args []string, stdout, stderr io.Writer) (code int, stop bool) {
	if len(args) == 0 {
		return 0, false
	}
	if len(args) == 1 {
		switch args[0] {
		case "--version", "-version":
			fmt.Fprintf(stdout, "zotra-demo %s\n", version)
			return 0, true
		case "--help", "-help", "-h":
			fmt.Fprint(stdout, demoUsage)
			return 0, true
		}
	}
	fmt.Fprintf(stderr, "zotra-demo: unknown argument %q. Run zotra-demo --help.\n", args[0])
	return 2, true
}
