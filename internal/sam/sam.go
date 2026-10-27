// Package sam builds the SAM 3.1 request of one scan and parses the
// zone answer. The request goes through the Responses API, so the
// cache holds the whole flow under one key.
package sam

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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
// model, the zone prompt, and the image as a data URL. The client
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

// zoneShape decodes one zone of the answer text. Every field is a
// pointer: a present 0 and a present empty string count as present,
// and only a missing key is absent. The mask key has no field, so
// the parser ignores it whatever it holds.
type zoneShape struct {
	Label *string `json:"label"`
	Box   *struct {
		X      *int `json:"x"`
		Y      *int `json:"y"`
		Width  *int `json:"width"`
		Height *int `json:"height"`
	} `json:"box"`
}

// zonesShape is the JSON object of the answer text.
type zonesShape struct {
	Zones []zoneShape `json:"zones"`
}

// ParseZones reads a Responses API answer and returns the zones. The
// text output holds one JSON object with a zones array. The parser
// keeps label and box, drops the mask.
func ParseZones(body []byte) ([]Zone, error) {
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
	if joined.Len() == 0 {
		return nil, errors.New("cannot parse the zones: no text in the answer")
	}
	var zones zonesShape
	if err := json.Unmarshal([]byte(joined.String()), &zones); err != nil {
		return nil, fmt.Errorf("cannot parse the zones: %v", err)
	}
	if zones.Zones == nil {
		return nil, errors.New("cannot parse the zones: no zones in the answer")
	}
	out := make([]Zone, 0, len(zones.Zones))
	for i, z := range zones.Zones {
		if z.Label == nil || strings.TrimSpace(*z.Label) == "" {
			return nil, fmt.Errorf("cannot parse the zones: zone %d has no label", i)
		}
		if z.Box == nil || z.Box.X == nil || z.Box.Y == nil ||
			z.Box.Width == nil || z.Box.Height == nil {
			return nil, fmt.Errorf("cannot parse the zones: zone %d has no box", i)
		}
		out = append(out, Zone{
			Label: *z.Label,
			Box: Box{
				X:      *z.Box.X,
				Y:      *z.Box.Y,
				Width:  *z.Box.Width,
				Height: *z.Box.Height,
			},
		})
	}
	return out, nil
}
