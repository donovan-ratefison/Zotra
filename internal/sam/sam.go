// Package sam builds the SAM 3.1 requests of one scan and parses the
// zone answers. Each request goes through the Responses API, so the
// cache holds each request under its own key.
package sam

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Box is one box in image pixels.
type Box struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Zone is one zone of a scan: a label and a box in image pixels.
type Zone struct {
	Label string `json:"label"`
	Box   Box    `json:"box"`
}

// Phrase is one SAM 3.1 request: the noun phrase and the zone label.
type Phrase struct{ Text, Label string }

// Phrases are the requests of one scan, in answer order.
var Phrases = []Phrase{{"signature", "signature"}, {"stamp", "stamp"}, {"ID card", "id"}}

// requestPayload is the Responses API request of one scan.
type requestPayload struct {
	Model string      `json:"model"`
	Input []inputItem `json:"input"`
}

// inputItem is one message of the input.
type inputItem struct {
	Role    string        `json:"role"`
	Content []contentPart `json:"content"`
}

// contentPart is one part of one message.
type contentPart struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	ImageURL string `json:"image_url,omitempty"`
}

// Request builds the Responses API payload of one scan: the SAM
// model, the noun phrase, and the image as a data URL. The client
// posts the payload as is.
func Request(model string, prompt string, mime string, imageData []byte) []byte {
	payload := requestPayload{
		Model: model,
		Input: []inputItem{{
			Role: "user",
			Content: []contentPart{
				{Type: "input_text", Text: prompt},
				{Type: "input_image",
					ImageURL: "data:" + mime + ";base64," +
						base64.StdEncoding.EncodeToString(imageData)},
			},
		}},
	}
	b, _ := json.Marshal(payload)
	return b
}

// envelope is the walk shape of a Responses API answer. The parser
// joins the text of the output_text parts of the message items.
type answerEnvelope struct {
	Output []struct {
		Type    string `json:"type"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
}

// boxRecord finds one box record of the SAM 3.1 answer text, for
// example <|box;x1=454;y1=835;x2=719;y2=908;w=806;h=1131|>.
var boxRecord = regexp.MustCompile(`<\|box;([^|]*)\|>`)

// ParseZones reads a Responses API answer of one noun phrase and
// returns its zones, each with the given label. The text holds box
// records with inclusive pixel corners x1, y1, x2, y2. The parser
// ignores the other keys and the mask records. An empty text gives
// no zone.
func ParseZones(body []byte, label string) ([]Zone, error) {
	var env answerEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("cannot parse the zones: %v", err)
	}
	var joined strings.Builder
	for _, item := range env.Output {
		if item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			if part.Type == "output_text" {
				joined.WriteString(part.Text)
			}
		}
	}
	text := joined.String()
	out := []Zone{}
	if strings.TrimSpace(text) == "" {
		return out, nil
	}
	for _, m := range boxRecord.FindAllStringSubmatch(text, -1) {
		if b, ok := parseBox(m[1]); ok {
			out = append(out, Zone{Label: label, Box: b})
		}
	}
	if len(out) == 0 {
		return nil, errors.New("cannot parse the zones: no valid box record in the answer")
	}
	return out, nil
}

// parseBox reads the keys of one box record. It gives false when a
// corner key is missing, is not an integer, or when x2 < x1 or y2 < y1.
func parseBox(record string) (Box, bool) {
	kv := map[string]string{}
	for _, p := range strings.Split(record, ";") {
		k, v, _ := strings.Cut(p, "=")
		kv[k] = v
	}
	var c [4]int
	for i, k := range []string{"x1", "y1", "x2", "y2"} {
		v, ok := kv[k]
		if !ok {
			return Box{}, false
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			return Box{}, false
		}
		c[i] = n
	}
	if c[2] < c[0] || c[3] < c[1] {
		return Box{}, false
	}
	return Box{X: c[0], Y: c[1], Width: c[2] - c[0] + 1, Height: c[3] - c[1] + 1}, true
}
