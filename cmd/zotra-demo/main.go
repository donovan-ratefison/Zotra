// Command zotra-demo serves the demo core banking endpoints of the
// example process.
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/donovan-ratefison/zotra/internal/demo"
)

func main() {
	addr := os.Getenv("ZOTRA_DEMO_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8097"
	}
	log.Printf("zotra-demo listens on %s", addr)
	log.Fatal(http.ListenAndServe(addr, demo.Handler()))
}
