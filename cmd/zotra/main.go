// Command zotra serves the Zotra web app and API.
package main

import (
	"context"
	"errors"
	"fmt"
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
	if err := run(); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
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
