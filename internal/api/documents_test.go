package api

// The tests of the document routes. The zone rows run in mode replay
// with a primed cache, or in mode off. No test makes a live AI call.

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/readfields"
	"github.com/donovan-ratefison/zotra/internal/sam"
)

// pngBytes decodes the 1x1 PNG fixture of the feedback tests.
func pngBytes(t *testing.T) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(png1x1)
	if err != nil {
		t.Fatalf("decode png fixture: %v", err)
	}
	return b
}

// jpegFixture is a JPEG file header with JFIF data: the magic three
// bytes, then the APP0 segment, then padding.
func jpegFixture() []byte {
	return append([]byte("\xff\xd8\xff\xe0\x00\x10JFIF"), 0, 0, 0, 0)
}

// uploadScan builds the multipart request of one scan upload and
// serves it on handler. The part is one CreatePart call with the
// Content-Disposition header of a file field and the Content-Type
// header with mime: the value the handler must ignore in favor of
// the magic bytes.
func uploadScan(t *testing.T, handler http.Handler, caseID, name, mime string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition",
		`form-data; name="file"; filename="`+name+`"`)
	header.Set("Content-Type", mime)
	part, err := w.CreatePart(header)
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	req := httptest.NewRequest("POST", "/api/cases/"+caseID+"/documents", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// samEnvelope is the Responses answer shape that primeSAM stores.
type samEnvelope struct {
	Output []samItem `json:"output"`
}

type samItem struct {
	Type    string    `json:"type"`
	Content []samPart `json:"content"`
}

type samPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// primeSAM writes one cache file for the Responses request the
// handler sends for one scan: <dir>/<ai.CacheKey("POST",
// "/v1/responses", sam.Request("sam-3.1", ai.SamZonesPrompt, mime,
// image))>.json. The body holds the cache entry shape with the
// Responses envelope of answer: the zone JSON sits in the text of
// one output_text part. The model is the default SAMModel: no test
// sets ZOTRA_AI_SAM_MODEL.
func primeSAM(t *testing.T, dir, mime string, image []byte, answer string) {
	t.Helper()
	payload := sam.Request("sam-3.1", ai.SamZonesPrompt, mime, image)
	env := samEnvelope{Output: []samItem{{
		Type:    "message",
		Content: []samPart{{Type: "output_text", Text: answer}},
	}}}
	envelopeBytes, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	entry := struct {
		Status  int         `json:"status"`
		Headers http.Header `json:"headers"`
		Body    string      `json:"body"`
	}{Status: 200, Headers: http.Header{}, Body: string(envelopeBytes)}
	entryBytes, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal cache entry: %v", err)
	}
	path := filepath.Join(dir,
		ai.CacheKey("POST", "/v1/responses", payload)+".json")
	if err := os.WriteFile(path, entryBytes, 0o644); err != nil {
		t.Fatalf("write cache file: %v", err)
	}
}

// uploadForZones uploads the PNG on one fresh case and returns the
// document id. The zone rows call it after the AI env is set.
func uploadForZones(t *testing.T, h http.Handler) string {
	t.Helper()
	caseID := createCase(t, seedVersionID, true)
	rec := uploadScan(t, h, caseID, "scan.png", "image/png", pngBytes(t))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: status %d: %s", rec.Code, rec.Body.String())
	}
	return decode(t, rec)["document"].(map[string]any)["id"].(string)
}

// postZones runs POST /api/documents/{id}/zones for one document.
func postZones(t *testing.T, id string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/documents/"+id+"/zones", "", "")
}

// 12.
func TestUploadAndRead(t *testing.T) {
	h := newTestAPI(t)
	caseID := createCase(t, seedVersionID, true)
	png := pngBytes(t)

	rec := uploadScan(t, h, caseID, "scan.png", "image/png", png)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: status %d: %s", rec.Code, rec.Body.String())
	}
	doc := decode(t, rec)["document"].(map[string]any)
	if doc["case_id"] != caseID {
		t.Errorf("case_id = %v, want %s", doc["case_id"], caseID)
	}
	if doc["name"] != "scan.png" {
		t.Errorf("name = %v, want scan.png", doc["name"])
	}
	if doc["mime"] != "image/png" {
		t.Errorf("mime = %v, want image/png", doc["mime"])
	}
	sum := sha256.Sum256(png)
	shaWant := hex.EncodeToString(sum[:])
	if doc["sha256"] != shaWant {
		t.Errorf("sha256 = %v, want %s", doc["sha256"], shaWant)
	}
	if len(doc["sha256"].(string)) != 64 {
		t.Errorf("sha256 length = %d, want 64", len(doc["sha256"].(string)))
	}
	id := doc["id"].(string)

	// The metadata route: the same shape, no bytes.
	rec = do(t, "GET", "/api/documents/"+id, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("metadata: status %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"bytes"`) {
		t.Errorf("the metadata holds a bytes key: %s", rec.Body.String())
	}
	meta := decode(t, rec)["document"].(map[string]any)
	if meta["id"] != id || meta["name"] != "scan.png" ||
		meta["mime"] != "image/png" || meta["sha256"] != shaWant ||
		meta["case_id"] != caseID {
		t.Errorf("metadata = %v, want the upload shape", meta)
	}

	// The bytes route: the raw PNG, with the stored mime.
	rec = do(t, "GET", "/api/documents/"+id+"/bytes", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("bytes: status %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", got)
	}
	if !bytes.Equal(rec.Body.Bytes(), png) {
		t.Errorf("the bytes route answers other bytes than the upload")
	}
}

// 13.
func TestJPEGUpload(t *testing.T) {
	h := newTestAPI(t)
	caseID := createCase(t, seedVersionID, true)
	rec := uploadScan(t, h, caseID, "scan.jpg", "image/jpeg", jpegFixture())
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: status %d: %s", rec.Code, rec.Body.String())
	}
	doc := decode(t, rec)["document"].(map[string]any)
	if doc["mime"] != "image/jpeg" {
		t.Errorf("mime = %v, want image/jpeg", doc["mime"])
	}
}

// 14.
func TestUploadRefusals(t *testing.T) {
	h := newTestAPI(t)
	caseID := createCase(t, seedVersionID, true)
	png := pngBytes(t)

	// No file field: a valid multipart form with one field named data.
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if err := w.WriteField("data", "x"); err != nil {
		t.Fatalf("write field: %v", err)
	}
	w.Close()
	req := httptest.NewRequest("POST",
		"/api/cases/"+caseID+"/documents", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	checkError(t, rec, http.StatusBadRequest, "invalid_upload",
		"the file field is required")

	// Bytes with no PNG or JPEG magic.
	rec = uploadScan(t, h, caseID, "note.txt", "text/plain", []byte("hello"))
	checkError(t, rec, http.StatusBadRequest, "invalid_upload",
		"only PNG and JPEG scans are accepted")

	// A PNG part just over 10 MiB: the body is under the cap, the
	// size check of the scan refuses it.
	over := append(append([]byte{}, png...), make([]byte, 10<<20)...)
	rec = uploadScan(t, h, caseID, "over.png", "image/png", over)
	checkError(t, rec, http.StatusBadRequest, "invalid_upload",
		"the scan must stay under 10 MiB")

	// An 11 MiB PNG part: the body cap refuses it before the parse.
	big := append(append([]byte{}, png...), make([]byte, 11<<20)...)
	rec = uploadScan(t, h, caseID, "big.png", "image/png", big)
	checkError(t, rec, http.StatusBadRequest, "invalid_upload",
		"the scan must stay under 10 MiB")

	// Unknown case: the case check sits before the form parse.
	rec = uploadScan(t, h, "ghost", "scan.png", "image/png", png)
	checkError(t, rec, http.StatusNotFound, "not_found", "no case ghost")

	// Not a multipart body.
	req = httptest.NewRequest("POST",
		"/api/cases/"+caseID+"/documents", strings.NewReader(`{"x":1}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	checkError(t, rec, http.StatusBadRequest, "invalid_upload",
		"the body must be a multipart form")
}

// 15.
func TestDocumentZones(t *testing.T) {
	dir := aiEnv(t)
	h := newTestAPI(t)
	id := uploadForZones(t, h)
	png := pngBytes(t)

	primeSAM(t, dir, "image/png", png,
		`{"zones":[{"label":"signature","box":{"x":10,"y":20,`+
			`"width":30,"height":40},"mask":[[1,2],[3,4]]}]}`)

	rec := postZones(t, id)
	if rec.Code != http.StatusOK {
		t.Fatalf("zones: status %d: %s", rec.Code, rec.Body.String())
	}
	zones := decode(t, rec)["zones"].([]any)
	if len(zones) != 1 {
		t.Fatalf("zones = %d, want 1", len(zones))
	}
	z := zones[0].(map[string]any)
	if z["label"] != "signature" {
		t.Errorf("label = %v, want signature", z["label"])
	}
	box := z["box"].(map[string]any)
	if box["x"].(float64) != 10 || box["y"].(float64) != 20 ||
		box["width"].(float64) != 30 || box["height"].(float64) != 40 {
		t.Errorf("box = %v, want {10 20 30 40}", box)
	}
	if strings.Contains(rec.Body.String(), "mask") {
		t.Errorf("the answer holds a mask key: %s", rec.Body.String())
	}
}

// 16.
func TestDocumentZonesEmpty(t *testing.T) {
	dir := aiEnv(t)
	h := newTestAPI(t)
	id := uploadForZones(t, h)

	primeSAM(t, dir, "image/png", pngBytes(t), `{"zones":[]}`)

	rec := postZones(t, id)
	if rec.Code != http.StatusOK {
		t.Fatalf("zones: status %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"zones":[]`) {
		t.Errorf("the answer is not an empty list: %s", rec.Body.String())
	}
}

// 17.
func TestDocumentZonesRefusals(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", dir)
	h := newTestAPI(t)
	id := uploadForZones(t, h)

	rec := postZones(t, "ghost")
	checkError(t, rec, http.StatusNotFound, "not_found", "no document ghost")

	rec = postZones(t, id)
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable",
		`the AI layer is not available: Post `+
			`"https://api.meta.ai/v1/responses": ai: off`)
}

// 18.
func TestDocumentZonesBadOutput(t *testing.T) {
	dir := aiEnv(t)
	h := newTestAPI(t)
	id := uploadForZones(t, h)

	primeSAM(t, dir, "image/png", pngBytes(t), `{oops`)

	rec := postZones(t, id)
	checkError(t, rec, http.StatusBadGateway, "bad_ai_output",
		"cannot parse the zones: invalid character 'o' "+
			"looking for beginning of object key string")
}

// 19.
func TestUnknownDocument(t *testing.T) {
	newTestAPI(t)

	rec := do(t, "GET", "/api/documents/ghost", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no document ghost")

	rec = do(t, "GET", "/api/documents/ghost/bytes", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no document ghost")
}

// 20.
func TestCaseScanList(t *testing.T) {
	h := newTestAPI(t)
	caseID := createCase(t, seedVersionID, true)
	png := pngBytes(t)

	rec := do(t, "GET", "/api/cases/"+caseID+"/documents", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list: status %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != `{"documents":[]}` {
		t.Errorf("empty list body = %s, want {\"documents\":[]}", got)
	}

	rec = do(t, "GET", "/api/cases/ghost/documents", "", "")
	checkError(t, rec, http.StatusNotFound, "not_found", "no case ghost")

	rec = uploadScan(t, h, caseID, "scan.png", "image/png", png)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: status %d: %s", rec.Code, rec.Body.String())
	}
	doc := decode(t, rec)["document"].(map[string]any)

	rec = do(t, "GET", "/api/cases/"+caseID+"/documents", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list: status %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"bytes"`) {
		t.Errorf("the list holds a bytes key: %s", rec.Body.String())
	}
	docs := decode(t, rec)["documents"].([]any)
	if len(docs) != 1 {
		t.Fatalf("documents = %d, want 1", len(docs))
	}
	entry := docs[0].(map[string]any)
	if entry["id"] != doc["id"] || entry["name"] != doc["name"] ||
		entry["sha256"] != doc["sha256"] {
		t.Errorf("entry = %v, want the upload id, name and sha256", entry)
	}
}

// readFieldsFixture is the one-field list of the read rows.
var readFieldsFixture = []readfields.Field{
	{Name: "amount", Label: "Amount", Type: "money"},
}

// readPayload builds the Chat Completions payload the handler sends
// for the PNG scan and the given fields. muse-spark-1.3 is the
// default TextModel: no test sets ZOTRA_AI_TEXT_MODEL.
func readPayload(t *testing.T, fields []readfields.Field) []byte {
	t.Helper()
	return ai.VisionPayload("muse-spark-1.3", ai.ReadFieldsPrompt,
		"image/png", pngBytes(t), "read_fields", readfields.SchemaFor(fields))
}

// primeChat writes one cache file for one prepared Chat Completions
// payload: <dir>/<ai.CacheKey("POST", "/v1/chat/completions",
// payload)>.json holds the cache entry shape with a Chat Completions
// envelope as body, and answer sits in choices[0].message.content.
// The delivered primeAI builds the messages form of ChatCompletion,
// so it cannot serve a vision payload.
func primeChat(t *testing.T, dir string, payload []byte, answer string) {
	env := struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}{}
	env.Choices = append(env.Choices, struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}{})
	env.Choices[0].Message.Content = answer
	envelope, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	entry := struct {
		Status  int         `json:"status"`
		Headers http.Header `json:"headers"`
		Body    string      `json:"body"`
	}{Status: 200, Headers: http.Header{}, Body: string(envelope)}
	entryBytes, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal cache entry: %v", err)
	}
	path := filepath.Join(dir,
		ai.CacheKey("POST", "/v1/chat/completions", payload)+".json")
	if err := os.WriteFile(path, entryBytes, 0o644); err != nil {
		t.Fatalf("write cache file: %v", err)
	}
}

// postRead runs POST /api/documents/{id}/read for one document.
func postRead(t *testing.T, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, "POST", "/api/documents/"+id+"/read", body, "")
}

// 21.
func TestDocumentRead(t *testing.T) {
	dir := aiEnv(t)
	h := newTestAPI(t)
	id := uploadForZones(t, h)

	primeChat(t, dir, readPayload(t, readFieldsFixture), `{"amount":240000}`)

	rec := postRead(t, id, `{"fields":[{"name":"amount","label":"Amount","type":"money"}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("read: status %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != `{"values":{"amount":240000}}` {
		t.Errorf("body = %s, want {\"values\":{\"amount\":240000}}", got)
	}
}

// 22.
func TestDocumentReadBadOutput(t *testing.T) {
	dir := aiEnv(t)
	h := newTestAPI(t)
	id := uploadForZones(t, h)

	primeChat(t, dir, readPayload(t, readFieldsFixture), `{"ghost":1}`)

	rec := postRead(t, id, `{"fields":[{"name":"amount","label":"Amount","type":"money"}]}`)
	checkError(t, rec, http.StatusBadGateway, "bad_ai_output",
		"unexpected field ghost")
}

// 23.
func TestDocumentReadRefusals(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("ZOTRA_AI_MODE", "off")
	t.Setenv("ZOTRA_AI_CACHE_DIR", dir)
	h := newTestAPI(t)
	id := uploadForZones(t, h)

	// Not a JSON body.
	rec := postRead(t, id, `not json`)
	checkError(t, rec, http.StatusBadRequest, "invalid_json",
		msgInvalidJSON)

	// An empty field list.
	rec = postRead(t, id, `{"fields":[]}`)
	checkError(t, rec, http.StatusBadRequest, "invalid_read",
		"at least one field is required")

	// A field with no name.
	rec = postRead(t, id, `{"fields":[{"name":"","label":"x","type":"string"}]}`)
	checkError(t, rec, http.StatusBadRequest, "invalid_read",
		"field 0 has no name")

	// A duplicate name.
	rec = postRead(t, id, `{"fields":[{"name":"amount","label":"A","type":"money"},`+
		`{"name":"amount","label":"A","type":"money"}]}`)
	checkError(t, rec, http.StatusBadRequest, "invalid_read",
		"duplicate field amount")

	// An unknown document, with one valid field list.
	rec = postRead(t, "ghost", `{"fields":[{"name":"amount","label":"Amount","type":"money"}]}`)
	checkError(t, rec, http.StatusNotFound, "not_found", "no document ghost")

	// The AI layer is off.
	rec = postRead(t, id, `{"fields":[{"name":"amount","label":"Amount","type":"money"}]}`)
	checkError(t, rec, http.StatusServiceUnavailable, "ai_unavailable",
		`the AI layer is not available: Post `+
			`"https://api.meta.ai/v1/chat/completions": ai: off`)
}
