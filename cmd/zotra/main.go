// Command zotra serves the Zotra web app and API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/donovan-ratefison/zotra/internal/api"
	"github.com/donovan-ratefison/zotra/web"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}

func run() error {
	addr := os.Getenv("ZOTRA_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	dist, err := web.Dist()
	if err != nil {
		return fmt.Errorf("web dist: %w", err)
	}

	feedbackDir := os.Getenv("ZOTRA_FEEDBACK_DIR")

	srv := &http.Server{
		Addr:              addr,
		Handler:           api.NewHandler(dist, version, feedbackDir),
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
