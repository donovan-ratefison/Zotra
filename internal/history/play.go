package history

import (
	"cmp"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/donovan-ratefison/zotra/internal/engine"
	"github.com/donovan-ratefison/zotra/internal/process"
	"github.com/donovan-ratefison/zotra/internal/sources"
	"github.com/donovan-ratefison/zotra/internal/store"
)

//go:embed scans/*.png
var scans embed.FS

// Play writes each plan as one real case of the version, through the engine, with the
// times of the plan. The sources give their simulated values. A plan that does not reach
// its node or result is an error.
func Play(ctx context.Context, st *store.Store, versionID string, plans []Case) error {
	v, err := st.GetVersion(ctx, versionID)
	if err != nil {
		return err
	}
	def, err := process.Decode(v.Definition)
	if err != nil {
		return err
	}
	// The references follow the times only if the cases start in time order.
	plans = slices.Clone(plans)
	slices.SortStableFunc(plans, func(a, b Case) int { return a.Visits[0].Enter.Compare(b.Visits[0].Enter) })
	for _, p := range plans {
		if err := playCase(ctx, st, def, versionID, p); err != nil {
			return err
		}
	}
	return nil
}

func playCase(ctx context.Context, st *store.Store, def process.Definition, versionID string, p Case) error {
	start := p.Visits[0].Enter
	c, err := st.CreateCaseAt(ctx, versionID, false, start)
	if err != nil {
		return err
	}
	fetch := func(_ context.Context, src process.Source) (map[string]any, error) {
		return sources.Simulated(src), nil
	}
	var events []engine.Event
	var state engine.State
	do := func(cmd engine.Command, at time.Time) error {
		next, err := engine.HandleWithSources(ctx, def, state, cmd, at, fetch)
		if err == nil {
			err = st.AppendEvents(ctx, c.ID, next)
		}
		if err == nil {
			events = append(events, next...)
			state, err = engine.Fold(def, events)
		}
		if err != nil {
			return fmt.Errorf("case %s: %w", c.Reference, err)
		}
		return nil
	}
	if err := do(engine.Start{CaseID: c.ID, VersionID: c.VersionID, Actor: "u-advisor", Data: p.Data}, start); err != nil {
		return err
	}
	lastSHA := ""
	last := p.Visits[len(p.Visits)-1]
	for _, v := range p.Visits {
		if state.NodeID != v.Node {
			return fmt.Errorf("case %s: at %s, want %s", c.Reference, state.NodeID, v.Node)
		}
		i := slices.IndexFunc(def.Nodes, func(n process.Node) bool { return n.ID == v.Node })
		node := def.Nodes[i]
		actor := "u-" + *node.Role
		if !v.Take.IsZero() {
			if err := do(engine.Take{Actor: actor}, v.Take); err != nil {
				return err
			}
		}
		if v.Act.IsZero() {
			break
		}
		values := maps.Clone(v.Values)
		ids := []any{}
		for k, name := range node.Documents {
			b, err := scans.ReadFile("scans/" + name + ".png")
			if err != nil {
				return err
			}
			sum := sha256.Sum256(b)
			lastSHA = hex.EncodeToString(sum[:])
			d, err := st.SaveDocumentAt(ctx, &c.ID, name+".png", "image/png", lastSHA, b,
				v.Take.Add(time.Duration(k+1)*time.Minute))
			if err != nil {
				return fmt.Errorf("case %s: %w", c.Reference, err)
			}
			ids = append(ids, d.ID)
		}
		if v.Node == "entry" {
			values["documents"] = ids
		}
		if node.Signature {
			if err := do(engine.Sign{Actor: actor, DocumentHash: lastSHA}, v.Act); err != nil {
				return err
			}
		}
		if err := do(engine.Submit{Actor: actor, Values: values}, v.Act); err != nil {
			return err
		}
		if v.Decision != "" {
			if err := do(engine.Decide{Actor: actor, Decision: v.Decision}, v.Act); err != nil {
				return err
			}
		}
	}
	if p.Result != "" {
		if state.Status != engine.StatusClosed || state.Result != p.Result {
			return fmt.Errorf("case %s: result %s, want %s", c.Reference, cmp.Or(state.Result, state.Status), p.Result)
		}
	} else if state.Status != engine.StatusOpen || state.NodeID != last.Node {
		return fmt.Errorf("case %s: at %s, want %s", c.Reference, state.NodeID, last.Node)
	}
	return nil
}
