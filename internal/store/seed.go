package store

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
)

//go:embed seed/example-process.json
var seedProcess []byte

//go:embed seed/home-loan-policy.pdf
var seedPolicy []byte

// Seed inserts the demo users, the example process with version 1
// published, and its policy PDF. It changes nothing when the rows
// are already there.
func Seed(ctx context.Context, s *Store) error {
	seedUsers := []User{
		{ID: "u-advisor", Name: "Demo Advisor", RoleIDs: []string{"advisor"}},
		{ID: "u-analyst", Name: "Demo Analyst", RoleIDs: []string{"analyst"}},
		{ID: "u-director", Name: "Demo Director", RoleIDs: []string{"director"}},
		{ID: "u-legal", Name: "Demo Legal Officer", RoleIDs: []string{"legal"}},
		{ID: "u-backoffice", Name: "Demo Back-office", RoleIDs: []string{"backoffice"}},
	}
	for _, u := range seedUsers {
		if _, err := s.db.Exec(ctx, `
			INSERT INTO users (id, name, role_ids) VALUES ($1, $2, $3)
			ON CONFLICT (id) DO NOTHING`, u.ID, u.Name, u.RoleIDs); err != nil {
			return err
		}
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO processes (id, name) VALUES ($1, $2)
		ON CONFLICT (id) DO NOTHING`,
		"00000000-0000-0000-0000-000000000001", "Home loan"); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO versions (id, process_id, parent_id, number, label, status, definition, frozen_at)
		VALUES ($1, $2, NULL, 1, $3, $4, $5, now())
		ON CONFLICT (id) DO NOTHING`,
		"00000000-0000-0000-0000-000000000002",
		"00000000-0000-0000-0000-000000000001",
		"Initial", StatusPublished, seedProcess); err != nil {
		return err
	}
	// DO NOTHING keeps a policy that the user uploaded.
	sum := sha256.Sum256(seedPolicy)
	_, err := s.db.Exec(ctx, `
		INSERT INTO policy_files (process_id, file_name, mime, bytes, sha256)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (process_id) DO NOTHING`,
		"00000000-0000-0000-0000-000000000001", "home-loan-policy.pdf",
		"application/pdf", seedPolicy, hex.EncodeToString(sum[:]))
	return err
}
