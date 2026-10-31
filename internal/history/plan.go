// Package history plans and plays fictitious real cases of the example process.
package history

import (
	"math"
	"math/rand/v2"
	"time"
)

// Visit is one pass of a case on a task node.
type Visit struct {
	Node     string         // task node id
	Decision string         // "" for a node without decisions and for the open visit
	Values   map[string]any // submit values; nil for the open visit
	Enter    time.Time      // time of the step_entered event
	Take     time.Time      // zero: nobody takes the step
	Act      time.Time      // submit and decide time; zero for the open visit
}

// Case is the plan of one case. Visits[0].Enter is the start time.
type Case struct {
	Data   map[string]any // start data
	Visits []Visit
	Result string // "approved", "refused", or "" for an open case
	Late   bool   // open case: the open step is above its deadline at now
}

const seed = 1

var eat = time.FixedZone("EAT", 3*3600)

// tasks are the task nodes of the example process, in path order.
var tasks = []struct {
	id       string
	deadline int // hours
}{{"entry", 24}, {"analysis", 48}, {"decision", 24}, {"offer", 48}, {"signing", 72}, {"release", 24}}

func deadline(node string) int {
	for _, t := range tasks {
		if t.id == node {
			return t.deadline
		}
	}
	return 0
}

var (
	firstNames  = []string{"Hery", "Voahangy", "Faly", "Miora", "Tiana", "Andry", "Lalao", "Haingo", "Rivo", "Nirina", "Fanja", "Toky"}
	lastNames   = []string{"Rakotomalala", "Randrianarisoa", "Rasoanaivo", "Andriamahefa", "Razafindrakoto", "Rabemananjara", "Ratsimba", "Rakotondrabe", "Ravelojaona", "Andrianjafy", "Rajaonarison", "Raharimanana"}
	professions = []string{"Teacher", "Nurse", "Engineer", "Accountant", "Shop owner", "Doctor", "Civil servant", "Farmer", "Driver", "Pharmacist"}
	durations   = []int{120, 180, 240, 300}
	rates       = []float64{0.035, 0.04, 0.045, 0.05}
)

// Case kinds.
const (
	released = iota
	returned
	refusedAnalysis
	refusedDecision
	open
)

// Plan plans n cases from now minus days to now. The seed is fixed,
// so the same n, days and now give the same plan. days must be positive.
func Plan(n, days int, now time.Time) []Case {
	r := rand.New(rand.NewPCG(seed, 0))
	now = now.UTC().Truncate(time.Second)
	cases := []Case{}
	m := 0
	for i := 0; i < n; i++ {
		kind := released
		switch j := i % 20; {
		case j%4 == 0:
			kind = open
		case j == 1 || j == 11:
			kind = returned
		case j == 5:
			kind = refusedAnalysis
		case j == 15:
			kind = refusedDecision
		}
		if kind != open {
			cases = append(cases, closedCase(r, kind, days, now))
			continue
		}
		cases = append(cases, openCase(r, m, now))
		m++
	}
	return cases
}

func closedCase(r *rand.Rand, kind, days int, now time.Time) Case {
	data := drawData(r, kind == returned || kind == refusedDecision)
	c := Case{Data: data, Result: "approved"}
	switch kind {
	case released:
		c.Visits = releasedPath(data["amount"].(float64))
	case returned:
		c.Visits = returnedPath()
	case refusedAnalysis:
		c.Visits = []Visit{work("entry"), {Node: "analysis", Decision: "unfavorable", Values: map[string]any{
			"analysis_opinion": "unfavorable", "analysis_comment": "The profile does not match the credit policy."}}}
		c.Result = "refused"
	case refusedDecision:
		c.Visits = []Visit{work("entry"), favorable(""), decide("refuse")}
		c.Result = "refused"
	}
	at := nextWork(now.Add(-time.Duration(r.IntN(days*24*60)) * time.Minute))
	for k := range c.Visits {
		v := &c.Visits[k]
		v.Enter, v.Take = at, at.Add(30*time.Minute)
		v.Act = nextWork(at.Add(step(r, v.Node, 0.3, 1)))
		at = v.Act
	}
	if limit := now.Add(-time.Hour); at.After(limit) {
		shift := -(at.Sub(limit) + 24*time.Hour - 1) / (24 * time.Hour) * 24 * time.Hour
		for k := range c.Visits {
			v := &c.Visits[k]
			v.Enter, v.Take, v.Act = v.Enter.Add(shift), v.Take.Add(shift), v.Act.Add(shift)
		}
	}
	if last := &c.Visits[len(c.Visits)-1]; last.Node == "release" {
		last.Values = map[string]any{"release_date": last.Act.Add(48 * time.Hour).UTC().Format("2006-01-02")}
	}
	return c
}

func openCase(r *rand.Rand, m int, now time.Time) Case {
	node := tasks[m%6].id
	late := m%5 == 2
	wasReturned := node == "analysis" && (m/6)%2 == 1
	data := drawData(r, node == "decision" || wasReturned)
	path := releasedPath(data["amount"].(float64))
	if wasReturned {
		path = returnedPath()[:4]
	} else {
		for k, v := range path {
			if v.Node == node {
				path = path[:k+1]
				break
			}
		}
	}
	path[len(path)-1] = Visit{Node: node}
	dl := deadline(node)
	a := step(r, node, 0.05, 0.2)
	if late {
		a = step(r, node, 1.2, 0.6)
	}
	at := prevWork(now.Add(-a))
	path[len(path)-1].Enter = at
	if late || dl >= 48 {
		path[len(path)-1].Take = at.Add(30 * time.Minute)
	}
	for k := len(path) - 2; k >= 0; k-- {
		v := &path[k]
		v.Act = at
		v.Enter = prevWork(at.Add(-step(r, v.Node, 0.3, 1)))
		v.Take = v.Enter.Add(30 * time.Minute)
		at = v.Enter
	}
	return Case{Data: data, Visits: path, Late: late}
}

// step draws deadline x (low + width x u) of a node, in whole minutes.
func step(r *rand.Rand, node string, low, width float64) time.Duration {
	h := float64(deadline(node)) * (low + width*r.Float64())
	return time.Duration(math.Round(h*60)) * time.Minute
}

func work(node string) Visit { return Visit{Node: node, Values: map[string]any{}} }

func favorable(comment string) Visit {
	if comment == "" {
		comment = "Stable income, the payment fits the budget."
	}
	return Visit{Node: "analysis", Decision: "favorable", Values: map[string]any{
		"analysis_opinion": "favorable", "analysis_comment": comment}}
}

func decide(x string) Visit {
	return Visit{Node: "decision", Decision: x, Values: map[string]any{"credit_decision": x}}
}

// releasedPath is the path without return. The decision step comes only above 100000.
func releasedPath(amount float64) []Visit {
	p := []Visit{work("entry"), favorable("")}
	if amount > 100000 {
		p = append(p, decide("approve"))
	}
	return append(p, work("offer"), work("signing"), Visit{Node: "release"})
}

func returnedPath() []Visit {
	return []Visit{work("entry"), favorable(""), decide("return"), favorable("Guarantee checked after the return."),
		decide("approve"), work("offer"), work("signing"), {Node: "release"}}
}

// drawData draws start data whose debt ratio is 0.30 or less.
func drawData(r *rand.Rand, high bool) map[string]any {
	amount := float64(40000 + 1000*r.IntN(211))
	if high {
		amount = float64(110000 + 1000*r.IntN(141))
	}
	name := firstNames[r.IntN(len(firstNames))] + " " + lastNames[r.IntN(len(lastNames))]
	profession := professions[r.IntN(len(professions))]
	months := durations[r.IntN(len(durations))]
	rate := rates[r.IntN(len(rates))]
	down := math.Round(amount*(0.1+0.2*r.Float64())/1000) * 1000
	monthly := rate / 12
	payment := amount * monthly / (1 - math.Pow(1+monthly, -float64(months)))
	income := math.Ceil(payment/(0.18+0.12*r.Float64())/10) * 10
	return map[string]any{"client_name": name, "profession": profession, "amount": amount,
		"duration_months": months, "down_payment": down, "annual_rate": rate, "monthly_income": income}
}

// nextWork moves a time out of hours forward to the next working hours (08:00 to 17:00 EAT).
func nextWork(t time.Time) time.Time {
	switch h := t.In(eat).Hour(); {
	case h < 8:
		return t.Add(time.Duration(8-h) * time.Hour)
	case h >= 17:
		return t.Add(time.Duration(32-h) * time.Hour)
	}
	return t
}

// prevWork moves a time out of hours back to the last working hours (16:00 to 17:00 EAT).
func prevWork(t time.Time) time.Time {
	switch h := t.In(eat).Hour(); {
	case h >= 17:
		return t.Add(-time.Duration(h-16) * time.Hour)
	case h < 8:
		return t.Add(-time.Duration(h+8) * time.Hour)
	}
	return t
}
