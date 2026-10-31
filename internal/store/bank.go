package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Bank is the bank profile of the delivered app (one row).
type Bank struct {
	Name, PrimaryColor, AccentColor string
	Logo                            []byte // nil: no logo
	LogoMIME                        string // "" when Logo is nil
	UpdatedAt                       time.Time
}

// bankColumns is the column list that scanBank reads. pgx does not
// scan NULL into a string, so logo_mime goes through COALESCE.
const bankColumns = `name, primary_color, accent_color, logo,
	COALESCE(logo_mime, ''), updated_at`

func scanBank(row pgx.Row) (Bank, error) {
	var b Bank
	err := row.Scan(&b.Name, &b.PrimaryColor, &b.AccentColor, &b.Logo,
		&b.LogoMIME, &b.UpdatedAt)
	return b, err
}

// Bank returns the bank profile. The table has exactly one row.
func (s *Store) Bank(ctx context.Context) (Bank, error) {
	return scanBank(s.db.QueryRow(ctx, `SELECT `+bankColumns+` FROM bank_settings`))
}

// UpdateBank sets the name and the colors. It keeps the logo. The
// handler validates the values first.
func (s *Store) UpdateBank(ctx context.Context, name, primary, accent string) (Bank, error) {
	return scanBank(s.db.QueryRow(ctx, `
		UPDATE bank_settings SET name = $1, primary_color = $2,
			accent_color = $3, updated_at = now()
		RETURNING `+bankColumns, name, primary, accent))
}

// SaveBankLogo replaces the logo. It keeps the name and the colors.
// The handler checks the bytes first.
func (s *Store) SaveBankLogo(ctx context.Context, mime string, data []byte) (Bank, error) {
	return scanBank(s.db.QueryRow(ctx, `
		UPDATE bank_settings SET logo = $2, logo_mime = $1, updated_at = now()
		RETURNING `+bankColumns, mime, data))
}
