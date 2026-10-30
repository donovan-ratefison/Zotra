package api

// The version routes: read, update a draft, validate, lifecycle.

import (
	"encoding/json"
	"net/http"

	"github.com/donovan-ratefison/zotra/internal/docs"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/rules"
)

// readVersion answers 200 {"version":{...}}.
func (d apiDeps) readVersion(w http.ResponseWriter, r *http.Request) {
	v, err := d.st.GetVersion(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": toVersionDTO(v)})
}

// updateVersion changes the definition of a draft. It answers with
// the stored version, so the bytes come back from the database.
func (d apiDeps) updateVersion(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
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
	if err := d.st.UpdateDraft(r.Context(), id, body.Definition); err != nil {
		writeStoreError(w, err)
		return
	}
	d.answerVersion(w, r, id, http.StatusOK)
}

// validateVersion runs the validator on the stored definition. The
// errors are data: a broken definition still answers 200.
func (d apiDeps) validateVersion(w http.ResponseWriter, r *http.Request) {
	v, err := d.st.GetVersion(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	errs := rules.ValidateDocument(v.Definition)
	writeJSON(w, http.StatusOK, map[string]any{"errors": errs})
}

// answerVersion reads the version and answers with the wrapper.
func (d apiDeps) answerVersion(w http.ResponseWriter, r *http.Request, id string, status int) {
	v, err := d.st.GetVersion(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, status, map[string]any{"version": toVersionDTO(v)})
}

// freezeVersion moves a draft to frozen.
func (d apiDeps) freezeVersion(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := d.st.Freeze(r.Context(), id); err != nil {
		writeStoreError(w, err)
		return
	}
	d.answerVersion(w, r, id, http.StatusOK)
}

// publishVersion moves a frozen version to published.
func (d apiDeps) publishVersion(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := d.st.Publish(r.Context(), id); err != nil {
		writeStoreError(w, err)
		return
	}
	d.answerVersion(w, r, id, http.StatusOK)
}

// forkVersion creates a draft from a version of any status.
func (d apiDeps) forkVersion(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Label string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	v, err := d.st.Fork(r.Context(), r.PathValue("id"), body.Label)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"version": toVersionDTO(v)})
}

// versionMarkdown answers the documentation of a version in Markdown.
func (d apiDeps) versionMarkdown(w http.ResponseWriter, r *http.Request) {
	d.writeDoc(w, r, "text/markdown; charset=utf-8", docs.Markdown)
}

// versionHTML answers the documentation of a version as a printable
// HTML page.
func (d apiDeps) versionHTML(w http.ResponseWriter, r *http.Request) {
	d.writeDoc(w, r, "text/html; charset=utf-8", docs.HTML)
}

// writeDoc generates the documentation from the stored definition at
// each request. A draft can hold a definition that does not decode.
func (d apiDeps) writeDoc(w http.ResponseWriter, r *http.Request, contentType string,
	render func(process.Definition) []byte) {
	id := r.PathValue("id")
	v, err := d.st.GetVersion(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	def, err := process.Decode(v.Definition)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot read the definition of version "+id)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(render(def))
}
