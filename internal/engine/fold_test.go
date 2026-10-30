package engine

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

// F1, F2.
func TestFoldSources(t *testing.T) {
	def := oneSourceDefinition(t)
	start := Start{CaseID: caseID, VersionID: versionID, Actor: "u-advisor",
		Data: map[string]any{"amount": 240000.0}}
	events, err := HandleWithSources(context.Background(), def, State{}, start,
		commandAt(9, 0), testValuesFetcher)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("F1 the state copy", func(t *testing.T) {
		st, err := Fold(def, events)
		if err != nil {
			t.Fatal(err)
		}
		want := map[string]map[string]any{"blacklist": {"listed": false}}
		if !reflect.DeepEqual(st.Sources, want) {
			t.Errorf("Sources = %v, want %v", st.Sources, want)
		}
		if st.NodeID != "entry" || st.Status != StatusOpen || st.Seq != 4 ||
			!reflect.DeepEqual(st.Data, map[string]any{"amount": 240000.0}) {
			t.Errorf("state = %+v, want open on entry at seq 4 with the amount", st)
		}
	})
	t.Run("F2 unknown source", func(t *testing.T) {
		bad := append([]Event(nil), events...)
		raw, err := json.Marshal(SourceFetchedPayload{NodeID: "entry", SourceID: "ghost",
			Values: map[string]any{}})
		if err != nil {
			t.Fatal(err)
		}
		bad[3].Payload = raw
		_, err = Fold(def, bad)
		if err == nil || err.Error() != "event 4: source ghost does not exist" {
			t.Errorf("Fold error = %v, want event 4: source ghost does not exist", err)
		}
	})
}
