package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

type responseFormat struct {
	Type       string     `json:"type"`
	JSONSchema jsonSchema `json:"json_schema"`
}

type jsonSchema struct {
	Name   string         `json:"name"`
	Strict bool           `json:"strict"`
	Schema map[string]any `json:"schema"`
}

// post sends one POST with the API key headers and returns the raw
// response body. A status of 500 or more gives an error.
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
	if resp.StatusCode >= 500 {
		return nil, fmt.Errorf("ai: status %d from %s", resp.StatusCode, req.URL.Path)
	}
	return b, nil
}
