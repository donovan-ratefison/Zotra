// Command zotra serves the Zotra web app and API.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/donovan-ratefison/zotra/internal/api"
	"github.com/donovan-ratefison/zotra/internal/store"
	"github.com/donovan-ratefison/zotra/web"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if len(os.Args) == 2 && os.Args[1] == "health" {
		if err := healthcheck(listenAddr()); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if code, stop := cliArgs(os.Args[1:], os.Stdout, os.Stderr); stop {
		os.Exit(code)
	}
	if err := run(); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}

const zotraUsage = `Usage: zotra [--version | --help | health]

Zotra serves the web app and the API. Environment variables:

  ZOTRA_ADDR             Listen address. Default :8080.
  ZOTRA_DATABASE_URL     PostgreSQL URL. Empty: no process, case or inbox routes.
  ZOTRA_FEEDBACK_DIR     Folder of the feedback items. Empty: no feedback routes.
  ZOTRA_AI_MODE          live, cache, replay or off. Default cache.
  ZOTRA_AI_API_KEY       Meta API key.
  ZOTRA_AI_BASE_URL      Meta API URL. Default https://api.meta.ai/v1.
  ZOTRA_AI_TEXT_MODEL    Text model. Default muse-spark-1.3.
  ZOTRA_AI_SAM_MODEL     SAM model. Default sam-3.1.
  ZOTRA_AI_READ_MODEL    Field reading model. Empty: the text model.
  ZOTRA_AI_DOC_BASE_URL  URL of the document calls. Empty: ZOTRA_AI_BASE_URL.
  ZOTRA_AI_DOC_API_KEY   Key of the document calls. Empty: ZOTRA_AI_API_KEY.
  ZOTRA_AI_CACHE_DIR     Folder of the AI cache. Default local/ai-cache.
  ZOTRA_AI_STATE_DIR     Folder of the daily AI budget. Empty: the cache folder.
  ZOTRA_AI_BUDGET_USD    Daily AI budget in USD. Default 2.

health asks /api/health of the app on ZOTRA_ADDR and exits 1 if it fails.
`

// cliArgs handles the arguments. stop is true when the command must
// stop with the exit code code. No argument starts the server.
func cliArgs(args []string, stdout, stderr io.Writer) (code int, stop bool) {
	if len(args) == 0 {
		return 0, false
	}
	if len(args) == 1 {
		switch args[0] {
		case "--version", "-version":
			fmt.Fprintf(stdout, "zotra %s\n", version)
			return 0, true
		case "--help", "-help", "-h":
			fmt.Fprint(stdout, zotraUsage)
			return 0, true
		}
	}
	fmt.Fprintf(stderr, "zotra: unknown argument %q. Run zotra --help.\n", args[0])
	return 2, true
}

// listenAddr returns ZOTRA_ADDR, or ":8080" if it is empty.
func listenAddr() string {
	if addr := os.Getenv("ZOTRA_ADDR"); addr != "" {
		return addr
	}
	return ":8080"
}

// healthcheck asks /api/health of the app that listens on addr. The
// container healthcheck uses it because the image has no curl.
func healthcheck(addr string) error {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("health: %w", err)
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		return fmt.Errorf("health: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health: status %d", resp.StatusCode)
	}
	return nil
}

func run() error {
	addr := listenAddr()

	dist, err := web.Dist()
	if err != nil {
		return fmt.Errorf("web dist: %w", err)
	}

	feedbackDir := os.Getenv("ZOTRA_FEEDBACK_DIR")

	databaseURL := os.Getenv("ZOTRA_DATABASE_URL")
	var st *store.Store
	if databaseURL != "" {
		var err error
		st, err = store.Open(context.Background(), databaseURL)
		if err != nil {
			return fmt.Errorf("open store: %w", err)
		}
		defer st.Close()
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           api.NewHandler(dist, version, st, feedbackDir),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ListenAndServe() }()

	slog.Info("listening", "addr", addr)

	select {
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve: %w", err)
		}
		return nil
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	slog.Info("stopped")
	return nil
}
