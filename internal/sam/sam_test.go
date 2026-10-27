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
	_, err := ParseZones(body)
	if err == nil {
		t.Fatal("ParseZones gave no error")
	}
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err.Error(), want)
	}
}

// 1.
func TestOneZoneWithMask(t *testing.T) {
	body := envelope(`{"zones":[{"label":"signature","box":{"x":10,"y":20,` +
		`"width":30,"height":40},"mask":[[1,2],[3,4]]}]}`)
	zones, err := ParseZones(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(zones) != 1 {
		t.Fatalf("zones = %d, want 1", len(zones))
	}
	if zones[0].Label != "signature" {
		t.Errorf("label = %q, want signature", zones[0].Label)
	}
	if zones[0].Box != (Box{X: 10, Y: 20, Width: 30, Height: 40}) {
		t.Errorf("box = %+v, want {10 20 30 40}", zones[0].Box)
	}
	// The result type holds no mask, so the marshalled text holds no
	// mask key.
	text, err := json.Marshal(zones)
	if err != nil {
		t.Fatalf("marshal zones: %v", err)
	}
	if strings.Contains(string(text), "mask") {
		t.Errorf("the result holds a mask key: %s", text)
	}
}

// 2.
func TestThreeZonesInOrder(t *testing.T) {
	body := envelope(`{"zones":[` +
		`{"label":"signature","box":{"x":1,"y":2,"width":3,"height":4},"mask":[]},` +
		`{"label":"stamp","box":{"x":5,"y":6,"width":7,"height":8},"mask":[]},` +
		`{"label":"id","box":{"x":9,"y":10,"width":11,"height":12},"mask":[]}]}`)
	zones, err := ParseZones(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := []Zone{
		{Label: "signature", Box: Box{X: 1, Y: 2, Width: 3, Height: 4}},
		{Label: "stamp", Box: Box{X: 5, Y: 6, Width: 7, Height: 8}},
		{Label: "id", Box: Box{X: 9, Y: 10, Width: 11, Height: 12}},
	}
	if len(zones) != len(want) {
		t.Fatalf("zones = %d, want %d", len(zones), len(want))
	}
	for i, z := range want {
		if zones[i] != z {
			t.Errorf("zone %d = %+v, want %+v", i, zones[i], z)
		}
	}
}

// 3.
func TestTextSplit(t *testing.T) {
	body := envelope(`{"zones":[{"la`, `bel":"signature","box":`+
		`{"x":10,"y":20,"width":30,"height":40}}]}`)
	zones, err := ParseZones(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(zones) != 1 {
		t.Fatalf("zones = %d, want 1", len(zones))
	}
	if zones[0].Label != "signature" {
		t.Errorf("label = %q, want signature", zones[0].Label)
	}
	if zones[0].Box != (Box{X: 10, Y: 20, Width: 30, Height: 40}) {
		t.Errorf("box = %+v, want {10 20 30 40}", zones[0].Box)
	}
}

// 4.
func TestNoOutput(t *testing.T) {
	want := "cannot parse the zones: no text in the answer"
	for name, body := range map[string][]byte{
		"empty output":  []byte(`{"output":[]}`),
		"no output key": []byte(`{}`),
	} {
		t.Run(name, func(t *testing.T) {
			wantZoneError(t, body, want)
		})
	}
}

// 5.
func TestBadJSON(t *testing.T) {
	wantZoneError(t, envelope(`{oops`),
		"cannot parse the zones: invalid character 'o' "+
			"looking for beginning of object key string")
}

// 6.
func TestNoZonesKey(t *testing.T) {
	wantZoneError(t, envelope(`{"boxes":[]}`),
		"cannot parse the zones: no zones in the answer")
}

// 7.
func TestZoneWithoutLabel(t *testing.T) {
	wantZoneError(t,
		envelope(`{"zones":[{"box":{"x":1,"y":2,"width":3,"height":4}}]}`),
		"cannot parse the zones: zone 0 has no label")
}

// 8.
func TestZoneWithoutBox(t *testing.T) {
	wantZoneError(t, envelope(`{"zones":[{"label":"signature"}]}`),
		"cannot parse the zones: zone 0 has no box")
}

// 9.
func TestPartialBox(t *testing.T) {
	wantZoneError(t,
		envelope(`{"zones":[{"label":"signature","box":{"x":1,"y":2,"width":3}}]}`),
		"cannot parse the zones: zone 0 has no box")
}

// 10.
func TestZeroCoordinates(t *testing.T) {
	body := envelope(`{"zones":[{"label":"signature",` +
		`"box":{"x":0,"y":0,"width":30,"height":40}}]}`)
	zones, err := ParseZones(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(zones) != 1 {
		t.Fatalf("zones = %d, want 1", len(zones))
	}
	if zones[0].Box != (Box{X: 0, Y: 0, Width: 30, Height: 40}) {
		t.Errorf("box = %+v, want {0 0 30 40}", zones[0].Box)
	}
}

// 11.
func TestBlankLabel(t *testing.T) {
	wantZoneError(t,
		envelope(`{"zones":[{"label":" ","box":{"x":1,"y":2,"width":3,"height":4}}]}`),
		"cannot parse the zones: zone 0 has no label")
}
