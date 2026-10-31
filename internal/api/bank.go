package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/donovan-ratefison/zotra/internal/store"
)

const (
	// maxLogoBytes is the size limit of the bank logo: 1 MiB.
	maxLogoBytes = 1 << 20
	// maxBankBodyBytes is the size limit of the JSON body of putBank.
	maxBankBodyBytes = 1 << 16
)

var (
	svgEvent = regexp.MustCompile(`(?i)[\s/]on[a-z]+\s*=`)
	hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

// bankDTO is the JSON shape of the bank profile. It never holds the
// logo bytes.
type bankDTO struct {
	Name         string    `json:"name"`
	PrimaryColor string    `json:"primary_color"`
	AccentColor  string    `json:"accent_color"`
	LogoURL      *string   `json:"logo_url"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// writeBank answers 200 {"bank": {...}}. The logo URL carries
// updated_at as a cache key.
func writeBank(w http.ResponseWriter, b store.Bank) {
	dto := bankDTO{Name: b.Name, PrimaryColor: b.PrimaryColor,
		AccentColor: b.AccentColor, UpdatedAt: b.UpdatedAt}
	if b.Logo != nil {
		u := "/api/settings/bank/logo?v=" + strconv.FormatInt(b.UpdatedAt.UnixMilli(), 10)
		dto.LogoURL = &u
	}
	writeJSON(w, http.StatusOK, map[string]any{"bank": dto})
}

// logoMIME detects a PNG or SVG logo from its first bytes. The SVG
// check is a filter only: the CSP header of getBankLogo is the guard.
func logoMIME(data []byte) (mime, problem string) {
	if bytes.HasPrefix(data, pngMagic) {
		return "image/png", ""
	}
	head := bytes.TrimLeft(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")), " \t\r\n")
	lower := bytes.ToLower(data)
	if (bytes.HasPrefix(head, []byte("<?xml")) || bytes.HasPrefix(head, []byte("<svg"))) &&
		bytes.Contains(lower, []byte("<svg")) {
		if bytes.Contains(lower, []byte("<script")) || bytes.Contains(lower, []byte("<!entity")) ||
			bytes.Contains(lower, []byte("javascript:")) || svgEvent.Match(data) {
			return "", "the SVG logo holds a script"
		}
		return "image/svg+xml", ""
	}
	return "", "the logo is not a PNG or SVG file"
}

// getBank answers the bank profile.
func (d apiDeps) getBank(w http.ResponseWriter, r *http.Request) {
	b, err := d.st.Bank(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeBank(w, b)
}

// putBank sets the name and the colors. Unknown fields are ignored, so
// a client can send the full profile back.
func (d apiDeps) putBank(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string `json:"name"`
		PrimaryColor string `json:"primary_color"`
		AccentColor  string `json:"accent_color"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBankBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_bank", "cannot read the body")
		return
	}
	name := strings.TrimSpace(body.Name)
	if n := utf8.RuneCountInString(name); n == 0 || n > 80 {
		writeError(w, http.StatusBadRequest, "invalid_bank", "the name must have 1 to 80 characters")
		return
	}
	if !hexColor.MatchString(body.PrimaryColor) {
		writeError(w, http.StatusBadRequest, "invalid_bank", "primary_color must have the form #rrggbb")
		return
	}
	if !hexColor.MatchString(body.AccentColor) {
		writeError(w, http.StatusBadRequest, "invalid_bank", "accent_color must have the form #rrggbb")
		return
	}
	b, err := d.st.UpdateBank(r.Context(), name,
		strings.ToLower(body.PrimaryColor), strings.ToLower(body.AccentColor))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeBank(w, b)
}

// putBankLogo stores the logo. The body is the raw PNG or SVG file.
// The Content-Type header is ignored: the first bytes decide.
func (d apiDeps) putBankLogo(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxLogoBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large",
				"the logo must stay under 1 MiB")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_logo", "cannot read the body")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_logo", "the body is empty")
		return
	}
	mime, problem := logoMIME(data)
	if problem != "" {
		writeError(w, http.StatusBadRequest, "invalid_logo", problem)
		return
	}
	b, err := d.st.SaveBankLogo(r.Context(), mime, data)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeBank(w, b)
}

// getBankLogo returns the raw logo bytes. The CSP header stops any
// script when an SVG logo opens as a page.
func (d apiDeps) getBankLogo(w http.ResponseWriter, r *http.Request) {
	b, err := d.st.Bank(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if b.Logo == nil {
		writeError(w, http.StatusNotFound, "not_found", "no logo")
		return
	}
	h := w.Header()
	h.Set("Content-Type", b.LogoMIME)
	h.Set("Content-Length", strconv.Itoa(len(b.Logo)))
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	_, _ = w.Write(b.Logo)
}
