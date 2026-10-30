package api

// The case routes: create, state, events, commands, verify.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/sources"
	"github.com/donovan-ratefison/zotra/internal/store"
)

// caseDTO is the JSON shape of one case.
type caseDTO struct {
	ID        string    `json:"id"`
	VersionID string    `json:"version_id"`
	Reference string    `json:"reference"`
	IsTest    bool      `json:"is_test"`
	CreatedAt time.Time `json:"created_at"`
}

func toCaseDTO(c store.Case) caseDTO {
	return caseDTO{
		ID:        c.ID,
		VersionID: c.VersionID,
		Reference: c.Reference,
		IsTest:    c.IsTest,
		CreatedAt: c.CreatedAt,
	}
}

// userOf reads the X-Zotra-User header and loads the user. It writes
// the error answer itself and returns false then.
func userOf(w http.ResponseWriter, r *http.Request, st *store.Store) (store.User, bool) {
	id := r.Header.Get("X-Zotra-User")
	if id == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized",
			"the X-Zotra-User header is required")
		return store.User{}, false
	}
	u, err := st.UserByID(r.Context(), id)
	if err != nil {
		// user <id> does not exist maps to 403 unknown user <id>.
		writeStoreError(w, err)
		return store.User{}, false
	}
	return u, true
}

// zeroState is the state of a case with no events. The case waits
// for start.
func zeroState(c store.Case) engine.State {
	return engine.State{
		CaseID:   c.ID,
		Status:   engine.StatusOpen,
		Data:     map[string]any{},
		Sources:  map[string]map[string]any{},
		PrevHash: engine.ZeroHash,
	}
}

// foldCaseState loads and folds one case: the version, the decoded
// definition, the events, the state. A case with no events gets the
// zero state. It returns the error; the callers map it to their
// answers.
func (d apiDeps) foldCaseState(ctx context.Context, c store.Case) (
	process.Definition, []engine.Event, engine.State, error,
) {
	v, err := d.st.GetVersion(ctx, c.VersionID)
	if err != nil {
		return process.Definition{}, nil, engine.State{}, err
	}
	def, err := process.Decode(v.Definition)
	if err != nil {
		return process.Definition{}, nil, engine.State{}, err
	}
	events, err := d.st.ListEvents(ctx, c.ID)
	if err != nil {
		return process.Definition{}, nil, engine.State{}, err
	}
	if len(events) == 0 {
		return def, events, zeroState(c), nil
	}
	st, err := engine.Fold(def, events)
	if err != nil {
		return process.Definition{}, nil, engine.State{}, err
	}
	return def, events, st, nil
}

// loadCaseState loads one case for a route. It writes the error
// answer itself and returns false then.
func (d apiDeps) loadCaseState(w http.ResponseWriter, r *http.Request, caseID string) (
	store.Case, process.Definition, []engine.Event, engine.State, bool,
) {
	c, err := d.st.GetCase(r.Context(), caseID)
	if err != nil {
		writeStoreError(w, err)
		return store.Case{}, process.Definition{}, nil, engine.State{}, false
	}
	def, events, st, err := d.foldCaseState(r.Context(), c)
	if err != nil {
		// An absent version maps to 404, a decode or fold error to
		// 500 internal.
		writeStoreError(w, err)
		return store.Case{}, process.Definition{}, nil, engine.State{}, false
	}
	return c, def, events, st, true
}

// createCase answers 201 {"case":{...}}. The body takes version_id
// and is_test only: the case data enters through the start command.
func (d apiDeps) createCase(w http.ResponseWriter, r *http.Request) {
	var body struct {
		VersionID string `json:"version_id"`
		IsTest    bool   `json:"is_test"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	c, err := d.st.CreateCase(r.Context(), body.VersionID, body.IsTest)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"case": toCaseDTO(c)})
}

// readCase answers {"case":{...},"state":{...}}. The optional at
// query is a count of events: the state folds the first at events.
func (d apiDeps) readCase(w http.ResponseWriter, r *http.Request) {
	c, def, events, st, ok := d.loadCaseState(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	if at := r.URL.Query().Get("at"); at != "" {
		n, err := strconv.Atoi(at)
		if err != nil || n < 0 || n > len(events) {
			writeError(w, http.StatusBadRequest, "invalid_query",
				fmt.Sprintf("at must hold 0 to %d", len(events)))
			return
		}
		if n == 0 {
			// Fold refuses an empty slice: the zero state needs no call.
			st = zeroState(c)
		} else {
			prefix, err := engine.Fold(def, events[:n])
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal",
					"cannot complete the request")
				return
			}
			st = prefix
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"case": toCaseDTO(c), "state": st})
}

// listEvents answers {"events":[...]} in seq order.
func (d apiDeps) listEvents(w http.ResponseWriter, r *http.Request) {
	c, err := d.st.GetCase(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	events, err := d.st.ListEvents(r.Context(), c.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if events == nil {
		events = []engine.Event{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

// verifyCase answers {"verify":<n>}: 0 means the chain is intact.
func (d apiDeps) verifyCase(w http.ResponseWriter, r *http.Request) {
	c, err := d.st.GetCase(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	events, err := d.st.ListEvents(r.Context(), c.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"verify": engine.Verify(events)})
}

// commandBody is the body of one command call.
type commandBody struct {
	Type         string         `json:"type"`
	Data         map[string]any `json:"data"`
	Values       map[string]any `json:"values"`
	Decision     string         `json:"decision"`
	DocumentHash string         `json:"document_hash"`
}

// commandTypes is the type of the commands that carry the role check.
var commandTypes = []string{"take", "submit", "decide", "sign"}

// runCommand runs one command: the user, the case state, the role
// check, the engine, the log, and the new events with the new state.
func (d apiDeps) runCommand(w http.ResponseWriter, r *http.Request) {
	// 1. The user.
	user, ok := userOf(w, r, d.st)
	if !ok {
		return
	}
	// 2. The case and its state.
	c, def, events, st, ok := d.loadCaseState(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	// 3. The command body. It parses before the role check, because
	// the type decides whether the check runs.
	var body commandBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", msgInvalidJSON)
		return
	}
	// 4. The role check. It runs only on a node with a role, so the
	// engine answers for a fresh case and for a closed case.
	if slices.Contains(commandTypes, body.Type) {
		for _, node := range def.Nodes {
			if node.ID == st.NodeID && node.Role != nil &&
				!slices.Contains(user.RoleIDs, *node.Role) {
				writeError(w, http.StatusForbidden, "forbidden",
					fmt.Sprintf("step %s waits for role %s", node.ID, *node.Role))
				return
			}
		}
	}
	// 5. The engine command.
	var cmd engine.Command
	switch body.Type {
	case "start":
		cmd = engine.Start{CaseID: c.ID, VersionID: c.VersionID, Actor: user.ID, Data: body.Data}
	case "take":
		cmd = engine.Take{Actor: user.ID}
	case "submit":
		cmd = engine.Submit{Actor: user.ID, Values: body.Values}
	case "decide":
		if body.Decision == "" {
			writeError(w, http.StatusBadRequest, "invalid_command", "decision is required")
			return
		}
		cmd = engine.Decide{Actor: user.ID, Decision: body.Decision}
	case "sign":
		if body.DocumentHash == "" {
			writeError(w, http.StatusBadRequest, "invalid_command", "document hash is required")
			return
		}
		cmd = engine.Sign{Actor: user.ID, DocumentHash: body.DocumentHash}
	default:
		writeError(w, http.StatusBadRequest, "invalid_command",
			fmt.Sprintf("unknown command type %s", body.Type))
		return
	}
	// 6. The event time. The store keeps microseconds.
	at := time.Now().UTC().Truncate(time.Microsecond)
	// 7. The engine. A test case reads the simulated values of the
	// sources, a real case reads the network.
	fetch := func(ctx context.Context, src process.Source) (map[string]any, error) {
		if c.IsTest {
			return sources.Simulated(src), nil
		}
		return sources.Fetch(ctx, src)
	}
	newEvents, err := engine.HandleWithSources(r.Context(), def, st, cmd, at, fetch)
	if err != nil {
		var fe *engine.SourceFetchError
		if errors.As(err, &fe) {
			writeError(w, http.StatusBadGateway, "source_unavailable", err.Error())
			return
		}
		writeError(w, http.StatusConflict, "conflict", err.Error())
		return
	}
	// 8. The log.
	if err := d.st.AppendEvents(r.Context(), c.ID, newEvents); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "cannot store the events")
		return
	}
	// 9. The new events and the new state.
	all := append(slices.Clone(events), newEvents...)
	finalState, err := engine.Fold(def, all)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal",
			"cannot complete the request")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": newEvents, "state": finalState})
}
