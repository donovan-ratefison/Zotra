package docs

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/donovan-ratefison/zotra/internal/process"
)

// docFixture is the example definition with no source.
func docFixture(t *testing.T) process.Definition {
	t.Helper()
	raw, err := os.ReadFile("../../examples/home-loan/process.json")
	if err != nil {
		t.Fatalf("read example: %v", err)
	}
	def, err := process.Decode(raw)
	if err != nil {
		t.Fatalf("decode example: %v", err)
	}
	def.Sources = []process.Source{}
	return def
}

// node returns the node with the id.
func node(t *testing.T, def *process.Definition, id string) *process.Node {
	t.Helper()
	for i := range def.Nodes {
		if def.Nodes[i].ID == id {
			return &def.Nodes[i]
		}
	}
	t.Fatalf("no node %s", id)
	return nil
}

// stepBlock returns the text of the step block with the full heading.
func stepBlock(t *testing.T, text, heading string) string {
	t.Helper()
	_, rest, ok := strings.Cut(text, "### "+heading+"\n")
	if !ok {
		t.Fatalf("no step block %q", heading)
	}
	if end := strings.Index(rest, "\n#"); end >= 0 {
		rest = rest[:end]
	}
	return rest
}

// hasAll fails for each missing part.
func hasAll(t *testing.T, label, text string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if !strings.Contains(text, p) {
			t.Errorf("%s: missing %q", label, p)
		}
	}
}

// inOrder fails if the parts are missing or not in this order.
func inOrder(t *testing.T, text string, parts ...string) {
	t.Helper()
	at := 0
	for _, p := range parts {
		i := strings.Index(text[at:], p)
		if i < 0 {
			t.Fatalf("missing or out of order: %q", p)
		}
		at += i + len(p)
	}
}

var headings = []string{"1. Purpose and scope", "2. Roles and responsibilities", "3. Procedure",
	"4. Case data", "5. Policy references"}

// citeFixture is docFixture with a plain text, citations, a scope
// override and one source.
func citeFixture(t *testing.T) process.Definition {
	t.Helper()
	def := docFixture(t)
	entry := node(t, &def, "entry")
	plainText := "The amount must be positive."
	entry.Checks[0].PlainText = &plainText
	entry.Checks[0].Citations = []string{"p2-3"}
	offer := node(t, &def, "offer")
	offer.Citations = []string{"p10-1", "p1-2", "intro", "p1-2"}
	offer.ScopeOverrides = []process.Scope{{Field: "amount", Role: "legal", Access: "hidden"}}
	def.Sources = []process.Source{{ID: "blacklist", Name: "Credit blacklist",
		URL: "http://127.0.0.1:8093/blacklist", TestValues: map[string]any{}}}
	return def
}

// D1, D2, D3.
func TestMarkdownFixture(t *testing.T) {
	text := string(Markdown(docFixture(t)))
	if !strings.HasPrefix(text, "# Home loan\n\nThis policy comes from the process file of this version. Each change of the process changes this text.\n") ||
		!strings.HasSuffix(text, "\n") {
		t.Errorf("bad start or end:\n%s", text)
	}
	var want []string
	for _, h := range headings {
		want = append(want, "\n## "+h+"\n")
	}
	inOrder(t, text, want...)
	if strings.Contains(text, "External sources") {
		t.Error("External sources renders with no source")
	}
	hasAll(t, "markdown", text,
		"- Client advisor (Branch): Application entry, Client signature at the branch.\n",
		"Amounts are in EUR.\n",
		"A case ends with one of these outcomes: Loan released (approved), Application refused (refused).\n",
		"| Loan amount | amount | money | - | - |\n",
		"| amount | W | R | R | R | R |\n",
		"## 5. Policy references\n\nNo paragraph of a source policy is cited.\n",
		"## 4. Case data\n\nThe fields of a case:\n\n| Label |",
		"Access by role (R: read, W: write, H: hidden, -: not set):\n\n| Field |")
	hasAll(t, "start", stepBlock(t, text, "3.1 Application received"),
		"- A case starts here.\n- Next: Application entry.\n")
	hasAll(t, "entry", stepBlock(t, text, "3.2 Application entry"),
		"- Deadline: 24 hours from the arrival of the case.\n",
		"- Required documents: ID card, Salary slips, Bank statements, Property title.\n",
		"- Rule: `amount > 0.0 && duration_months <= 300`. Message when it fails: \"The amount must be positive and the duration at most 300 months.\"\n",
		"- Next: File complete?\n")
	hasAll(t, "complete", stepBlock(t, text, "3.3 File complete?"),
		"- If `size(documents) >= 4`: the case goes to Credit analysis.\n",
		"- Otherwise (Incomplete): the case goes to Application entry.\n")
	hasAll(t, "analysis", stepBlock(t, text, "3.4 Credit analysis"),
		"- External source: blacklist, existing_loans.\n",
		"- Decision \"Favorable\": the case goes to Amount above EUR 100,000?\n")
	hasAll(t, "decision", stepBlock(t, text, "3.6 Credit decision"),
		"- Signature: the participant signs the step before it closes.\n",
		"- Decision \"Return\": the case goes to Credit analysis.\n")
	hasAll(t, "released", stepBlock(t, text, "3.10 Loan released"),
		"- The case ends here. Result: approved.\n")
}

// cover is the bank profile of the HTML tests.
var cover = Cover{BankName: "Banque Ravina", PrimaryColor: "#0f4c45", AccentColor: "#b8913a",
	Version: 4, Status: "published", Date: time.Date(2026, 10, 29, 9, 10, 58, 0, time.UTC)}

// D4.
func TestHTMLFixture(t *testing.T) {
	text := string(HTML(docFixture(t), cover))
	const script = `<script type="module" src="/assets/doc-diagram.js"></script>`
	hasAll(t, "html", text, "<!doctype html>", "<h1>Home loan: procedure</h1>", "<table>",
		`<div id="diagram"></div>`, `<script type="application/json" id="process-definition">`, script,
		"<h3>File complete?</h3>",
		"<li>If <code>size(documents) &gt;= 4</code>: the case goes to Credit analysis.</li>",
		"<li>Decision &#34;Approve&#34;: the case goes to Loan offer.</li>")
	if strings.Contains(text, "<svg") {
		t.Error("html has an inline <svg>")
	}
	var want []string
	for _, h := range headings {
		want = append(want, "<h2>"+h+"</h2>")
	}
	inOrder(t, text, append([]string{"<h1>Home loan: procedure</h1>", `<div id="diagram"></div>`}, want...)...)
	if !strings.HasSuffix(text, "</html>\n") {
		t.Error("no trailing newline")
	}
}

// 2b. The definition in the page decodes to the same definition, and
// it cannot close its script element.
func TestHTMLFixtureDefinition(t *testing.T) {
	def := docFixture(t)
	text := string(HTML(def, cover))
	_, rest, ok := strings.Cut(text, `id="process-definition">`)
	data, _, ok2 := strings.Cut(rest, "</script>")
	if !ok || !ok2 {
		t.Fatal("no process-definition script")
	}
	if strings.Contains(data, "</") {
		t.Error("the JSON has </")
	}
	got, err := process.Decode([]byte(data))
	if err != nil {
		t.Fatalf("decode page JSON: %v", err)
	}
	if !reflect.DeepEqual(got, def) {
		t.Error("page JSON does not decode to the input definition")
	}
}

// D5, D6.
func TestCitations(t *testing.T) {
	def := citeFixture(t)
	md := string(Markdown(def))
	var want []string
	for _, h := range headings[:4] {
		want = append(want, "\n## "+h+"\n")
	}
	inOrder(t, md, append(want, "\n## 5. External sources\n", "\n## 6. Policy references\n")...)
	hasAll(t, "entry", stepBlock(t, md, "3.2 Application entry"),
		"- Rule: The amount must be positive. Expression: `amount > 0.0 && duration_months <= 300`. Reference: page 2, paragraph 3.\n")
	hasAll(t, "offer", stepBlock(t, md, "3.7 Loan offer"),
		"- Data access at this step: amount hidden for Legal officer.\n",
		"- Reference: page 10, paragraph 1; page 1, paragraph 2; intro.\n")
	hasAll(t, "analysis", stepBlock(t, md, "3.4 Credit analysis"),
		"- External source: Credit blacklist, existing_loans.\n")
	hasAll(t, "markdown", md,
		"## 5. External sources\n\n- Credit blacklist (blacklist), http://127.0.0.1:8093/blacklist\n",
		"## 6. Policy references\n\n- Page 1, paragraph 2 (p1-2): Loan offer.\n- Page 2, paragraph 3 (p2-3): Application entry.\n- Page 10, paragraph 1 (p10-1): Loan offer.\n- intro: Loan offer.\n")

	html := string(HTML(def, cover))
	hasAll(t, "html", html, "<h2>6. Policy references</h2>",
		"<li>Page 10, paragraph 1 (p10-1): Loan offer.</li>")
}

// D7.
func TestRefusedInputs(t *testing.T) {
	def := docFixture(t)
	offer := node(t, &def, "offer")
	ghost := "ghost"
	offer.Role = &ghost
	offer.DeadlineHours = nil
	node(t, &def, "released").EndResult = nil
	def.Edges = append(def.Edges, process.Edge{ID: "e15", From: "complete", To: "offer"})
	large := "Large"
	for i := range def.Edges {
		if def.Edges[i].ID == "e07" {
			def.Edges[i].Label = &large
		}
	}
	md := string(Markdown(def))
	hasAll(t, "offer", stepBlock(t, md, "3.7 Loan offer"), "- Responsible: ghost.\n", "- Deadline: none.\n")
	hasAll(t, "markdown", md, "### 3.10 Loan released\n\n- The case ends here.\n",
		"- If `amount > 100000.0` (Large): the case goes to Credit decision.\n")
	hasAll(t, "complete", stepBlock(t, md, "3.3 File complete?"), "- Next: Loan offer.\n")
}

// D11.
func TestRuleCoverage(t *testing.T) {
	def := docFixture(t)
	def.Fields = append(def.Fields, process.Field{Name: "kind", Label: "Kind", Type: "enum",
		Options: []string{"fast", "slow"}})
	def.Scope = append(def.Scope, process.Scope{Field: "kind", Role: "advisor", Access: "write"})
	offer := node(t, &def, "offer")
	offer.DeadlineHours = nil
	offer.ScopeOverrides = []process.Scope{{Field: "amount", Role: "legal", Access: "hidden"}}
	offer.Citations = []string{"p1-2", "p1-1", "p1-1"}

	md := string(Markdown(def))
	hasAll(t, "markdown", md,
		"| Kind | kind | enum | fast, slow | - |\n",
		"| Monthly payment | monthly_payment | money | - | `amount * (annual_rate / 12.0) / (1.0 - pow(1.0 + annual_rate / 12.0, -duration_months))` |\n",
		"| amount | W | R | R | R | R |\n",
		"| kind | W | - | - | - | - |\n",
		"Page 1, paragraph 1 (p1-1): Loan offer.\n- Page 1, paragraph 2 (p1-2): Loan offer.\n")
	hasAll(t, "offer", stepBlock(t, md, "3.7 Loan offer"),
		"- Deadline: none.\n",
		"- Data access at this step: amount hidden for Legal officer.\n",
		"- Reference: page 1, paragraph 2; page 1, paragraph 1.\n")
}

// mini is a process with no role and no field, with a second node of
// the type end or task.
func mini(t *testing.T, second string) process.Definition {
	t.Helper()
	raw := `{"schema_version":"1","name":"Mini","currency":"EUR","policy_document_id":null,
"theme":{"brand_name":"B","primary_color":"#0f4c45","logo_url":null},"roles":[],"fields":[],"scope":[],
"nodes":[%s,%s],"edges":[{"id":"e1","from":"start","to":"end","label":null,"decision":null,"condition":null,"is_default":false}],
"sources":[]}`
	n := `{"id":%q,"type":%q,"name":%q,"role":null,"deadline_hours":null,"documents":[],"signature":false,
"checks":[],"decisions":[],"end_result":%s,"scope_overrides":[],"source_ids":[],"citations":[]}`
	result := `"approved"`
	if second != "end" {
		result = "null"
	}
	def, err := process.Decode([]byte(fmt.Sprintf(raw,
		fmt.Sprintf(n, "start", "start", "Go", "null"),
		fmt.Sprintf(n, "end", second, "Done", result))))
	if err != nil {
		t.Fatal(err)
	}
	return def
}

// D8.
func TestMinimal(t *testing.T) {
	def := mini(t, "end")
	md := string(Markdown(def))
	if c := strings.Count(md, "\n### "); c != 2 {
		t.Errorf("step blocks = %d, want 2", c)
	}
	hasAll(t, "markdown", md,
		"## 2. Roles and responsibilities\n\nNo role is set.\n",
		"### 3.1 Go\n\n- A case starts here.\n- Next: Done.\n",
		"### 3.2 Done\n\n- The case ends here. Result: approved.\n",
		"The fields of a case:\n\n-\n",
		"Access by role (R: read, W: write, H: hidden, -: not set):\n\n-\n",
		"No paragraph of a source policy is cited.")
	hasAll(t, "html", string(HTML(def, cover)), `id="diagram"`, "<h1>Mini: procedure</h1>")
}

// D9.
func TestNoEndStep(t *testing.T) {
	hasAll(t, "markdown", string(Markdown(mini(t, "task"))), "The process has no end step.\n")
}

// B1, B5, B6, B7, B11.
func TestHTMLPage(t *testing.T) {
	text := string(HTML(docFixture(t), cover))
	hasAll(t, "page", text,
		"<title>Home loan: procedure, v4</title>",
		":root{--primary:#0f4c45;--accent:#b8913a;--on-primary:#ffffff}",
		`@page{size:A4;margin:18mm;@top-left{content:"Banque Ravina";`,
		`@top-right{content:"Home loan: procedure";`,
		`@bottom-left{content:"v4";`,
		`@bottom-right{content:"page " counter(page) " of " counter(pages);`,
		"<h1>Home loan: procedure</h1>",
		`v4 <span class="badge">Published</span> <span>29 Oct 2026</span>`,
		"Generated by Zotra from the process file of this version",
		// B5
		`<a href="#s1">1. Purpose and scope</a>`,
		`<a href="#s3-2">3.2 Application entry</a>`,
		`<a href="#s5">5. Policy references</a>`,
		`<section id="s3">`,
		`<article class="step" id="s3-10">`,
		// B6
		`<span class="num">3.2</span><h3>Application entry</h3><span class="chip" style="--chip:#0891b2">Client advisor</span><span class="deadline">24 h</span>`,
		`<li>Required documents<ul class="docs"><li>ID card</li><li>Salary slips</li><li>Bank statements</li><li>Property title</li></ul></li>`,
		`<li class="rule"><code class="cel">amount &gt; 0.0 &amp;&amp; duration_months &lt;= 300</code><p>Message when it fails: &#34;The amount must be positive and the duration at most 300 months.&#34;</p></li>`,
		// B7
		`<span class="num">3.1</span><h3>Application received</h3><span class="kind">Start</span>`,
		`<h3>File complete?</h3><span class="kind">Automatic rule</span>`,
		`<h3>Loan released</h3><span class="kind">End</span>`,
		`<li>If <code>size(documents) &gt;= 4</code>: the case goes to Credit analysis.</li>`)
	for _, absent := range []string{"<img", intro, "Responsible:", "Deadline:"} {
		if strings.Contains(text, absent) {
			t.Errorf("page has %q", absent)
		}
	}
	if n := strings.Count(text, `href="#s3-`); n != 11 {
		t.Errorf("step links = %d, want 11", n)
	}
	// B11
	if n := strings.Count(text, `<td class="name">amount</td>`); n != 2 {
		t.Errorf("name cells of amount = %d, want 2", n)
	}
}

// B2, B4, B9, B10.
func TestHTMLCover(t *testing.T) {
	c := cover
	c.LogoURI = "data:image/png;base64,iVBORw0KGgpkYXRh"
	hasAll(t, "logo", string(HTML(docFixture(t), c)),
		`<img src="data:image/png;base64,iVBORw0KGgpkYXRh" alt="Banque Ravina">`)

	c = cover
	c.PrimaryColor = "#ffcc00"
	hasAll(t, "light primary", string(HTML(docFixture(t), c)), "--on-primary:#111111")

	c = cover
	c.BankName = `A"</style>&`
	text := string(HTML(docFixture(t), c))
	hasAll(t, "escape", text, `@top-left{content:"A\"\3c /style>&";`, `<span>A&#34;&lt;/style&gt;&amp;</span>`)
	if n := strings.Count(text, "</style>"); n != 1 {
		t.Errorf("</style> count = %d, want 1", n)
	}

	for status, want := range map[string]string{"draft": "Draft", "frozen": "Frozen", "other": "other"} {
		c = cover
		c.Status = status
		hasAll(t, status, string(HTML(docFixture(t), c)), `<span class="badge">`+want+"</span>")
	}
}

// B3.
func TestOnColor(t *testing.T) {
	for hex, want := range map[string]string{"#0f4c45": "#ffffff", "#ffcc00": "#111111", "#b8913a": "#111111",
		"#7c3aed": "#ffffff", "#777777": "#ffffff", "#808080": "#111111"} {
		if got := onColor(hex); got != want {
			t.Errorf("onColor(%s) = %s, want %s", hex, got, want)
		}
	}
}

// B8.
func TestHTMLRefusedInputs(t *testing.T) {
	def := citeFixture(t)
	offer := node(t, &def, "offer")
	ghost := "ghost"
	offer.Role = &ghost
	offer.DeadlineHours = nil
	node(t, &def, "analysis").Role = nil
	hasAll(t, "html", string(HTML(def, cover)),
		`<span class="chip" style="--chip:#a1a1aa">ghost</span><span class="deadline">No deadline</span>`,
		`<h3>Credit analysis</h3><span class="kind">No role</span><span class="deadline">48 h</span>`,
		`<li class="rule"><p>The amount must be positive.</p><code class="cel">amount &gt; 0.0 &amp;&amp; duration_months &lt;= 300</code><p class="ref">Reference: page 2, paragraph 3.</p></li>`,
		`<li class="ref">Reference: page 10, paragraph 1; page 1, paragraph 2; intro.</li>`)
}
