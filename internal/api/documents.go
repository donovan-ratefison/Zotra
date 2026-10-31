package api

// The document routes: upload, metadata, bytes, case list, zones.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/readfields"
	"github.com/donovan-ratefison/zotra/internal/sam"
	"github.com/donovan-ratefison/zotra/internal/store"
)

const (
	// scanPngMagic and scanJpegMagic are the magic byte prefixes of the
	// accepted scans. The jpeg prefix is three bytes, so a JPEG with
	// an EXIF header (ff d8 ff e1) passes too.
	scanPngMagic  = "\x89PNG\r\n\x1a\n"
	scanJpegMagic = "\xff\xd8\xff"

	// maxScanBytes is the size limit of one scan: 10 MiB.
	maxScanBytes = 10 << 20
)

// documentDTO is the JSON shape of one document. It never holds the
// bytes.
type documentDTO struct {
	ID        string    `json:"id"`
	CaseID    *string   `json:"case_id"`
	Name      string    `json:"name"`
	MIME      string    `json:"mime"`
	SHA256    string    `json:"sha256"`
	CreatedAt time.Time `json:"created_at"`
}

func toDocumentDTO(d store.Document) documentDTO {
	return documentDTO{
		ID:        d.ID,
		CaseID:    d.CaseID,
		Name:      d.Name,
		MIME:      d.MIME,
		SHA256:    d.SHA256,
		CreatedAt: d.CreatedAt,
	}
}

// scanMime names the mime of one scan from the magic bytes of its
// content, never from the part header. An empty result means the
// bytes are not a PNG or a JPEG scan.
func scanMime(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte(scanPngMagic)):
		return "image/png"
	case bytes.HasPrefix(data, []byte(scanJpegMagic)):
		return "image/jpeg"
	}
	return ""
}

// uploadDocument stores one scan of one case. The handler loads the
// case first: SaveDocument does no case check.
func (d apiDeps) uploadDocument(w http.ResponseWriter, r *http.Request) {
	caseID := r.PathValue("id")
	if _, err := d.st.GetCase(r.Context(), caseID); err != nil {
		writeStoreError(w, err)
		return
	}
	// The cap stops a large body before it reaches the disk. One MiB
	// above the scan limit leaves room for the form envelope.
	r.Body = http.MaxBytesReader(w, r.Body, maxScanBytes+1<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusBadRequest, "invalid_upload",
				"the scan must stay under 10 MiB")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_upload",
			"the body must be a multipart form")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_upload",
			"the file field is required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_upload",
			"the body must be a multipart form")
		return
	}
	if len(data) > maxScanBytes {
		writeError(w, http.StatusBadRequest, "invalid_upload",
			"the scan must stay under 10 MiB")
		return
	}
	mime := scanMime(data)
	if mime == "" {
		writeError(w, http.StatusBadRequest, "invalid_upload",
			"only PNG and JPEG scans are accepted")
		return
	}
	sum := sha256.Sum256(data)
	doc, err := d.st.SaveDocument(r.Context(), &caseID, header.Filename,
		mime, hex.EncodeToString(sum[:]), data)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, struct {
		Document documentDTO `json:"document"`
	}{toDocumentDTO(doc)})
}

// readDocument returns the metadata of one scan.
func (d apiDeps) readDocument(w http.ResponseWriter, r *http.Request) {
	doc, err := d.st.GetDocument(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Document documentDTO `json:"document"`
	}{toDocumentDTO(doc)})
}

// readDocumentBytes returns the raw bytes of one scan, with the
// stored mime as Content-Type.
func (d apiDeps) readDocumentBytes(w http.ResponseWriter, r *http.Request) {
	doc, err := d.st.GetDocument(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	data, err := d.st.DocumentBytes(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.Header().Set("Content-Type", doc.MIME)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// listCaseDocuments returns the metadata of the scans of one case,
// newest first. The handler loads the case first.
func (d apiDeps) listCaseDocuments(w http.ResponseWriter, r *http.Request) {
	if _, err := d.st.GetCase(r.Context(), r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	docs, err := d.st.ListCaseDocuments(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	dtos := make([]documentDTO, 0, len(docs))
	for _, doc := range docs {
		dtos = append(dtos, toDocumentDTO(doc))
	}
	writeJSON(w, http.StatusOK, struct {
		Documents []documentDTO `json:"documents"`
	}{dtos})
}

// documentRead reads the fields of one scan with the text model. The
// body names the fields, the schema asks one null-able property per
// field, and the answer carries the values by field name. The AI flow
// goes through the Chat Completions API, so the cache holds it as one
// block.
func (d apiDeps) documentRead(w http.ResponseWriter, r *http.Request) {
	// 1. The body.
	var body struct {
		Fields []readfields.Field `json:"fields"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	// 2. The field list.
	fields := body.Fields
	if len(fields) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_read",
			"at least one field is required")
		return
	}
	seen := map[string]bool{}
	for i, f := range fields {
		if f.Name == "" {
			writeError(w, http.StatusBadRequest, "invalid_read",
				fmt.Sprintf("field %d has no name", i))
			return
		}
		if seen[f.Name] {
			writeError(w, http.StatusBadRequest, "invalid_read",
				fmt.Sprintf("duplicate field %s", f.Name))
			return
		}
		seen[f.Name] = true
	}
	// 3. The document and its bytes.
	id := r.PathValue("id")
	doc, err := d.st.GetDocument(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	data, err := d.st.DocumentBytes(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// 4. The AI call.
	cfg := ai.LoadConfig()
	payload := ai.VisionPayload(cfg.ReadModel, ai.ReadFieldsPrompt,
		doc.MIME, data, "read_fields", readfields.SchemaFor(fields))
	aiBody, err := ai.New(cfg.Document()).PostChat(r.Context(), payload)
	if err != nil {
		writeAIError(w, err)
		return
	}
	values, err := readfields.ParseValues(aiBody, fields)
	if err != nil {
		writeError(w, http.StatusBadGateway, "bad_ai_output", err.Error())
		return
	}
	// 5. The answer.
	writeJSON(w, http.StatusOK, struct {
		Values map[string]any `json:"values"`
	}{values})
}

// documentZones asks SAM 3.1 for the zones of one scan. It sends one
// Responses request for each noun phrase of sam.Phrases, so the cache
// holds each request under its own key. The requests run at the same
// time. The zones join in the order of sam.Phrases, and the first
// error in that order gives the answer.
func (d apiDeps) documentZones(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	doc, err := d.st.GetDocument(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	data, err := d.st.DocumentBytes(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	cfg := ai.LoadConfig()
	client := ai.New(cfg.Document())
	bodies := make([][]byte, len(sam.Phrases))
	errs := make([]error, len(sam.Phrases))
	var wg sync.WaitGroup
	for i, p := range sam.Phrases {
		wg.Go(func() {
			payload := sam.Request(cfg.SAMModel, p.Text, doc.MIME, data)
			bodies[i], errs[i] = client.Responses(r.Context(), payload)
		})
	}
	wg.Wait()
	zones := []sam.Zone{}
	for i, p := range sam.Phrases {
		if errs[i] != nil {
			writeAIError(w, errs[i])
			return
		}
		found, err := sam.ParseZones(bodies[i], p.Label)
		if err != nil {
			writeError(w, http.StatusBadGateway, "bad_ai_output", err.Error())
			return
		}
		zones = append(zones, found...)
	}
	writeJSON(w, http.StatusOK, struct {
		Zones []sam.Zone `json:"zones"`
	}{zones})
}
