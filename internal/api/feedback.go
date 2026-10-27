package api

// The feedback store of plan.md section 8. It saves each remark of
// Donovan as one JSON file in ZOTRA_FEEDBACK_DIR, with an optional PNG.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// FeedbackItem is one remark of Donovan, stored as one JSON file.
// Contract: local/plan.md section 8.
type FeedbackItem struct {
	ID          string            `json:"id"`
	Status      string            `json:"status"`
	Kind        string            `json:"kind"`
	Text        string            `json:"text"`
	URL         string            `json:"url"`
	Selector    *string           `json:"selector"`
	ElementText *string           `json:"element_text"`
	Box         *FeedbackBox      `json:"box"`
	Viewport    FeedbackViewport  `json:"viewport"`
	Image       *string           `json:"image"`
	Commit      string            `json:"commit"`
	CreatedAt   string            `json:"created_at"`
	Lot         *string           `json:"lot"`
	Understood  *string           `json:"understood"`
	Fix         []string          `json:"fix"`
	FixedCommit *string           `json:"fixed_commit"`
	History     []FeedbackHistory `json:"history"`
}

type FeedbackBox struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type FeedbackViewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type FeedbackHistory struct {
	At     string   `json:"at"`
	Status string   `json:"status"`
	By     string   `json:"by"`
	Note   string   `json:"note"`
	Fix    []string `json:"fix"`
}

const (
	StatusOpen     = "open"
	StatusInLot    = "in_lot"
	StatusFixed    = "fixed"
	StatusVerified = "verified"
	StatusQuestion = "question"

	feedbackKindBug      = "bug"
	feedbackKindAdjust   = "adjust"
	feedbackKindQuestion = "question"

	feedbackMaxText       = 2000
	feedbackMaxNote       = 2000
	feedbackMaxElementRun = 80
	feedbackMaxImageBytes = 5 * 1024 * 1024
)

var (
	pngMagic    = []byte("\x89PNG\r\n\x1a\n")
	errNoIDLeft = errors.New("all feedback ids are used")
)

const feedbackImageDataPrefix = "data:image/png;base64,"

type feedbackStore struct {
	mu      sync.Mutex
	dir     string
	version string
}

func newFeedbackStore(dir, version string) *feedbackStore {
	return &feedbackStore{dir: dir, version: version}
}

// mount registers the five feedback routes on the mux. A wrong method
// hits no pattern: the /api/ fallback of NewHandler answers 404.
func (s *feedbackStore) mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/dev/feedback", s.handleList)
	mux.HandleFunc("POST /api/dev/feedback", s.handleCreate)
	mux.HandleFunc("GET /api/dev/feedback/{id}/image", s.handleImage)
	mux.HandleFunc("POST /api/dev/feedback/{id}/verify", s.handleVerify)
	mux.HandleFunc("POST /api/dev/feedback/{id}/reopen", s.handleReopen)
}

func (s *feedbackStore) handleList(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	items := []FeedbackItem{}
	entries, err := os.ReadDir(s.dir)
	if err == nil {
		for _, e := range entries {
			name := e.Name()
			if !strings.HasSuffix(name, ".json") {
				continue
			}
			b, err := os.ReadFile(filepath.Join(s.dir, name))
			if err != nil {
				continue
			}
			var item FeedbackItem
			if json.Unmarshal(b, &item) != nil {
				continue
			}
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID > items[j].ID })
	writeItemJSON(w, http.StatusOK, items)
}

type feedbackCreateBody struct {
	Kind        string           `json:"kind"`
	Text        string           `json:"text"`
	URL         string           `json:"url"`
	Selector    *string          `json:"selector"`
	ElementText *string          `json:"element_text"`
	Box         *FeedbackBox     `json:"box"`
	Viewport    FeedbackViewport `json:"viewport"`
	ImageData   *string          `json:"image_data"`
}

func (s *feedbackStore) handleCreate(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var body feedbackCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "the body is not a JSON object")
		return
	}
	if body.Kind != feedbackKindBug && body.Kind != feedbackKindAdjust && body.Kind != feedbackKindQuestion {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind must be bug, adjust or question")
		return
	}
	if n := utf8.RuneCountInString(body.Text); n < 1 || n > feedbackMaxText {
		writeError(w, http.StatusBadRequest, "invalid_text", "text must hold 1 to 2000 characters")
		return
	}
	if !strings.HasPrefix(body.URL, "/") {
		writeError(w, http.StatusBadRequest, "invalid_url", "url must start with a slash")
		return
	}
	image, ok := decodeImageData(body.ImageData)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_image", "image must be a PNG under 5 MB")
		return
	}
	body.ElementText = cutElementText(body.ElementText)

	id, err := s.nextID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "no_id_left", err.Error())
		return
	}
	status := StatusOpen
	if body.Kind == feedbackKindQuestion {
		status = StatusQuestion
	}
	now := time.Now().UTC().Format(time.RFC3339)
	item := FeedbackItem{
		ID:          id,
		Status:      status,
		Kind:        body.Kind,
		Text:        body.Text,
		URL:         body.URL,
		Selector:    body.Selector,
		ElementText: body.ElementText,
		Box:         body.Box,
		Viewport:    body.Viewport,
		Commit:      s.version,
		CreatedAt:   now,
		Fix:         []string{},
		History: []FeedbackHistory{{
			At:     now,
			Status: status,
			By:     "donovan",
			Fix:    []string{},
		}},
	}
	if image != nil {
		name := id + ".png"
		item.Image = &name
	}

	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "cannot save the feedback item")
		return
	}
	if image != nil {
		if err := s.writeFile(id+".png", image); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "cannot save the feedback item")
			return
		}
	}
	if err := s.saveItem(&item); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "cannot save the feedback item")
		return
	}
	writeItemJSON(w, http.StatusCreated, item)
}

func (s *feedbackStore) handleImage(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := r.PathValue("id")
	item, ok := s.readItem(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", fmt.Sprintf("no feedback item %s", id))
		return
	}
	if item.Image == nil {
		writeError(w, http.StatusNotFound, "not_found", fmt.Sprintf("item %s has no image", id))
		return
	}
	data, err := os.ReadFile(filepath.Join(s.dir, *item.Image))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", fmt.Sprintf("image file of %s is missing", id))
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *feedbackStore) handleVerify(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := r.PathValue("id")
	item, ok := s.readItem(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", fmt.Sprintf("no feedback item %s", id))
		return
	}
	if item.Status != StatusFixed {
		writeError(w, http.StatusConflict, "wrong_status", "only a fixed item can be verified")
		return
	}
	item.Status = StatusVerified
	item.History = append(item.History, FeedbackHistory{
		At:     time.Now().UTC().Format(time.RFC3339),
		Status: StatusVerified,
		By:     "donovan",
		Fix:    []string{},
	})
	if err := s.saveItem(item); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "cannot save the feedback item")
		return
	}
	writeItemJSON(w, http.StatusOK, item)
}

type feedbackReopenBody struct {
	Note string `json:"note"`
}

func (s *feedbackStore) handleReopen(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var body feedbackReopenBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "the body is not a JSON object")
		return
	}
	if n := utf8.RuneCountInString(body.Note); n < 1 || n > feedbackMaxNote {
		writeError(w, http.StatusBadRequest, "invalid_note", "note must hold 1 to 2000 characters")
		return
	}
	id := r.PathValue("id")
	item, ok := s.readItem(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", fmt.Sprintf("no feedback item %s", id))
		return
	}
	if item.Status != StatusFixed && item.Status != StatusVerified {
		writeError(w, http.StatusConflict, "wrong_status", "only a fixed or verified item can be reopened")
		return
	}
	previousFix := item.Fix
	item.Status = StatusOpen
	item.Lot = nil
	item.Understood = nil
	item.FixedCommit = nil
	item.Fix = []string{}
	item.History = append(item.History, FeedbackHistory{
		At:     time.Now().UTC().Format(time.RFC3339),
		Status: StatusOpen,
		By:     "donovan",
		Note:   body.Note,
		Fix:    previousFix,
	})
	if err := s.saveItem(item); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "cannot save the feedback item")
		return
	}
	writeItemJSON(w, http.StatusOK, item)
}

// nextID gives the highest 4-digit id plus one. It runs under the
// store mutex.
func (s *feedbackStore) nextID() (string, error) {
	highest := 0
	entries, err := os.ReadDir(s.dir)
	if err == nil {
		for _, e := range entries {
			name := strings.TrimSuffix(e.Name(), ".json")
			if name == e.Name() || !feedbackFourDigits(name) {
				continue
			}
			n := int(name[0]-'0')*1000 + int(name[1]-'0')*100 + int(name[2]-'0')*10 + int(name[3]-'0')
			if n > highest {
				highest = n
			}
		}
	}
	if highest >= 9999 {
		return "", errNoIDLeft
	}
	return fmt.Sprintf("%04d", highest+1), nil
}

func feedbackFourDigits(s string) bool {
	if len(s) != 4 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// readItem reads and unmarshals <dir>/<id>.json. A missing or
// unparsable file gives false.
func (s *feedbackStore) readItem(id string) (*FeedbackItem, bool) {
	b, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
	if err != nil {
		return nil, false
	}
	var item FeedbackItem
	if json.Unmarshal(b, &item) != nil {
		return nil, false
	}
	return &item, true
}

// saveItem marshals the item with a 2-space indent and writes it
// through writeFile.
func (s *feedbackStore) saveItem(item *FeedbackItem) error {
	b, err := json.MarshalIndent(item, "", "  ")
	if err != nil {
		return err
	}
	return s.writeFile(item.ID+".json", b)
}

// writeFile writes to a temporary file in the store directory, then
// renames it to the final name.
func (s *feedbackStore) writeFile(name string, data []byte) error {
	f, err := os.CreateTemp(s.dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, filepath.Join(s.dir, name)); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// decodeImageData checks the image_data field. nil gives no image. A
// string must be a PNG data URL under feedbackMaxImageBytes.
func decodeImageData(v *string) ([]byte, bool) {
	if v == nil {
		return nil, true
	}
	if !strings.HasPrefix(*v, feedbackImageDataPrefix) {
		return nil, false
	}
	data, err := base64.StdEncoding.DecodeString((*v)[len(feedbackImageDataPrefix):])
	if err != nil {
		return nil, false
	}
	if len(data) < len(pngMagic) || !bytes.Equal(data[:len(pngMagic)], pngMagic) {
		return nil, false
	}
	if len(data) > feedbackMaxImageBytes {
		return nil, false
	}
	return data, true
}

// cutElementText cuts the value to its first 80 runes, so the file
// format stays true whatever a client sends.
func cutElementText(v *string) *string {
	if v == nil {
		return nil
	}
	runes := []rune(*v)
	if len(runes) <= feedbackMaxElementRun {
		return v
	}
	cut := string(runes[:feedbackMaxElementRun])
	return &cut
}

func writeItemJSON(w http.ResponseWriter, status int, item any) {
	b, _ := json.Marshal(item)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}
