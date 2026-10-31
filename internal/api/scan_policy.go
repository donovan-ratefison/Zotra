package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/donovan-ratefison/zotra/internal/ai"
)

const (
	maxScanPages     = 10
	maxScanPageBytes = 3 << 20
	maxScanBodyBytes = 44 << 20
	scanPagePrefix   = "data:image/png;base64,"
	msgInvalidPages  = "pages must hold 1 to 10 PNG data URLs of 3 MiB or less"
)

// policyScanSchema is the strict JSON Schema of the scan reading.
var policyScanSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"paragraphs": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"page": map[string]any{"type": "integer"},
					"text": map[string]any{"type": "string"},
				},
				"required":             []string{"page", "text"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"paragraphs"},
	"additionalProperties": false,
}

// readPolicyScan sends the page images of a scanned policy to the text
// model and answers the paragraphs with ids p<page>-<n>. Nothing is
// stored.
func (d apiDeps) readPolicyScan(w http.ResponseWriter, r *http.Request) {
	// 1. The body.
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxScanBodyBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large",
				"the scan must stay under 44 MiB")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	var body struct {
		Pages []string `json:"pages"`
	}
	if json.Unmarshal(raw, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	// 2. The pages.
	if len(body.Pages) == 0 || len(body.Pages) > maxScanPages {
		writeError(w, http.StatusBadRequest, "invalid_pages", msgInvalidPages)
		return
	}
	pages := make([][]byte, 0, len(body.Pages))
	for _, p := range body.Pages {
		data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(p, scanPagePrefix))
		if !strings.HasPrefix(p, scanPagePrefix) || err != nil ||
			!bytes.HasPrefix(data, pngMagic) || len(data) > maxScanPageBytes {
			writeError(w, http.StatusBadRequest, "invalid_pages", msgInvalidPages)
			return
		}
		pages = append(pages, data)
	}
	// 3. The AI call.
	cfg := ai.LoadConfig()
	payload := ai.VisionPagesPayload(cfg.TextModel, ai.ReadPolicyScanPrompt,
		"image/png", pages, "policy_scan", policyScanSchema)
	ansBody, err := d.ai.PostChat(r.Context(), payload)
	if err != nil {
		writeAIError(w, err)
		return
	}
	var answer struct {
		Paragraphs []struct {
			Page int    `json:"page"`
			Text string `json:"text"`
		} `json:"paragraphs"`
	}
	content, ok := answerContent(ansBody)
	if ok {
		ok = json.Unmarshal([]byte(content), &answer) == nil
	}
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "invalid_output", msgNoContent)
		return
	}
	// 4. The item checks, then the page order and the ids.
	type item struct {
		page int
		text string
	}
	var kept []item
	for _, p := range answer.Paragraphs {
		text := strings.TrimSpace(p.Text)
		n := utf8.RuneCountInString(text)
		if p.Page >= 1 && p.Page <= len(pages) && n >= 1 && n <= 5000 {
			kept = append(kept, item{p.Page, text})
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].page < kept[j].page })
	if len(kept) > 500 {
		kept = kept[:500]
	}
	if len(kept) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "no_text",
			"The AI found no text on these pages.")
		return
	}
	out := make([]paragraphIn, 0, len(kept))
	perPage := map[int]int{}
	for _, k := range kept {
		perPage[k.page]++
		out = append(out, paragraphIn{ID: fmt.Sprintf("p%d-%d", k.page, perPage[k.page]), Text: k.text})
	}
	writeJSON(w, http.StatusOK, struct {
		Paragraphs []paragraphIn `json:"paragraphs"`
		Dropped    int           `json:"dropped"`
	}{out, len(answer.Paragraphs) - len(out)})
}
