// Package store keeps processes, versions, cases, users, documents
// and the append-only event log in PostgreSQL. Open applies the
// embedded migrations and then runs the seed.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"

	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Status values of a version.
const (
	StatusDraft     = "draft"
	StatusFrozen    = "frozen"
	StatusPublished = "published"
)

// Store is the PostgreSQL store of Zotra.
type Store struct {
	db *pgxpool.Pool
}

// Open connects to the database at url, applies the migrations, then
// runs the seed. The seed is idempotent.
func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	s := &Store{db: pool}
	db, err := sql.Open("pgx", url)
	if err != nil {
		s.Close()
		return nil, fmt.Errorf("open migrations db: %w", err)
	}
	defer db.Close()
	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		s.Close()
		return nil, fmt.Errorf("goose dialect: %w", err)
	}
	if err := goose.Up(db, "migrations"); err != nil {
		s.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := Seed(ctx, s); err != nil {
		s.Close()
		return nil, fmt.Errorf("seed: %w", err)
	}
	return s, nil
}

// Close releases the pool.
func (s *Store) Close() {
	if s.db != nil {
		s.db.Close()
	}
}

// pool returns the connection pool. The test file uses it to run raw
// SQL, for example against the append-only trigger.
func (s *Store) pool() *pgxpool.Pool {
	return s.db
}

// newID returns a random uuid version 4 as a string, built with
// crypto/rand. A read error panics: the machine has no entropy
// source.
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// row types. The uuid columns travel as strings.

// User is one row of the users table.
type User struct {
	ID      string
	Name    string
	RoleIDs []string
}

// Process is one row of the processes table.
type Process struct {
	ID        string
	Name      string
	CreatedAt time.Time
}

// Version is one row of the versions table. Definition holds the
// jsonb bytes.
type Version struct {
	ID         string
	ProcessID  string
	ParentID   *string
	Number     int
	Label      string
	Status     string
	Definition []byte
	CreatedAt  time.Time
	FrozenAt   *time.Time
}

// Case is one row of the cases table.
type Case struct {
	ID        string
	VersionID string
	Reference string
	IsTest    bool
	CreatedAt time.Time
}
