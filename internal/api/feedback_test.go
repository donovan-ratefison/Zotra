package api

// Tests of the feedback routes of plan.md section 8. The 24 rows run
// in order, on one handler and one directory. Contract of each row:
// local/lots/2.0b/brief.md.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEUlEQVR4nAAEAPv/Ag9MRQMAARYAowJxo/wAAAAASUVORK5CYII="

const fullBody = `{"kind":"bug","text":"The button does nothing","url":"/studio/p/1","selector":"#send","element_text":"Send","box":{"x":10,"y":20,"width":80,"height":30},"viewport":{"width":1366,"height":768},"image_data":null}`

func newFeedbackAPI(t *testing.T) (http.Handler, string) {
	t.Helper()
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<p>index</p>")}}
	dir := filepath.Join(t.TempDir(), "feedback")
	return NewHandler(static, "v-test", dir), dir
}

func post(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func bodyWith(t *testing.T, changes map[string]any) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(fullBody), &m); err != nil {
		t.Fatalf("fixture fullBody does not parse: %v", err)
	}
	for k, v := range changes {
		m[k] = v
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	return string(b)
}

func decodeItem(t *testing.T, rec *httptest.ResponseRecorder) FeedbackItem {
	t.Helper()
	var item FeedbackItem
	if err := json.Unmarshal(rec.Body.Bytes(), &item); err != nil {
		t.Fatalf("body is not a feedback item: %v: %q", err, rec.Body.String())
	}
	return item
}

func checkError(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode, wantMessage string) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Errorf("status = %d, want %d", rec.Code, wantStatus)
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not an error body: %v: %q", err, rec.Body.String())
	}
	if body.Error.Code != wantCode {
		t.Errorf("code = %q, want %q", body.Error.Code, wantCode)
	}
	if body.Error.Message != wantMessage {
		t.Errorf("message = %q, want %q", body.Error.Message, wantMessage)
	}
}

// handWriteItem writes one fixture file direct. Fixtures need no
// temp-then-rename: that rule binds the server.
func handWriteItem(t *testing.T, dir string, item FeedbackItem) {
	t.Helper()
	b, err := json.MarshalIndent(item, "", "  ")
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, item.ID+".json"), b, 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}

// handItem gives the 17-field base of the hand-written items. The
// rows override the fields they name.
func handItem(id, status string) FeedbackItem {
	return FeedbackItem{
		ID:        id,
		Status:    status,
		Kind:      feedbackKindBug,
		Text:      "x",
		URL:       "/",
		Viewport:  FeedbackViewport{Width: 1366, Height: 768},
		Commit:    "v-test",
		CreatedAt: "2026-10-27T08:00:00Z",
		Fix:       []string{},
		History: []FeedbackHistory{{
			At:     "2026-10-27T08:00:00Z",
			Status: status,
			By:     "orchestrator",
			Fix:    []string{},
		}},
	}
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

func TestFeedbackRoutes(t *testing.T) {
	h, dir := newFeedbackAPI(t)

	t.Run("01 empty list", func(t *testing.T) {
		rec := get(t, h, "/api/dev/feedback")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if body := rec.Body.String(); body != "[]" {
			t.Errorf("body = %q, want []", body)
		}
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Errorf("stat dir = %v, want not exist", err)
		}
	})

	t.Run("02 create", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback", fullBody)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201", rec.Code)
		}
		item := decodeItem(t, rec)
		if item.ID != "0001" {
			t.Errorf("id = %q, want 0001", item.ID)
		}
		if item.Status != StatusOpen {
			t.Errorf("status = %q, want open", item.Status)
		}
		if item.Commit != "v-test" {
			t.Errorf("commit = %q, want v-test", item.Commit)
		}
		if item.Image != nil {
			t.Errorf("image = %v, want null", item.Image)
		}
		if len(item.Fix) != 0 {
			t.Errorf("fix = %v, want []", item.Fix)
		}
		if len(item.History) != 1 {
			t.Fatalf("history = %d entries, want 1", len(item.History))
		}
		hs := item.History[0]
		if hs.Status != StatusOpen || hs.By != "donovan" || hs.Note != "" || len(hs.Fix) != 0 {
			t.Errorf("history entry = %+v, want {open donovan \"\" []}", hs)
		}
		if _, err := time.Parse(time.RFC3339, item.CreatedAt); err != nil {
			t.Errorf("created_at %q does not parse as RFC 3339: %v", item.CreatedAt, err)
		}
		if _, err := os.Stat(dir); err != nil {
			t.Errorf("the write did not create the directory: %v", err)
		}
	})

	t.Run("03 file format", func(t *testing.T) {
		b, err := os.ReadFile(filepath.Join(dir, "0001.json"))
		if err != nil {
			t.Fatalf("read file: %v", err)
		}
		s := string(b)
		for _, want := range []string{`"status": "open"`, `"fix": []`, "\n  \"id\": \"0001\""} {
			if !strings.Contains(s, want) {
				t.Errorf("file does not hold %q", want)
			}
		}
	})

	t.Run("04 create with image", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback", bodyWith(t, map[string]any{
			"kind": "adjust", "image_data": "data:image/png;base64," + png1x1,
		}))
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201", rec.Code)
		}
		item := decodeItem(t, rec)
		if item.ID != "0002" {
			t.Fatalf("id = %q, want 0002", item.ID)
		}
		if item.Image == nil || *item.Image != "0002.png" {
			t.Fatalf("image = %v, want 0002.png", item.Image)
		}
		if _, err := os.Stat(filepath.Join(dir, "0002.png")); err != nil {
			t.Fatalf("stat image file: %v", err)
		}
		rec = get(t, h, "/api/dev/feedback/0002/image")
		if rec.Code != http.StatusOK {
			t.Fatalf("image status = %d, want 200", rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); got != "image/png" {
			t.Errorf("Content-Type = %q, want image/png", got)
		}
		want, err := base64.StdEncoding.DecodeString(png1x1)
		if err != nil {
			t.Fatalf("decode fixture: %v", err)
		}
		if !bytes.Equal(rec.Body.Bytes(), want) {
			t.Error("image bytes differ from the decoded fixture")
		}
	})

	t.Run("05 image 404", func(t *testing.T) {
		rec := get(t, h, "/api/dev/feedback/0001/image")
		checkError(t, rec, http.StatusNotFound, "not_found", "item 0001 has no image")
		rec = get(t, h, "/api/dev/feedback/9999/image")
		checkError(t, rec, http.StatusNotFound, "not_found", "no feedback item 9999")
	})

	t.Run("06 list order", func(t *testing.T) {
		rec := get(t, h, "/api/dev/feedback")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var items []FeedbackItem
		if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
			t.Fatalf("body is not an item array: %v", err)
		}
		ids := []string{}
		for _, item := range items {
			ids = append(ids, item.ID)
		}
		if want := []string{"0002", "0001"}; !reflect.DeepEqual(ids, want) {
			t.Errorf("ids = %v, want %v", ids, want)
		}
	})

	t.Run("07 question kind", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback", bodyWith(t, map[string]any{"kind": "question"}))
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201", rec.Code)
		}
		item := decodeItem(t, rec)
		if item.ID != "0003" {
			t.Errorf("id = %q, want 0003", item.ID)
		}
		if item.Status != StatusQuestion {
			t.Errorf("status = %q, want question", item.Status)
		}
	})

	t.Run("08 invalid kind", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback", bodyWith(t, map[string]any{"kind": "idea"}))
		checkError(t, rec, http.StatusBadRequest, "invalid_kind", "kind must be bug, adjust or question")
	})

	t.Run("09 invalid text", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback", bodyWith(t, map[string]any{"text": ""}))
		checkError(t, rec, http.StatusBadRequest, "invalid_text", "text must hold 1 to 2000 characters")
		rec = post(t, h, "/api/dev/feedback", bodyWith(t, map[string]any{"text": strings.Repeat("a", 2001)}))
		checkError(t, rec, http.StatusBadRequest, "invalid_text", "text must hold 1 to 2000 characters")
	})

	t.Run("10 invalid url", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback", bodyWith(t, map[string]any{"url": "http://x"}))
		checkError(t, rec, http.StatusBadRequest, "invalid_url", "url must start with a slash")
	})

	t.Run("11 invalid image", func(t *testing.T) {
		big := append(append([]byte{}, pngMagic...), make([]byte, feedbackMaxImageBytes+1-len(pngMagic))...)
		for name, data := range map[string]string{
			"jpeg data url": "data:image/jpeg;base64,AAAA",
			"bad base64":    "data:image/png;base64,!!!",
			"over 5 MB":     "data:image/png;base64," + base64.StdEncoding.EncodeToString(big),
		} {
			rec := post(t, h, "/api/dev/feedback", bodyWith(t, map[string]any{"image_data": data}))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("%s: status = %d, want 400", name, rec.Code)
				continue
			}
			checkError(t, rec, http.StatusBadRequest, "invalid_image", "image must be a PNG under 5 MB")
		}
	})

	t.Run("12 invalid json", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback", "{bad")
		checkError(t, rec, http.StatusBadRequest, "invalid_json", "the body is not a JSON object")
	})

	t.Run("13 verify 409", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback/0001/verify", "")
		checkError(t, rec, http.StatusConflict, "wrong_status", "only a fixed item can be verified")
	})

	t.Run("14 verify ok", func(t *testing.T) {
		lot := "fb-001"
		understood := "The gateway label overflows the diamond."
		fixedCommit := "abc1234"
		item := handItem("0003", StatusFixed)
		item.Lot = &lot
		item.Understood = &understood
		item.Fix = []string{"Centered the label", "Capped the width"}
		item.FixedCommit = &fixedCommit
		handWriteItem(t, dir, item)

		rec := post(t, h, "/api/dev/feedback/0003/verify", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if got := decodeItem(t, rec); got.Status != StatusVerified {
			t.Errorf("status = %q, want verified", got.Status)
		}
		b, err := os.ReadFile(filepath.Join(dir, "0003.json"))
		if err != nil {
			t.Fatalf("read file: %v", err)
		}
		var saved FeedbackItem
		if err := json.Unmarshal(b, &saved); err != nil {
			t.Fatalf("file does not parse: %v", err)
		}
		if saved.Status != StatusVerified {
			t.Errorf("file status = %q, want verified", saved.Status)
		}
		if saved.Lot == nil || *saved.Lot != "fb-001" {
			t.Errorf("file lot = %v, want fb-001", saved.Lot)
		}
		if saved.Understood == nil || *saved.Understood != understood {
			t.Errorf("file understood = %v, want %q", saved.Understood, understood)
		}
		if want := []string{"Centered the label", "Capped the width"}; !reflect.DeepEqual(saved.Fix, want) {
			t.Errorf("file fix = %v, want %v", saved.Fix, want)
		}
		if saved.FixedCommit == nil || *saved.FixedCommit != fixedCommit {
			t.Errorf("file fixed_commit = %v, want %q", saved.FixedCommit, fixedCommit)
		}
		if len(saved.History) != 2 {
			t.Fatalf("history = %d entries, want 2", len(saved.History))
		}
		hs := saved.History[1]
		if hs.Status != StatusVerified || hs.By != "donovan" || hs.Note != "" || len(hs.Fix) != 0 {
			t.Errorf("last history entry = %+v, want {verified donovan \"\" []}", hs)
		}
	})

	t.Run("15 reopen ok", func(t *testing.T) {
		lot := "fb-002"
		understood := "The inbox shows closed cases."
		fixedCommit := "def5678"
		item := handItem("0004", StatusFixed)
		item.Lot = &lot
		item.Understood = &understood
		item.Fix = []string{"Filtered on status open"}
		item.FixedCommit = &fixedCommit
		handWriteItem(t, dir, item)

		rec := post(t, h, "/api/dev/feedback/0004/reopen", `{"note":"Still wrong at 1366"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		got := decodeItem(t, rec)
		if got.Status != StatusOpen {
			t.Errorf("status = %q, want open", got.Status)
		}
		if got.Lot != nil || got.Understood != nil || got.FixedCommit != nil || len(got.Fix) != 0 {
			t.Errorf("cleared fields = lot %v understood %v fixed_commit %v fix %v, want all clear",
				got.Lot, got.Understood, got.FixedCommit, got.Fix)
		}
		if len(got.History) != 2 {
			t.Fatalf("history = %d entries, want 2", len(got.History))
		}
		hs := got.History[1]
		if hs.Status != StatusOpen || hs.Note != "Still wrong at 1366" {
			t.Errorf("last history entry = %+v, want note \"Still wrong at 1366\"", hs)
		}
		if want := []string{"Filtered on status open"}; !reflect.DeepEqual(hs.Fix, want) {
			t.Errorf("history fix = %v, want %v", hs.Fix, want)
		}
		b, err := os.ReadFile(filepath.Join(dir, "0004.json"))
		if err != nil {
			t.Fatalf("read file: %v", err)
		}
		var saved FeedbackItem
		if err := json.Unmarshal(b, &saved); err != nil {
			t.Fatalf("file does not parse: %v", err)
		}
		if !reflect.DeepEqual(saved, got) {
			t.Error("the file does not hold the item of the answer")
		}
	})

	t.Run("16 reopen refusals", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback/0001/reopen", `{"note":""}`)
		checkError(t, rec, http.StatusBadRequest, "invalid_note", "note must hold 1 to 2000 characters")
		rec = post(t, h, "/api/dev/feedback/0001/reopen", `{"note":"`+strings.Repeat("n", 2001)+`"}`)
		checkError(t, rec, http.StatusBadRequest, "invalid_note", "note must hold 1 to 2000 characters")
		rec = post(t, h, "/api/dev/feedback/0001/reopen", `{"note":"x"}`)
		checkError(t, rec, http.StatusConflict, "wrong_status", "only a fixed or verified item can be reopened")
	})

	t.Run("17 reopen verified", func(t *testing.T) {
		handWriteItem(t, dir, handItem("0005", StatusVerified))
		rec := post(t, h, "/api/dev/feedback/0005/reopen", `{"note":"Looks good now"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		got := decodeItem(t, rec)
		if got.Status != StatusOpen {
			t.Errorf("status = %q, want open", got.Status)
		}
		if len(got.History) != 2 {
			t.Fatalf("history = %d entries, want 2", len(got.History))
		}
		hs := got.History[1]
		if hs.Status != StatusOpen || hs.Note != "Looks good now" || len(hs.Fix) != 0 {
			t.Errorf("last history entry = %+v, want {open \"Looks good now\" []}", hs)
		}
	})

	t.Run("18 no routes without dir", func(t *testing.T) {
		static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<p>index</p>")}}
		rec := get(t, NewHandler(static, "v-test", ""), "/api/dev/feedback")
		checkError(t, rec, http.StatusNotFound, "not_found", "no route for GET /api/dev/feedback")
	})

	t.Run("19 wrong method", func(t *testing.T) {
		rec := get(t, h, "/api/dev/feedback/0001/verify")
		checkError(t, rec, http.StatusNotFound, "not_found", "no route for GET /api/dev/feedback/0001/verify")
	})

	t.Run("20 no id left", func(t *testing.T) {
		handWriteItem(t, dir, handItem("9999", StatusOpen))
		before := dirNames(t, dir)
		rec := post(t, h, "/api/dev/feedback", fullBody)
		checkError(t, rec, http.StatusInternalServerError, "no_id_left", "all feedback ids are used")
		after := dirNames(t, dir)
		if !reflect.DeepEqual(before, after) {
			t.Errorf("dir after the POST = %v, want %v", after, before)
		}
		if err := os.Remove(filepath.Join(dir, "9999.json")); err != nil {
			t.Fatalf("remove 9999.json: %v", err)
		}
	})

	t.Run("21 element_text cut", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback", bodyWith(t, map[string]any{
			"element_text": strings.Repeat("e", 100),
		}))
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201", rec.Code)
		}
		item := decodeItem(t, rec)
		if item.ID != "0006" {
			t.Fatalf("id = %q, want 0006", item.ID)
		}
		if item.ElementText == nil || *item.ElementText != strings.Repeat("e", 80) {
			t.Fatalf("element_text length = %d, want 80", len([]rune(deref(item.ElementText))))
		}
		b, err := os.ReadFile(filepath.Join(dir, "0006.json"))
		if err != nil {
			t.Fatalf("read file: %v", err)
		}
		s := string(b)
		if !strings.Contains(s, strings.Repeat("e", 80)) {
			t.Error("file does not hold the first 80 characters")
		}
		if strings.Contains(s, strings.Repeat("e", 100)) {
			t.Error("file holds more than the first 80 characters")
		}
	})

	t.Run("22 image file missing", func(t *testing.T) {
		if err := os.Remove(filepath.Join(dir, "0002.png")); err != nil {
			t.Fatalf("remove 0002.png: %v", err)
		}
		rec := get(t, h, "/api/dev/feedback/0002/image")
		checkError(t, rec, http.StatusNotFound, "not_found", "image file of 0002 is missing")
	})

	t.Run("23 unknown id, verify and reopen", func(t *testing.T) {
		rec := post(t, h, "/api/dev/feedback/9998/verify", "")
		checkError(t, rec, http.StatusNotFound, "not_found", "no feedback item 9998")
		rec = post(t, h, "/api/dev/feedback/9998/reopen", `{"note":"x"}`)
		checkError(t, rec, http.StatusNotFound, "not_found", "no feedback item 9998")
	})

	t.Run("24 no leftover temporary file", func(t *testing.T) {
		names := dirNames(t, dir)
		want := []string{"0001.json", "0002.json", "0003.json", "0004.json", "0005.json", "0006.json"}
		if !reflect.DeepEqual(names, want) {
			t.Errorf("dir = %v, want %v", names, want)
		}
	})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
