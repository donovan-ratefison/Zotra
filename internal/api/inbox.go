package api

// The inbox route: the open cases that wait for a role of the user.

import (
	"log/slog"
	"net/http"
	"slices"

	"github.com/donovan-ratefison/zotra/internal/engine"
)

// inboxCase is one case of the inbox answer: the case shape plus the
// waiting node and the case status.
type inboxCase struct {
	caseDTO
	NodeID string `json:"node_id"`
	Status string `json:"status"`
}

// listInbox answers the user and its open cases. Cases with no
// events wait for start and never appear. A case that cannot fold is
// skipped, so the inbox stays usable. Test cases are out.
func (d apiDeps) listInbox(w http.ResponseWriter, r *http.Request) {
	user, ok := userOf(w, r, d.st)
	if !ok {
		return
	}
	cases, err := d.st.ListCases(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	items := []inboxCase{}
	for _, c := range cases {
		if c.IsTest {
			continue
		}
		def, _, st, err := d.foldCaseState(r.Context(), c)
		if err != nil {
			slog.Warn("inbox: skip case", "case", c.ID, "error", err)
			continue
		}
		if st.Status != engine.StatusOpen {
			continue
		}
		for _, node := range def.Nodes {
			if node.ID == st.NodeID && node.Role != nil &&
				slices.Contains(user.RoleIDs, *node.Role) {
				items = append(items, inboxCase{
					caseDTO: toCaseDTO(c),
					NodeID:  st.NodeID,
					Status:  st.Status,
				})
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":       user.ID,
			"name":     user.Name,
			"role_ids": user.RoleIDs,
		},
		"cases": items,
	})
}
