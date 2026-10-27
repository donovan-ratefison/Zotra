package api

// The process and version-of-process routes.

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/donovan-ratefison/zotra/internal/store"
)

// processDTO is the JSON shape of one process.
type processDTO struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// versionDTO is the JSON shape of one version. Definition embeds the
// stored JSON: json.RawMessage passes the bytes through, while a
// []byte would marshal base64.
type versionDTO struct {
	ID         string          `json:"id"`
	ProcessID  string          `json:"process_id"`
	ParentID   *string         `json:"parent_id"`
	Number     int             `json:"number"`
	Label      string          `json:"label"`
	Status     string          `json:"status"`
	Definition json.RawMessage `json:"definition"`
	CreatedAt  time.Time       `json:"created_at"`
	FrozenAt   *time.Time      `json:"frozen_at"`
}

func toProcessDTO(p store.Process) processDTO {
	return processDTO{ID: p.ID, Name: p.Name, CreatedAt: p.CreatedAt}
}

func toVersionDTO(v store.Version) versionDTO {
	return versionDTO{
		ID:         v.ID,
		ProcessID:  v.ProcessID,
		ParentID:   v.ParentID,
		Number:     v.Number,
		Label:      v.Label,
		Status:     v.Status,
		Definition: json.RawMessage(v.Definition),
		CreatedAt:  v.CreatedAt,
		FrozenAt:   v.FrozenAt,
	}
}

// listProcesses answers {"processes":[...]} in store order.
func (d apiDeps) listProcesses(w http.ResponseWriter, r *http.Request) {
	processes, err := d.st.ListProcesses(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	dtos := make([]processDTO, 0, len(processes))
	for _, p := range processes {
		dtos = append(dtos, toProcessDTO(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"processes": dtos})
}

// createProcess answers 201 {"process":{...}}.
func (d apiDeps) createProcess(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "name is required")
		return
	}
	p, err := d.st.CreateProcess(r.Context(), body.Name)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"process": toProcessDTO(p)})
}

// listVersions answers {"versions":[...]} in number order. It checks
// the process first: ListVersions gives an empty list for an unknown
// process, and the route must answer 404.
func (d apiDeps) listVersions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := d.st.ProcessByID(r.Context(), id); err != nil {
		writeStoreError(w, err)
		return
	}
	versions, err := d.st.ListVersions(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	dtos := make([]versionDTO, 0, len(versions))
	for _, v := range versions {
		dtos = append(dtos, toVersionDTO(v))
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": dtos})
}

// definitionBody is the body of the create and update version routes.
type definitionBody struct {
	Label      string          `json:"label"`
	Definition json.RawMessage `json:"definition"`
}

// definitionObject reports whether raw holds a JSON object. A missing
// definition, null and a non-object refuse.
func definitionObject(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return false
	}
	return m != nil
}

// createVersion answers 201 with the new draft.
func (d apiDeps) createVersion(w http.ResponseWriter, r *http.Request) {
	var body definitionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	if !definitionObject(body.Definition) {
		writeError(w, http.StatusBadRequest, "invalid_definition",
			"definition must be a JSON object")
		return
	}
	v, err := d.st.CreateVersion(r.Context(), r.PathValue("id"), nil,
		body.Label, body.Definition)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"version": toVersionDTO(v)})
}
