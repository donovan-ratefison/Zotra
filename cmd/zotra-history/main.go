// Command zotra-history fills the database of the app with a demo
// history of the example process.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/donovan-ratefison/zotra/internal/history"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

const historyUsage = `Usage: zotra-history [-days N] [-cases N] [-version] [-help]

zotra-history adds a demo history of past cases to the example process.

  -days N    Number of days of the history, 1 to 90. Default 30.
  -cases N   Number of cases, 1 to 500. Default 60.
  -version   Print the version and stop.

Environment variables:

  ZOTRA_DATABASE_URL  PostgreSQL URL. Required.
`

const exampleVersionID = "00000000-0000-0000-0000-000000000002"

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv("ZOTRA_DATABASE_URL"), os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "zotra-history: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, dbURL string, out io.Writer) error {
	fs := flag.NewFlagSet("zotra-history", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	days := fs.Int("days", 30, "number of days of the history")
	n := fs.Int("cases", 60, "number of cases")
	showVersion := fs.Bool("version", false, "print the version and stop")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			_, err = fmt.Fprint(out, historyUsage)
		}
		return err
	}
	if *showVersion {
		_, err := fmt.Fprintf(out, "zotra-history %s\n", version)
		return err
	}
	if *n < 1 || *n > 500 {
		return errors.New("-cases must hold 1 to 500")
	}
	// The flow view accepts 1 to 90 days.
	if *days < 1 || *days > 90 {
		return errors.New("-days must hold 1 to 90")
	}
	if dbURL == "" {
		return errors.New("ZOTRA_DATABASE_URL is required")
	}
	st, err := store.Open(ctx, dbURL)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()
	cases, err := st.ListCases(ctx)
	if err != nil {
		return err
	}
	exampleReal := false
	for _, c := range cases {
		if c.IsTest {
			continue
		}
		if c.VersionID != exampleVersionID {
			return fmt.Errorf("refused: real case %s is on another version", c.Reference)
		}
		exampleReal = true
	}
	if exampleReal {
		return errors.New("refused: the example version already has real cases")
	}
	plans := history.Plan(*n, *days, time.Now())
	if err := history.Play(ctx, st, exampleVersionID, plans); err != nil {
		return err
	}
	closed, open, late := 0, 0, 0
	for _, p := range plans {
		if p.Result != "" {
			closed++
			continue
		}
		open++
		if p.Late {
			late++
		}
	}
	_, err = fmt.Fprintf(out, "played %d cases: %d closed, %d open (%d late)\n", len(plans), closed, open, late)
	return err
}
