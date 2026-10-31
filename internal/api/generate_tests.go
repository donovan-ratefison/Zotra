package api

// The test generator: POST /api/ai/generate-tests. The model
// proposes one case per red edge, the engine runs each case in
// memory, and only the cases that reach their edge become test
// cases in the store.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/donovan-ratefison/zotra/internal/ai"
	"github.com/donovan-ratefison/zotra/internal/coverage"
	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/sources"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// generateTestsSchema returns the response schema of the test
// generator, in strict mode: every model object carries
// additionalProperties false, and a step always holds its four
// fields, with null for the unused ones. Strict mode allows no free
// object, so each field value travels as one pair: field is the
// field name, value is the JSON text of the value. The handler
// decodes the pairs before the engine runs the case.
func generateTestsSchema() map[string]any {
	pair := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"field": map[string]any{"type": "string"},
			"value": map[string]any{"type": "string"},
		},
		"required":             []string{"field", "value"},
		"additionalProperties": false,
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"cases": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"target_edge": map[string]any{"type": "string"},
						"data": map[string]any{
							"type":  "array",
							"items": pair,
						},
						"steps": map[string]any{
							"type": "array",
							"items": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"type": map[string]any{"type": "string"},
									"values": map[string]any{
										"type":  "array",
										"items": pair,
									},
									"decision":      map[string]any{"type": "string"},
									"document_hash": map[string]any{"type": "string"},
								},
								"required":             []string{"type", "values", "decision", "document_hash"},
								"additionalProperties": false,
							},
						},
					},
					"required":             []string{"target_edge", "data", "steps"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"cases"},
		"additionalProperties": false,
	}
}

// processSummary returns the JSON summary of one definition: the
// name, the fields, the nodes and the edges, with the keys the
// prompt names. A nullable value gives null.
func processSummary(def process.Definition) []byte {
	type summaryField struct {
		Name     string   `json:"name"`
		Type     string   `json:"type"`
		Options  []string `json:"options"`
		Computed *string  `json:"computed"`
	}
	type summaryNode struct {
		ID        string   `json:"id"`
		Type      string   `json:"type"`
		Role      *string  `json:"role"`
		Decisions []string `json:"decisions"`
	}
	type summaryEdge struct {
		ID        string  `json:"id"`
		From      string  `json:"from"`
		To        string  `json:"to"`
		Decision  *string `json:"decision"`
		Condition *string `json:"condition"`
		IsDefault bool    `json:"is_default"`
	}
	summary := struct {
		Name   string         `json:"name"`
		Fields []summaryField `json:"fields"`
		Nodes  []summaryNode  `json:"nodes"`
		Edges  []summaryEdge  `json:"edges"`
	}{Name: def.Name}
	for _, f := range def.Fields {
		summary.Fields = append(summary.Fields, summaryField{
			Name: f.Name, Type: f.Type, Options: f.Options, Computed: f.Computed,
		})
	}
	for _, n := range def.Nodes {
		summary.Nodes = append(summary.Nodes, summaryNode{
			ID: n.ID, Type: n.Type, Role: n.Role, Decisions: n.Decisions,
		})
	}
	for _, e := range def.Edges {
		summary.Edges = append(summary.Edges, summaryEdge{
			ID: e.ID, From: e.From, To: e.To,
			Decision: e.Decision, Condition: e.Condition, IsDefault: e.IsDefault,
		})
	}
	b, err := json.Marshal(summary)
	if err != nil {
		// A definition that passed validation always marshals. An
		// empty object keeps the prompt template valid.
		return []byte("{}")
	}
	return b
}

// fieldPair is one field value of a model answer: field is the
// field name, value is the JSON text of the value (for example
// "80000", "\"Eric\"", "[\"a\"]", "true").
type fieldPair struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

// generatedStep is one step of a model answer. The schema requires
// the four fields; the handler reads null as absent.
type generatedStep struct {
	Type         string      `json:"type"`
	Values       []fieldPair `json:"values"`
	Decision     *string     `json:"decision"`
	DocumentHash *string     `json:"document_hash"`
}

// generatedCase is one case of a model answer.
type generatedCase struct {
	TargetEdge string          `json:"target_edge"`
	Data       []fieldPair     `json:"data"`
	Steps      []generatedStep `json:"steps"`
}

// pairMap turns one pair array into a field map: json.Unmarshal
// reads each value string as JSON text. A duplicate field name takes
// the last entry. An empty array gives an empty map. A value that is
// not JSON text gives the error of the pair.
func pairMap(pairs []fieldPair) (map[string]any, error) {
	m := map[string]any{}
	for _, p := range pairs {
		var v any
		if err := json.Unmarshal([]byte(p.Value), &v); err != nil {
			return nil, fmt.Errorf("field %s: invalid JSON value", p.Field)
		}
		m[p.Field] = v
	}
	return m, nil
}

// createdCaseDTO is one entry of the created list of the answer.
type createdCaseDTO struct {
	CaseID     string `json:"case_id"`
	Reference  string `json:"reference"`
	TargetEdge string `json:"target_edge"`
}

// answerContent reads choices[0].message.content of one Chat
// Completions body. ok is false when the envelope has no content.
func answerContent(body []byte) (content string, ok bool) {
	var env struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return "", false
	}
	if len(env.Choices) == 0 {
		return "", false
	}
	return env.Choices[0].Message.Content, true
}

// generateTests generates test cases for the red edges of one
// version. It answers {"version_id","red_edges","created","errors"}.
func (d apiDeps) generateTests(w http.ResponseWriter, r *http.Request) {
	// 1. The body.
	var body struct {
		VersionID string `json:"version_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	// 2. The version.
	v, err := d.st.GetVersion(r.Context(), body.VersionID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// 3. The definition.
	def, err := process.Decode(v.Definition)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	// 4. The red edges: the test cases of the version and their
	// events, then the coverage report.
	cs, err := d.st.ListCases(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	eventsByCase := map[string][]engine.Event{}
	for _, c := range cs {
		if c.VersionID != body.VersionID || !c.IsTest {
			continue
		}
		events, err := d.st.ListEvents(r.Context(), c.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal",
				"cannot complete the request")
			return
		}
		eventsByCase[c.ID] = events
	}
	red := coverage.OfCases(def, eventsByCase).Red()
	if red == nil {
		// A nil slice would marshal as null. The answer shape of the
		// brief holds [].
		red = []string{}
	}

	resp := struct {
		VersionID string           `json:"version_id"`
		RedEdges  []string         `json:"red_edges"`
		Created   []createdCaseDTO `json:"created"`
		Errors    []string         `json:"errors"`
	}{
		VersionID: body.VersionID,
		RedEdges:  red,
		Created:   []createdCaseDTO{},
		Errors:    []string{},
	}
	// 5. No red edge: the answer needs no AI call.
	if len(red) == 0 {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	// 6. The client, once. The messages carry the prompt constants.
	cfg := ai.LoadConfig()
	client := ai.New(cfg)
	redJSON, err := json.Marshal(red)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	messages := []ai.Message{
		{Role: "system", Content: ai.GenerateTestsSystem},
		{Role: "user", Content: fmt.Sprintf(ai.GenerateTestsUser,
			processSummary(def), redJSON)},
	}
	// 7. The repair loop, at most 3 attempts. attemptErrs feeds the
	// repair messages; the answer errors hold them only when every
	// attempt failed (a success drops them).
	var attemptErrs []string
	for attempt := 1; attempt <= 3; attempt++ {
		ansBody, err := client.ChatCompletion(r.Context(), messages,
			"generate_tests", generateTestsSchema())
		if err != nil {
			writeAIError(w, err)
			return
		}
		content, ok := answerContent(ansBody)
		var cases struct {
			Cases []json.RawMessage `json:"cases"`
		}
		if ok {
			err = json.Unmarshal([]byte(content), &cases)
		}
		if !ok || err != nil || cases.Cases == nil {
			attemptErrs = append(attemptErrs, fmt.Sprintf(
				"attempt %d: the answer does not match the schema", attempt))
			messages = append(messages,
				ai.Message{Role: "assistant", Content: content},
				ai.Message{Role: "user", Content: fmt.Sprintf(
					ai.GenerateTestsRepair, strings.Join(attemptErrs, "; "))})
			continue
		}
		// The answer fits: run each case.
		for i, raw := range cases.Cases {
			var gc generatedCase
			if err := json.Unmarshal(raw, &gc); err != nil {
				resp.Errors = append(resp.Errors, fmt.Sprintf(
					"case %d: the answer does not match the schema", i+1))
				continue
			}
			if !slices.Contains(red, gc.TargetEdge) {
				resp.Errors = append(resp.Errors, fmt.Sprintf(
					"case %d: target %s is not red", i+1, gc.TargetEdge))
				continue
			}
			c, err := d.st.CreateCase(r.Context(), body.VersionID, true)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal",
					"cannot complete the request")
				return
			}
			events, drop := simulateGenerated(def, c, gc, i+1, genTestStart)
			if drop != "" {
				resp.Errors = append(resp.Errors, drop)
				continue
			}
			if err := d.st.AppendEvents(r.Context(), c.ID, events); err != nil {
				writeError(w, http.StatusInternalServerError, "internal",
					"cannot complete the request")
				return
			}
			resp.Created = append(resp.Created, createdCaseDTO{
				CaseID: c.ID, Reference: c.Reference, TargetEdge: gc.TargetEdge,
			})
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}
	// 7b. Three failed attempts: the errors go back to the user.
	resp.Errors = attemptErrs
	writeJSON(w, http.StatusOK, resp)
}

// simulatedSource serves the test values of a source: each generated
// case is a test case.
var simulatedSource engine.SourceFetcher = func(_ context.Context, src process.Source) (map[string]any, error) {
	return sources.Simulated(src), nil
}

// genTestStart is the fixed start time of the simulated commands.
// One minute per command follows; the generator needs no wall times.
var genTestStart = time.Date(2026, 10, 27, 8, 0, 0, 0, time.UTC)

// simulateGenerated runs one generated case on the definition: the
// start command, then each step, folded between the calls. i is the
// 1-based index of the case in the model answer; the drop texts
// carry it. It returns the events, or the drop text of the case.
func simulateGenerated(def process.Definition, c store.Case,
	gc generatedCase, i int, t0 time.Time) ([]engine.Event, string,
) {
	drop := func(format string, args ...any) ([]engine.Event, string) {
		return nil, fmt.Sprintf(format, args...)
	}
	// The pairs of the start data become the field map first: a bad
	// value drops the case.
	data, err := pairMap(gc.Data)
	if err != nil {
		return drop("case %d: %s", i, err)
	}
	// The start command, with the real case id.
	at := t0
	events, err := engine.HandleWithSources(context.Background(), def, engine.State{}, engine.Start{
		CaseID: c.ID, VersionID: c.VersionID, Actor: "system", Data: data,
	}, at, simulatedSource)
	if err != nil {
		return drop("case %d: %s", i, err)
	}
	all := events
	// Each step, folded against the events so far.
	for j, s := range gc.Steps {
		at = t0.Add(time.Duration(j+1) * time.Minute)
		st, err := engine.Fold(def, all)
		if err != nil {
			return drop("case %d: step %d: %s", i, j+1, err)
		}
		var cmd engine.Command
		switch s.Type {
		case "submit":
			values, err := pairMap(s.Values)
			if err != nil {
				return drop("case %d: step %d: %s", i, j+1, err)
			}
			cmd = engine.Submit{Actor: "system", Values: values}
		case "decide":
			decision := ""
			if s.Decision != nil {
				decision = *s.Decision
			}
			cmd = engine.Decide{Actor: "system", Decision: decision}
		case "sign":
			hash := ""
			if s.DocumentHash != nil {
				hash = *s.DocumentHash
			}
			cmd = engine.Sign{Actor: "system", DocumentHash: hash}
		default:
			return drop("case %d: step %d: unknown step type %s", i, j+1, s.Type)
		}
		events, err := engine.HandleWithSources(context.Background(), def, st, cmd, at, simulatedSource)
		if err != nil {
			return drop("case %d: step %d: %s", i, j+1, err)
		}
		all = append(all, events...)
	}
	// The case must have taken its target edge.
	taken := map[string]bool{}
	for _, e := range all {
		if e.Type != engine.EventEdgeTaken {
			continue
		}
		var p engine.EdgeTakenPayload
		_ = json.Unmarshal(e.Payload, &p)
		taken[p.EdgeID] = true
	}
	if !taken[gc.TargetEdge] {
		return drop("case %d: edge %s not reached", i, gc.TargetEdge)
	}
	return all, ""
}
