package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/donovan-ratefison/zotra/internal/engine"
)

// uuidShape matches a uuid string. The id columns of the schema are
// uuid columns, except users.id.
var uuidShape = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isUUID reports whether id has the shape of a uuid. A non-uuid id
// can never match a uuid column, so the lookup returns the
// row-absent error at once, and the query never runs.
func isUUID(id string) bool {
	return uuidShape.MatchString(id)
}

// notExist builds the row-absent error: <kind> <id> does not exist.
func notExist(kind, id string) error {
	return fmt.Errorf("%s %s does not exist", kind, id)
}

// isAbsent reports whether err means "no row". With pgxpool, Scan
// returns pgx.ErrNoRows, which wraps sql.ErrNoRows.
func isAbsent(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

// ListUsers returns all users in id order.
func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, name, role_ids FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.RoleIDs); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// UserByID returns one user, or the row-absent error.
func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	var u User
	err := s.db.QueryRow(ctx,
		`SELECT id, name, role_ids FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Name, &u.RoleIDs)
	if isAbsent(err) {
		return User{}, notExist("user", id)
	}
	return u, err
}

// CreateProcess inserts a process with a new id and returns it.
func (s *Store) CreateProcess(ctx context.Context, name string) (Process, error) {
	p := Process{ID: newID(), Name: name}
	err := s.db.QueryRow(ctx,
		`INSERT INTO processes (id, name) VALUES ($1, $2)
		 RETURNING created_at`, p.ID, p.Name).Scan(&p.CreatedAt)
	return p, err
}

// ListProcesses returns all processes, created_at first, then id.
func (s *Store) ListProcesses(ctx context.Context) ([]Process, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, name, created_at, archived_at FROM processes ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var processes []Process
	for rows.Next() {
		var p Process
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.ArchivedAt); err != nil {
			return nil, err
		}
		processes = append(processes, p)
	}
	return processes, rows.Err()
}

// ProcessByID returns one process, or the row-absent error.
func (s *Store) ProcessByID(ctx context.Context, id string) (Process, error) {
	if !isUUID(id) {
		return Process{}, notExist("process", id)
	}
	var p Process
	err := s.db.QueryRow(ctx,
		`SELECT id, name, created_at, archived_at FROM processes WHERE id = $1`, id).
		Scan(&p.ID, &p.Name, &p.CreatedAt, &p.ArchivedAt)
	if isAbsent(err) {
		return Process{}, notExist("process", id)
	}
	return p, err
}

// SetProcessArchived archives (archived_at = now) or restores
// (archived_at = NULL) one process. A second archive keeps the first
// archived_at. The versions and cases stay.
func (s *Store) SetProcessArchived(ctx context.Context, id string, archived bool) (Process, error) {
	if !isUUID(id) {
		return Process{}, notExist("process", id)
	}
	var p Process
	err := s.db.QueryRow(ctx,
		`UPDATE processes
		 SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, now()) END
		 WHERE id = $1
		 RETURNING id, name, created_at, archived_at`, id, archived).
		Scan(&p.ID, &p.Name, &p.CreatedAt, &p.ArchivedAt)
	if isAbsent(err) {
		return Process{}, notExist("process", id)
	}
	return p, err
}

// createVersion inserts one draft version. The number is
// max(number) + 1 of the process, computed in the same INSERT.
func (s *Store) createVersion(ctx context.Context, processID string, parentID *string, label string, definition []byte) (Version, error) {
	v := Version{
		ID:         newID(),
		ProcessID:  processID,
		ParentID:   parentID,
		Label:      label,
		Status:     StatusDraft,
		Definition: definition,
	}
	err := s.db.QueryRow(ctx, `
		INSERT INTO versions (id, process_id, parent_id, number, label, status, definition)
		SELECT $1, $2, $3, COALESCE(MAX(number), 0) + 1, $4, $5, $6
		FROM versions WHERE process_id = $2
		RETURNING number, created_at`,
		v.ID, v.ProcessID, v.ParentID, v.Label, v.Status, v.Definition).
		Scan(&v.Number, &v.CreatedAt)
	return v, err
}

// CreateVersion creates a draft of the process. An unknown process
// gives process <id> does not exist.
func (s *Store) CreateVersion(ctx context.Context, processID string, parentID *string, label string, definition []byte) (Version, error) {
	if !isUUID(processID) {
		return Version{}, notExist("process", processID)
	}
	var one bool
	err := s.db.QueryRow(ctx,
		`SELECT true FROM processes WHERE id = $1`, processID).Scan(&one)
	if isAbsent(err) {
		return Version{}, notExist("process", processID)
	}
	if err != nil {
		return Version{}, err
	}
	return s.createVersion(ctx, processID, parentID, label, definition)
}

// GetVersion returns one version, or the row-absent error.
func (s *Store) GetVersion(ctx context.Context, id string) (Version, error) {
	if !isUUID(id) {
		return Version{}, notExist("version", id)
	}
	var v Version
	err := s.db.QueryRow(ctx, `
		SELECT id, process_id, parent_id, number, label, status, definition, created_at, frozen_at
		FROM versions WHERE id = $1`, id).
		Scan(&v.ID, &v.ProcessID, &v.ParentID, &v.Number, &v.Label,
			&v.Status, &v.Definition, &v.CreatedAt, &v.FrozenAt)
	if isAbsent(err) {
		return Version{}, notExist("version", id)
	}
	return v, err
}

// ListVersions returns the versions of the process in number order.
func (s *Store) ListVersions(ctx context.Context, processID string) ([]Version, error) {
	if !isUUID(processID) {
		return nil, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, process_id, parent_id, number, label, status, definition, created_at, frozen_at
		FROM versions WHERE process_id = $1 ORDER BY number`, processID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var versions []Version
	for rows.Next() {
		var v Version
		if err := rows.Scan(&v.ID, &v.ProcessID, &v.ParentID, &v.Number,
			&v.Label, &v.Status, &v.Definition, &v.CreatedAt, &v.FrozenAt); err != nil {
			return nil, err
		}
		versions = append(versions, v)
	}
	return versions, rows.Err()
}

// versionStatus returns the status of the version, or the row-absent
// error. Each lifecycle method checks the status first, with one
// SELECT.
func (s *Store) versionStatus(ctx context.Context, id string) (string, error) {
	if !isUUID(id) {
		return "", notExist("version", id)
	}
	var status string
	err := s.db.QueryRow(ctx,
		`SELECT status FROM versions WHERE id = $1`, id).Scan(&status)
	if isAbsent(err) {
		return "", notExist("version", id)
	}
	return status, err
}

// UpdateDraft changes the definition of a draft only.
func (s *Store) UpdateDraft(ctx context.Context, id string, definition []byte) error {
	status, err := s.versionStatus(ctx, id)
	if err != nil {
		return err
	}
	if status != StatusDraft {
		return fmt.Errorf("version %s is not a draft", id)
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE versions SET definition = $2
		WHERE id = $1 AND status = $3`, id, definition, StatusDraft)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("version %s is not a draft", id)
	}
	return nil
}

// Freeze moves a draft to frozen and sets frozen_at.
func (s *Store) Freeze(ctx context.Context, id string) error {
	status, err := s.versionStatus(ctx, id)
	if err != nil {
		return err
	}
	if status != StatusDraft {
		return fmt.Errorf("version %s is not a draft", id)
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE versions SET status = $3, frozen_at = now()
		WHERE id = $1 AND status = $2`, id, StatusDraft, StatusFrozen)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("version %s is not a draft", id)
	}
	return nil
}

// Publish moves a frozen version to published.
func (s *Store) Publish(ctx context.Context, id string) error {
	status, err := s.versionStatus(ctx, id)
	if err != nil {
		return err
	}
	if status != StatusFrozen {
		return fmt.Errorf("version %s is not frozen", id)
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE versions SET status = $3
		WHERE id = $1 AND status = $2`, id, StatusFrozen, StatusPublished)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("version %s is not frozen", id)
	}
	return nil
}

// Fork creates a draft in the same process, with parent_id = the
// source id, the same definition, the next number and the label
// given.
func (s *Store) Fork(ctx context.Context, id string, label string) (Version, error) {
	if !isUUID(id) {
		return Version{}, notExist("version", id)
	}
	var processID string
	var definition []byte
	err := s.db.QueryRow(ctx,
		`SELECT process_id, definition FROM versions WHERE id = $1`, id).
		Scan(&processID, &definition)
	if isAbsent(err) {
		return Version{}, notExist("version", id)
	}
	if err != nil {
		return Version{}, err
	}
	return s.createVersion(ctx, processID, &id, label, definition)
}

// CreateCase creates a case on the version, with the reference
// CASE-<YYYY>-<NNNN>. YYYY is the UTC year, NNNN the next number of
// the year, zero padded to 4. A unique violation retries, at most 3
// times. An unknown version gives version <id> does not exist.
func (s *Store) CreateCase(ctx context.Context, versionID string, isTest bool) (Case, error) {
	if !isUUID(versionID) {
		return Case{}, notExist("version", versionID)
	}
	var one bool
	err := s.db.QueryRow(ctx,
		`SELECT true FROM versions WHERE id = $1`, versionID).Scan(&one)
	if isAbsent(err) {
		return Case{}, notExist("version", versionID)
	}
	if err != nil {
		return Case{}, err
	}
	c := Case{ID: newID(), VersionID: versionID, IsTest: isTest}
	var lastErr error
	for attempt := 0; attempt <= 3; attempt++ {
		err := s.db.QueryRow(ctx, `
			INSERT INTO cases (id, version_id, reference, is_test)
			SELECT $1, $2,
				'CASE-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-'
					|| lpad((COUNT(*) + 1)::text, 4, '0'),
				$3
			FROM cases
			WHERE reference LIKE 'CASE-'
				|| to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-%'
			RETURNING reference, created_at`,
			c.ID, c.VersionID, c.IsTest).Scan(&c.Reference, &c.CreatedAt)
		if err == nil {
			return c, nil
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			return Case{}, err
		}
		lastErr = err
	}
	return Case{}, fmt.Errorf("case reference: %w", lastErr)
}

// GetCase returns one case, or the row-absent error.
func (s *Store) GetCase(ctx context.Context, id string) (Case, error) {
	if !isUUID(id) {
		return Case{}, notExist("case", id)
	}
	var c Case
	err := s.db.QueryRow(ctx, `
		SELECT id, version_id, reference, is_test, created_at
		FROM cases WHERE id = $1`, id).
		Scan(&c.ID, &c.VersionID, &c.Reference, &c.IsTest, &c.CreatedAt)
	if isAbsent(err) {
		return Case{}, notExist("case", id)
	}
	return c, err
}

// ListCases returns all cases, created_at first, then id.
func (s *Store) ListCases(ctx context.Context) ([]Case, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, version_id, reference, is_test, created_at
		FROM cases ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cases []Case
	for rows.Next() {
		var c Case
		if err := rows.Scan(&c.ID, &c.VersionID, &c.Reference, &c.IsTest, &c.CreatedAt); err != nil {
			return nil, err
		}
		cases = append(cases, c)
	}
	return cases, rows.Err()
}

// AppendEvents appends the events of one case to the log, in one
// transaction. It refuses an empty slice, a foreign case id and a
// seq gap. An insert error gives append event <seq>: <err>.
func (s *Store) AppendEvents(ctx context.Context, caseID string, events []engine.Event) error {
	if len(events) == 0 {
		return errors.New("no events")
	}
	if !isUUID(caseID) {
		return notExist("case", caseID)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var exists bool
	err = tx.QueryRow(ctx,
		`SELECT true FROM cases WHERE id = $1`, caseID).Scan(&exists)
	if isAbsent(err) {
		return notExist("case", caseID)
	}
	if err != nil {
		return err
	}

	var max int
	err = tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(seq), 0) FROM events WHERE case_id = $1`, caseID).
		Scan(&max)
	if err != nil {
		return err
	}
	for _, e := range events {
		if e.CaseID != caseID {
			return fmt.Errorf("event %d: case id %s does not match", e.Seq, e.CaseID)
		}
	}
	if events[0].Seq != max+1 {
		return fmt.Errorf("append: first seq %d must be %d", events[0].Seq, max+1)
	}

	for _, e := range events {
		_, err := tx.Exec(ctx, `
			INSERT INTO events (case_id, seq, type, at, actor, payload, prev_hash, hash)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			e.CaseID, e.Seq, e.Type, e.At, e.Actor, e.Payload, e.PrevHash, e.Hash)
		if err != nil {
			return fmt.Errorf("append event %d: %w", e.Seq, err)
		}
	}
	return tx.Commit(ctx)
}

// ListEvents returns the events of the case in seq order. The
// payload bytes survive the round trip, and each time comes back in
// UTC.
func (s *Store) ListEvents(ctx context.Context, caseID string) ([]engine.Event, error) {
	if !isUUID(caseID) {
		return nil, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT case_id, seq, type, at, actor, payload, prev_hash, hash
		FROM events WHERE case_id = $1 ORDER BY seq`, caseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []engine.Event
	for rows.Next() {
		var e engine.Event
		if err := rows.Scan(&e.CaseID, &e.Seq, &e.Type, &e.At, &e.Actor,
			&e.Payload, &e.PrevHash, &e.Hash); err != nil {
			return nil, err
		}
		e.At = e.At.UTC()
		events = append(events, e)
	}
	return events, rows.Err()
}

// EventRow is one event with the reference of its case.
type EventRow struct {
	engine.Event
	Reference string `json:"reference"`
}

// ListRecentEvents returns the newest events of every case, ordered by
// at DESC then seq DESC, at most limit, with the case reference.
func (s *Store) ListRecentEvents(ctx context.Context, limit int) ([]EventRow, error) {
	rows, err := s.db.Query(ctx, `
		SELECT e.case_id, e.seq, e.type, e.at, e.actor, e.payload,
		       e.prev_hash, e.hash, c.reference
		FROM events e JOIN cases c ON e.case_id = c.id
		ORDER BY e.at DESC, e.seq DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var recent []EventRow
	for rows.Next() {
		var r EventRow
		if err := rows.Scan(&r.CaseID, &r.Seq, &r.Type, &r.At, &r.Actor,
			&r.Payload, &r.PrevHash, &r.Hash, &r.Reference); err != nil {
			return nil, err
		}
		r.At = r.At.UTC()
		recent = append(recent, r)
	}
	return recent, rows.Err()
}

// CountEvents returns the count of all events of all cases.
func (s *Store) CountEvents(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM events`).Scan(&n)
	return n, err
}

// Document is one stored scan: the bytes and the hash they had at
// the upload.
type Document struct {
	ID        string
	CaseID    *string
	Name      string
	MIME      string
	SHA256    string
	Bytes     []byte
	CreatedAt time.Time
}

// SaveDocument stores one scan with the hash it receives.
func (s *Store) SaveDocument(ctx context.Context, caseID *string, name, mime, sha string, data []byte) (Document, error) {
	d := Document{ID: newID(), CaseID: caseID, Name: name, MIME: mime,
		SHA256: sha, Bytes: data}
	err := s.db.QueryRow(ctx, `
		INSERT INTO documents (id, case_id, name, mime, sha256, bytes)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING created_at`,
		d.ID, d.CaseID, d.Name, d.MIME, d.SHA256, d.Bytes).
		Scan(&d.CreatedAt)
	return d, err
}

// GetDocument returns the metadata of one scan, without the bytes.
func (s *Store) GetDocument(ctx context.Context, id string) (Document, error) {
	if !isUUID(id) {
		return Document{}, notExist("document", id)
	}
	var d Document
	err := s.db.QueryRow(ctx, `
		SELECT id, case_id, name, mime, sha256, created_at
		FROM documents WHERE id = $1`, id).
		Scan(&d.ID, &d.CaseID, &d.Name, &d.MIME, &d.SHA256, &d.CreatedAt)
	if isAbsent(err) {
		return Document{}, notExist("document", id)
	}
	return d, err
}

// DocumentBytes returns the bytes of one scan.
func (s *Store) DocumentBytes(ctx context.Context, id string) ([]byte, error) {
	if !isUUID(id) {
		return nil, notExist("document", id)
	}
	var data []byte
	err := s.db.QueryRow(ctx,
		`SELECT bytes FROM documents WHERE id = $1`, id).Scan(&data)
	if isAbsent(err) {
		return nil, notExist("document", id)
	}
	return data, err
}

// ListCaseDocuments returns the scans of one case, metadata only,
// newest first: created_at DESC, then id DESC. A non-uuid case id
// gives an empty list: the route validates the case first.
func (s *Store) ListCaseDocuments(ctx context.Context, caseID string) ([]Document, error) {
	docs := []Document{}
	if !isUUID(caseID) {
		return docs, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, case_id, name, mime, sha256, created_at
		FROM documents WHERE case_id = $1
		ORDER BY created_at DESC, id DESC`, caseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var d Document
		if err := rows.Scan(&d.ID, &d.CaseID, &d.Name, &d.MIME, &d.SHA256,
			&d.CreatedAt); err != nil {
			return nil, err
		}
		docs = append(docs, d)
	}
	return docs, rows.Err()
}
