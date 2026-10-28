package api

// The users route: the demo users for the role picker.

import (
	"net/http"

	"github.com/donovan-ratefison/zotra/internal/store"
)

// userDTO is the JSON shape of one user.
type userDTO struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	RoleIDs []string `json:"role_ids"`
}

// listUsers answers {"users":[...]} in store order.
func (d apiDeps) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := d.st.ListUsers(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if users == nil {
		users = []store.User{}
	}
	dtos := make([]userDTO, len(users))
	for i, u := range users {
		dtos[i] = userDTO{ID: u.ID, Name: u.Name, RoleIDs: u.RoleIDs}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": dtos})
}
