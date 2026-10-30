// Package engine runs a case on a process definition. Commands become
// a hash-chained event log (Handle), the state is rebuilt from the
// log (Fold), and the chain is checked (Verify).
package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"
)

// Types of the events of the case log.
const (
	EventCaseCreated    = "case_created"
	EventStepEntered    = "step_entered"
	EventEdgeTaken      = "edge_taken"
	EventStepAssigned   = "step_assigned"
	EventDataSubmitted  = "data_submitted"
	EventCheckEvaluated = "check_evaluated"
	EventDecisionMade   = "decision_made"
	EventSignatureAdded = "signature_added"
	EventCaseClosed     = "case_closed"
	EventSourceFetched  = "source_fetched"
)

// Event is one entry of the append-only case log. The field order
// fixes the canonical JSON.
type Event struct {
	CaseID   string          `json:"case_id"`
	Seq      int             `json:"seq"`
	Type     string          `json:"type"`
	At       time.Time       `json:"at"`
	Actor    string          `json:"actor"`
	Payload  json.RawMessage `json:"payload"`
	PrevHash string          `json:"prev_hash"`
	Hash     string          `json:"hash"`
}

// One payload struct per event type. The field order fixes the JSON
// key order of the payload.

type CaseCreatedPayload struct {
	VersionID string         `json:"version_id"`
	Data      map[string]any `json:"data"`
}

type StepEnteredPayload struct {
	NodeID string `json:"node_id"`
}

type EdgeTakenPayload struct {
	EdgeID string `json:"edge_id"`
}

type StepAssignedPayload struct {
	NodeID string `json:"node_id"`
	UserID string `json:"user_id"`
}

type DataSubmittedPayload struct {
	NodeID string         `json:"node_id"`
	Values map[string]any `json:"values"`
}

type CheckEvaluatedPayload struct {
	NodeID  string  `json:"node_id"`
	CheckID string  `json:"check_id"`
	Result  bool    `json:"result"`
	Error   *string `json:"error"`
}

type DecisionMadePayload struct {
	NodeID   string `json:"node_id"`
	Decision string `json:"decision"`
}

type SignatureAddedPayload struct {
	NodeID       string `json:"node_id"`
	UserID       string `json:"user_id"`
	DocumentHash string `json:"document_hash"`
}

type CaseClosedPayload struct {
	NodeID string `json:"node_id"`
	Result string `json:"result"`
}

type SourceFetchedPayload struct {
	NodeID   string         `json:"node_id"`
	SourceID string         `json:"source_id"`
	Values   map[string]any `json:"values"`
}

// ZeroHash is the prev_hash of the first event.
const ZeroHash = "0000000000000000000000000000000000000000000000000000000000000000"

// CanonicalJSON marshals the event without the hash field, with the
// field order of the struct. The payload passes through as raw bytes,
// so a store round trip keeps the canonical form stable. Map keys
// inside the payload are sorted by encoding/json.
func CanonicalJSON(e Event) []byte {
	wire := struct {
		CaseID   string          `json:"case_id"`
		Seq      int             `json:"seq"`
		Type     string          `json:"type"`
		At       time.Time       `json:"at"`
		Actor    string          `json:"actor"`
		Payload  json.RawMessage `json:"payload"`
		PrevHash string          `json:"prev_hash"`
	}{
		e.CaseID, e.Seq, e.Type, e.At, e.Actor, e.Payload, e.PrevHash,
	}
	b, err := json.Marshal(wire)
	if err != nil {
		// Only an invalid Payload can fail. An event that this package
		// produced always carries a marshaled payload. The canonical
		// form of a broken payload is an empty JSON object.
		return []byte("{}")
	}
	return b
}

// HashEvent returns the sha256 hex of PrevHash + "\n" + CanonicalJSON.
func HashEvent(e Event) string {
	raw := append([]byte(e.PrevHash), '\n')
	raw = append(raw, CanonicalJSON(e)...)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Verify recomputes the hash chain and returns the first bad seq, or
// 0. Bad means: seq is not 1, 2, 3..., prev_hash is not the hash of
// the previous event (ZeroHash for the first), or hash is not the hash
// of the event. An empty slice gives 0.
func Verify(events []Event) int {
	prev := ZeroHash
	for i, e := range events {
		want := i + 1
		if e.Seq != want || e.PrevHash != prev || e.Hash != HashEvent(e) {
			return want
		}
		prev = e.Hash
	}
	return 0
}

// newEvent chains a new event on the last event of the state.
func newEvent(st State, at time.Time, actor, typ string, payload any) Event {
	raw, err := json.Marshal(payload)
	if err != nil {
		// The payload types of this package and decoded JSON values
		// always marshal. A broken payload becomes an empty object.
		raw = json.RawMessage("{}")
	}
	prev := st.PrevHash
	if st.Seq == 0 {
		prev = ZeroHash
	}
	e := Event{
		CaseID:   st.CaseID,
		Seq:      st.Seq + 1,
		Type:     typ,
		At:       at.UTC(),
		Actor:    actor,
		Payload:  raw,
		PrevHash: prev,
	}
	e.Hash = HashEvent(e)
	return e
}
