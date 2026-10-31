// Command zotra-demo serves the demo core banking endpoints of the
// example process.
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/donovan-ratefison/zotra/internal/demo"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	addr := os.Getenv("ZOTRA_DEMO_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8097"
	}
	log.Printf("zotra-demo %s listens on %s", version, addr)
	log.Fatal(http.ListenAndServe(addr, demo.Handler()))
}
