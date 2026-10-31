package sam

// The tests of the zone parser. Pure functions: no network, no
// store, no AI client.

import (
	"encoding/json"
	"strings"
	"testing"
)

// envelope builds a Responses API answer with one output_text part
// per string, in order. One call with one part is the normal shape;
// the text split test calls it with two parts.
func envelope(parts ...string) []byte {
	content := make([]map[string]string, 0, len(parts))
	for _, text := range parts {
		content = append(content, map[string]string{
			"type": "output_text", "text": text,
		})
	}
	body := map[string]any{
		"output": []map[string]any{
			{"type": "message", "content": content},
		},
	}
	b, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return b
}

// wantZoneError asserts the exact error text of one refused answer.
func wantZoneError(t *testing.T, body []byte, want string) {
	t.Helper()
	_, err := ParseZones(body, "id")
	if err == nil {
		t.Fatal("ParseZones gave no error")
	}
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err.Error(), want)
	}
}

// wantZones asserts the zones of one accepted answer.
func wantZones(t *testing.T, body []byte, label string, want ...Zone) {
	t.Helper()
	zones, err := ParseZones(body, label)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if zones == nil {
		t.Fatal("zones is nil, want a non-nil slice")
	}
	if len(zones) != len(want) {
		t.Fatalf("zones = %+v, want %+v", zones, want)
	}
	for i, z := range want {
		if zones[i] != z {
			t.Errorf("zone %d = %+v, want %+v", i, zones[i], z)
		}
	}
}

const (
	realRecord = `<0f>0<|box;x1=454;y1=835;x2=719;y2=908;w=806;h=1131|><|mask;x=0;y=0;data=AAA|>`
	noValid    = "cannot parse the zones: no valid box record in the answer"
)

var realBox = Box{X: 454, Y: 835, Width: 266, Height: 74}

// S1.
func TestParseRealRecord(t *testing.T) {
	body := envelope(realRecord)
	wantZones(t, body, "signature", Zone{Label: "signature", Box: realBox})
	// The result type holds no mask, so the marshalled text holds no
	// mask key.
	zones, _ := ParseZones(body, "signature")
	text, err := json.Marshal(zones)
	if err != nil {
		t.Fatalf("marshal zones: %v", err)
	}
	if strings.Contains(string(text), "mask") {
		t.Errorf("the result holds a mask key: %s", text)
	}
}

// S2.
func TestParseTwoRecordsInOrder(t *testing.T) {
	wantZones(t, envelope(`<|box;x1=1;y1=2;x2=3;y2=4|>,<|box;x1=5;y1=6;x2=7;y2=8;c=0.91|>`),
		"stamp",
		Zone{Label: "stamp", Box: Box{X: 1, Y: 2, Width: 3, Height: 3}},
		Zone{Label: "stamp", Box: Box{X: 5, Y: 6, Width: 3, Height: 3}})
}

// S3.
func TestParseEmptyText(t *testing.T) {
	wantZones(t, envelope(""), "id")
}

// S4.
func TestParseNoOutput(t *testing.T) {
	wantZones(t, []byte(`{"output":[]}`), "id")
}

// S5.
func TestParseBadInteger(t *testing.T) {
	wantZoneError(t, envelope(`<|box;x1=1;y1=2;x2=oops;y2=4|>`), noValid)
}

// S6.
func TestParseMissingKey(t *testing.T) {
	wantZoneError(t, envelope(`<|box;x1=1;y1=2;y2=4|>`), noValid)
}

// S7.
func TestParseReversedCorners(t *testing.T) {
	wantZoneError(t, envelope(`<|box;x1=9;y1=2;x2=3;y2=4|>`), noValid)
}

// S8.
func TestParseSkipsBrokenRecord(t *testing.T) {
	wantZones(t, envelope(`<|box;x1=1;y1=2;x2=3;y2=4|><|box;x1=1;y1=2;x2=oops;y2=4|>`),
		"id", Zone{Label: "id", Box: Box{X: 1, Y: 2, Width: 3, Height: 3}})
}

// S9.
func TestParseNoRecord(t *testing.T) {
	wantZoneError(t, envelope("hello"), noValid)
}

// S10.
func TestParseBadEnvelope(t *testing.T) {
	_, err := ParseZones([]byte(`{oops`), "id")
	if err == nil || !strings.HasPrefix(err.Error(), "cannot parse the zones: invalid character") {
		t.Errorf("error = %v, want the JSON error", err)
	}
}

// S11.
func TestParseTextSplit(t *testing.T) {
	wantZones(t, envelope(realRecord[:20], realRecord[20:]), "id",
		Zone{Label: "id", Box: realBox})
}

// S12.
func TestPhrases(t *testing.T) {
	want := []Phrase{
		{"handwritten scribble", "signature"},
		{"circular stamp", "stamp"},
		{"identity card", "id"},
	}
	if len(Phrases) != len(want) {
		t.Fatalf("Phrases = %+v, want %+v", Phrases, want)
	}
	for i, p := range want {
		if Phrases[i] != p {
			t.Errorf("phrase %d = %+v, want %+v", i, Phrases[i], p)
		}
	}
}

// The live answers of the new phrases (signature and stamp).
const (
	liveSignature = "<0f>0<|box;x1=129;y1=1428;x2=370;y2=1489;c=0.55;w=1240;h=1754|><|mask;x=0;y=0;data=AAA|>"
	liveStamp     = "<0f>0<|box;x1=960;y1=1444;x2=1119;y2=1603;c=0.90;w=1240;h=1754|><|mask;x=0;y=0;data=AAA|>"
)

// J2-1.
func TestParseLiveSignature(t *testing.T) {
	wantZones(t, envelope(liveSignature), "signature",
		Zone{Label: "signature", Box: Box{X: 129, Y: 1428, Width: 242, Height: 62}})
}

// J2-2.
func TestParseLiveStamp(t *testing.T) {
	wantZones(t, envelope(liveStamp), "stamp",
		Zone{Label: "stamp", Box: Box{X: 960, Y: 1444, Width: 160, Height: 160}})
}

// J2-3.
func TestParseLowConfidenceDropped(t *testing.T) {
	wantZones(t, envelope(`<|box;x1=1;y1=2;x2=3;y2=4;c=0.29|>`), "id")
}

// J2-4.
func TestParseConfidenceBoundary(t *testing.T) {
	wantZones(t, envelope(`<|box;x1=1;y1=2;x2=3;y2=4;c=0.3|>`), "id",
		Zone{Label: "id", Box: Box{X: 1, Y: 2, Width: 3, Height: 3}})
}

// J2-5.
func TestParseBadConfidence(t *testing.T) {
	wantZoneError(t, envelope(`<|box;x1=1;y1=2;x2=3;y2=4;c=oops|>`), noValid)
}

// J2-6.
func TestParseKeepsStrongBox(t *testing.T) {
	wantZones(t, envelope(`<|box;x1=1;y1=2;x2=3;y2=4;c=0.29|>,<|box;x1=5;y1=6;x2=7;y2=8;c=0.90|>`),
		"stamp", Zone{Label: "stamp", Box: Box{X: 5, Y: 6, Width: 3, Height: 3}})
}

// J2-7.
func TestRequestBytes(t *testing.T) {
	got := string(Request("sam-3.1", "circular stamp", "image/png", []byte{1, 2, 3}))
	want := `{"model":"sam-3.1","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"circular stamp"},{"type":"input_image","image_url":"data:image/png;base64,AQID"}]}],"metadata":{"include_confidence":"true","mask_encoding":"one_bit"}}`
	if got != want {
		t.Errorf("Request =\n%s\nwant\n%s", got, want)
	}
}
