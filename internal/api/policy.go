package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	// maxPolicyBytes is the size limit of one policy PDF: 20 MiB.
	maxPolicyBytes = 20 << 20
	// maxPolicyNameBytes is the size limit of the stored file name.
	maxPolicyNameBytes = 200
)

// policyDTO is the JSON shape of one policy file. It never holds the
// bytes.
type policyDTO struct {
	ProcessID string    `json:"process_id"`
	FileName  string    `json:"file_name"`
	MIME      string    `json:"mime"`
	SHA256    string    `json:"sha256"`
	Size      int       `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

// putPolicy stores the policy PDF of one process. The body is the raw
// PDF. The header X-File-Name holds the URL-encoded file name.
func (d apiDeps) putPolicy(w http.ResponseWriter, r *http.Request) {
	processID := r.PathValue("id")
	if _, err := d.st.ProcessByID(r.Context(), processID); err != nil {
		writeStoreError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPolicyBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large",
				"the policy file must stay under 20 MiB")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_policy", "cannot read the body")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_policy", "the body is empty")
		return
	}
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		writeError(w, http.StatusBadRequest, "invalid_policy", "the file is not a PDF")
		return
	}
	sum := sha256.Sum256(data)
	f, err := d.st.SavePolicyFile(r.Context(), processID,
		policyFileName(r.Header.Get("X-File-Name")), hex.EncodeToString(sum[:]), data)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Policy policyDTO `json:"policy"`
	}{policyDTO{
		ProcessID: f.ProcessID,
		FileName:  f.FileName,
		MIME:      f.MIME,
		SHA256:    f.SHA256,
		Size:      len(f.Bytes),
		CreatedAt: f.CreatedAt,
	}})
}

// policyFileName decodes the X-File-Name header. A decode error keeps
// the raw value. Bytes that are not valid UTF-8 are dropped. An empty
// name gives policy.pdf. The name is cut to
// 200 bytes at a rune boundary.
func policyFileName(header string) string {
	name := header
	if decoded, err := url.PathUnescape(header); err == nil {
		name = decoded
	}
	// The database refuses text that is not valid UTF-8.
	name = strings.TrimSpace(strings.ToValidUTF8(name, ""))
	if name == "" {
		return "policy.pdf"
	}
	if len(name) > maxPolicyNameBytes {
		cut := maxPolicyNameBytes
		for cut > 0 && !utf8.RuneStart(name[cut]) {
			cut--
		}
		name = name[:cut]
	}
	return name
}

// getPolicy returns the raw bytes of the policy PDF of one process.
func (d apiDeps) getPolicy(w http.ResponseWriter, r *http.Request) {
	f, err := d.st.GetPolicyFile(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", f.MIME)
	h.Set("Content-Length", strconv.Itoa(len(f.Bytes)))
	h.Set("X-File-Name", url.PathEscape(f.FileName))
	h.Set("Cache-Control", "no-store")
	_, _ = w.Write(f.Bytes)
}
