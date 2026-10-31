package history

import (
	"math"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/donovan-ratefison/zotra/internal/process"
)

var (
	nowA = time.Date(2026, 10, 31, 14, 20, 0, 0, time.UTC) // 17:20 EAT, out of hours
	nowB = time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)   // 12:00 EAT
)

func TestTaskTable(t *testing.T) { // P0
	b, err := os.ReadFile("../store/seed/example-process.json")
	if err != nil {
		t.Fatal(err)
	}
	def, err := process.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	var got, want []any
	for _, n := range def.Nodes {
		if n.Type == "task" {
			got = append(got, n.ID, *n.DeadlineHours)
		}
	}
	for _, tk := range tasks {
		want = append(want, tk.id, tk.deadline)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("task nodes %v, want %v", got, want)
	}
}

func TestRepeat(t *testing.T) { // P1
	if !reflect.DeepEqual(Plan(60, 30, nowA), Plan(60, 30, nowA)) {
		t.Fatal("two plans differ")
	}
}

func count(cs []Case) (res map[string]int, late, twoAnalysis int) {
	res = map[string]int{}
	for _, c := range cs {
		res[c.Result]++
		if c.Late {
			late++
		}
		a := 0
		for _, v := range c.Visits {
			if v.Node == "analysis" {
				a++
			}
		}
		if a == 2 {
			twoAnalysis++
		}
	}
	return
}

func TestMix60(t *testing.T) { // P2
	res, late, two := count(Plan(60, 30, nowA))
	if res["approved"] != 39 || res["refused"] != 6 || res[""] != 15 || late != 3 || two != 7 {
		t.Fatalf("results %v late %d two analysis %d", res, late, two)
	}
}

func TestMix20(t *testing.T) { // P3
	cs := Plan(20, 30, nowB)
	res, late, _ := count(cs)
	if res["approved"] != 13 || res["refused"] != 2 || res[""] != 5 || late != 1 {
		t.Fatalf("results %v late %d", res, late)
	}
	var nodes []string
	for _, c := range cs {
		if c.Result != "" {
			continue
		}
		v := c.Visits[len(c.Visits)-1]
		nodes = append(nodes, v.Node)
		if c.Late != (v.Node == "decision") {
			t.Errorf("%s late %v", v.Node, c.Late)
		}
		if v.Take.IsZero() != (v.Node == "entry") {
			t.Errorf("%s take %v", v.Node, v.Take)
		}
	}
	if want := []string{"entry", "analysis", "decision", "offer", "signing"}; !reflect.DeepEqual(nodes, want) {
		t.Fatalf("open nodes %v", nodes)
	}
}

func TestTimes(t *testing.T) { // P4, P5
	for _, now := range []time.Time{nowA, nowB} {
		for i, c := range Plan(60, 30, now) {
			var times []time.Time
			for k, v := range c.Visits {
				for _, x := range []time.Time{v.Enter, v.Take, v.Act} {
					if !x.IsZero() {
						times = append(times, x)
					}
				}
				if !v.Take.IsZero() && !v.Enter.Before(v.Take) || !v.Act.IsZero() && !v.Enter.Add(30*time.Minute).Before(v.Act) {
					t.Errorf("case %d visit %d: enter, take, act out of order", i, k)
				}
				if k > 0 && !c.Visits[k-1].Act.Equal(v.Enter) {
					t.Errorf("case %d visit %d: act %v, next enter %v", i, k, c.Visits[k-1].Act, v.Enter)
				}
			}
			for k, x := range times {
				h := x.In(eat).Hour()
				if !x.Equal(x.Truncate(time.Second)) || h < 8 || h >= 18 || !x.Before(now) || x.Before(now.Add(-30*24*time.Hour)) {
					t.Errorf("case %d time %d bad: %v", i, k, x.In(eat))
				}
			}
			last := c.Visits[len(c.Visits)-1]
			if c.Result != "" {
				if last.Act.After(now.Add(-time.Hour)) {
					t.Errorf("case %d closed at %v", i, last.Act)
				}
				continue
			}
			if last.Decision != "" || last.Values != nil || !last.Act.IsZero() {
				t.Errorf("case %d open visit %+v", i, last)
			}
			dl := time.Duration(deadline(last.Node)) * time.Hour
			age := now.Sub(last.Enter)
			if c.Late && age <= dl || !c.Late && age > dl-2*time.Hour {
				t.Errorf("case %d late %v age %v deadline %v", i, c.Late, age, dl)
			}
			if !last.Take.IsZero() && last.Take.After(now.Add(-30*time.Minute)) {
				t.Errorf("case %d take %v", i, last.Take)
			}
		}
	}
}

func TestData(t *testing.T) { // P6
	for i, c := range Plan(60, 30, nowA) {
		amount := c.Data["amount"].(float64)
		hasDecision, pastAnalysis := false, false
		for _, v := range c.Visits {
			hasDecision = hasDecision || v.Node == "decision"
			pastAnalysis = pastAnalysis || v.Node == "offer" || v.Node == "signing" || v.Node == "release"
		}
		// A path that stops at entry or analysis never reaches the decision gateway.
		if (hasDecision || pastAnalysis) && hasDecision != (amount > 100000) {
			t.Errorf("case %d amount %v decision %v", i, amount, hasDecision)
		}
		if hasDecision && amount <= 100000 {
			t.Errorf("case %d decision with amount %v", i, amount)
		}
		rate := c.Data["annual_rate"].(float64) / 12
		months := float64(c.Data["duration_months"].(int))
		payment := amount * rate / (1 - math.Pow(1+rate, -months))
		if payment/c.Data["monthly_income"].(float64) > 0.30 {
			t.Errorf("case %d debt ratio above 0.30", i)
		}
		last := c.Visits[len(c.Visits)-1]
		if last.Node == "release" && c.Result == "approved" {
			if want := last.Act.Add(48 * time.Hour).UTC().Format("2006-01-02"); last.Values["release_date"] != want {
				t.Errorf("case %d release %v, want %s", i, last.Values, want)
			}
		}
		if c.Result == "refused" && last.Node == "analysis" && (last.Decision != "unfavorable" || last.Values["analysis_opinion"] != "unfavorable") {
			t.Errorf("case %d refused at analysis %+v", i, last)
		}
	}
}

func TestOne(t *testing.T) { // P7
	cs := Plan(1, 30, nowB)
	if len(cs) != 1 || cs[0].Result != "" || cs[0].Late || len(cs[0].Visits) != 1 || cs[0].Visits[0].Node != "entry" || !cs[0].Visits[0].Take.IsZero() {
		t.Fatalf("plan %+v", cs)
	}
}

func TestEmpty(t *testing.T) { // P8
	if len(Plan(0, 30, nowA)) != 0 || len(Plan(-3, 30, nowA)) != 0 {
		t.Fatal("not empty")
	}
}
