package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Message is one chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Client calls the AI provider through the transport.
type Client struct {
	cfg Config
	hc  *http.Client
}

// New returns the client of one configuration. Its http.Client uses
// the Transport of the configuration.
func New(cfg Config) *Client {
	return &Client{cfg: cfg, hc: &http.Client{Transport: NewTransport(cfg, nil)}}
}

// ChatCompletion posts one Chat Completions request to
// BaseURL + "/chat/completions" with a strict JSON Schema response
// format. schemaName is the schema name, schema the JSON Schema
// object. It returns the raw response body.
func (c *Client) ChatCompletion(ctx context.Context, messages []Message, schemaName string, schema map[string]any) ([]byte, error) {
	req := struct {
		Model          string          `json:"model"`
		Messages       []Message       `json:"messages"`
		ResponseFormat *responseFormat `json:"response_format"`
	}{
		Model:    c.cfg.TextModel,
		Messages: messages,
		ResponseFormat: &responseFormat{
			Type: "json_schema",
			JSONSchema: jsonSchema{
				Name:   schemaName,
				Strict: true,
				Schema: schema,
			},
		},
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	return c.post(ctx, "/chat/completions", body)
}

// Responses posts one Responses API request to BaseURL +
// "/responses". payload is the full request body JSON. It returns
// the raw response body.
func (c *Client) Responses(ctx context.Context, payload []byte) ([]byte, error) {
	return c.post(ctx, "/responses", payload)
}

// PostChat posts one prepared Chat Completions payload to
// BaseURL + "/chat/completions" and returns the raw body. The
// transport, the modes and the cache apply as for the other calls.
func (c *Client) PostChat(ctx context.Context, payload []byte) ([]byte, error) {
	return c.post(ctx, "/chat/completions", payload)
}

// VisionPayload builds the Chat Completions payload of one vision
// call: one user message with a text part and an image part, and
// the strict JSON Schema response format. model is the model name,
// text the instruction, mime and imageData the scan. The image
// travels as a data URL.
func VisionPayload(model, text, mime string, imageData []byte,
	schemaName string, schema map[string]any,
) []byte {
	payload := visionPayload{
		Model: model,
		Messages: []visionMessage{{
			Role: "user",
			Content: []visionPart{
				{Type: "text", Text: text},
				{Type: "image_url", ImageURL: &visionImage{
					URL: "data:" + mime + ";base64," +
						base64.StdEncoding.EncodeToString(imageData),
				}},
			},
		}},
		ResponseFormat: &responseFormat{
			Type: "json_schema",
			JSONSchema: jsonSchema{
				Name:   schemaName,
				Strict: true,
				Schema: schema,
			},
		},
	}
	// json.Marshal of these structs never fails: every field holds a
	// marshalable value. The sam.Request precedent.
	b, _ := json.Marshal(payload)
	return b
}

type responseFormat struct {
	Type       string     `json:"type"`
	JSONSchema jsonSchema `json:"json_schema"`
}

type jsonSchema struct {
	Name   string         `json:"name"`
	Strict bool           `json:"strict"`
	Schema map[string]any `json:"schema"`
}

// visionImage is the image part payload: one data URL.
type visionImage struct {
	URL string `json:"url"`
}

// visionPart is one content part of one vision message. The omitempty
// fields keep each part to its own keys: a text part holds type and
// text, an image part holds type and image_url.
type visionPart struct {
	Type     string       `json:"type"`
	Text     string       `json:"text,omitempty"`
	ImageURL *visionImage `json:"image_url,omitempty"`
}

// visionMessage is one message of a vision payload.
type visionMessage struct {
	Role    string       `json:"role"`
	Content []visionPart `json:"content"`
}

// visionPayload is the Chat Completions request of one vision call.
type visionPayload struct {
	Model          string          `json:"model"`
	Messages       []visionMessage `json:"messages"`
	ResponseFormat *responseFormat `json:"response_format"`
}

// post sends one POST with the API key headers and returns the raw
// response body. A status out of 200 to 299 gives an error with the
// status, the path and the detail of the provider.
func (c *Client) post(ctx context.Context, path string, body []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", c.cfg.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		msg := fmt.Sprintf("ai: status %d from %s", resp.StatusCode, req.URL.Path)
		if d := errorDetail(b); d != "" {
			msg += ": " + d
		}
		return nil, errors.New(msg)
	}
	return b, nil
}

// errorDetail returns error.message of an OpenAI-compatible error
// body, else the trimmed body text, cut to 200 bytes.
func errorDetail(b []byte) string {
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	d := strings.TrimSpace(string(b))
	if json.Unmarshal(b, &e) == nil && e.Error.Message != "" {
		d = e.Error.Message
	}
	if len(d) > 200 {
		d = d[:200]
	}
	return d
}
