package docs

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"

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

// stepBlock returns the text of the step block with the name.
func stepBlock(t *testing.T, text, name string) string {
	t.Helper()
	_, rest, ok := strings.Cut(text, "### "+name+"\n")
	if !ok {
		t.Fatalf("no step block %q", name)
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

var headings = []string{"Roles", "Data model", "Data scope", "Steps", "Policy citations"}

// 1.
func TestMarkdownFixture(t *testing.T) {
	text := string(Markdown(docFixture(t)))
	if !strings.HasPrefix(text, "# Home loan\n\nProcess documentation, generated from the process file.\n") ||
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
		"- Client advisor (Branch)\n",
		"| Loan amount | amount | money | - | - |\n",
		"| amount | W | R | R | R | R |\n")
	hasAll(t, "start", stepBlock(t, text, "Application received"), "- Role: -\n")
	hasAll(t, "entry", stepBlock(t, text, "Application entry"),
		"- Role: Client advisor\n", "- Deadline: 24 h\n",
		"- Documents: ID card, Salary slips, Bank statements, Property title\n",
		"- Signature: No\n")
	hasAll(t, "analysis", stepBlock(t, text, "Credit analysis"),
		"- Type: task\n", "- Role: Credit analyst\n", "- Deadline: 48 h\n", "- Documents: -\n",
		"- Check `debt_ratio <= 0.33 || analysis_comment != \"\"`: Not documented.\n")
	hasAll(t, "complete", stepBlock(t, text, "File complete?"),
		"- Condition to Credit analysis: `size(documents) >= 4`\n",
		"- Condition to Application entry: Incomplete (default)\n")
}

// 2.
func TestHTMLFixture(t *testing.T) {
	text := string(HTML(docFixture(t)))
	hasAll(t, "html", text, "<!doctype html>", "<svg", "<h1>Home loan</h1>", "<table>")
	var want []string
	for _, h := range headings {
		want = append(want, "<h2>"+h+"</h2>")
	}
	inOrder(t, text, append([]string{"<h1>Home loan</h1>", "<svg"}, want...)...)
	if !strings.HasSuffix(text, "</html>\n") {
		t.Error("no trailing newline")
	}
}

// 3.
func TestSVGFixture(t *testing.T) {
	text := string(SVG(docFixture(t)))
	if n := strings.Count(text, "<rect "); n != 11 {
		t.Errorf("rect = %d, want 11", n)
	}
	if n := strings.Count(text, "<line "); n != 14 {
		t.Errorf("line = %d, want 14", n)
	}
	hasAll(t, "svg", text, `viewBox="0 0 260 1000"`, ">Incomplete</text>")
	for id, fill := range map[string]string{"released": "#16a34a", "refused": "#dc2626"} {
		re := regexp.MustCompile(`<g id="node-` + id + `"><rect [^>]*fill="` + fill + `"`)
		if !re.MatchString(text) {
			t.Errorf("%s box has no fill %s", id, fill)
		}
	}
}

// 4.
func TestSourcesAndPlainText(t *testing.T) {
	def := docFixture(t)
	def.Sources = []process.Source{{ID: "blacklist", Name: "Credit blacklist",
		URL: "http://127.0.0.1:8093/blacklist", TestValues: map[string]any{"listed": false}}}
	entry := node(t, &def, "entry")
	plainText := "The amount must be positive."
	entry.Checks[0].PlainText = &plainText
	entry.Checks[0].Citations = []string{"p2-3"}

	md := string(Markdown(def))
	var want []string
	for _, h := range headings[:4] {
		want = append(want, "\n## "+h+"\n")
	}
	inOrder(t, md, append(want, "\n## External sources\n", "\n## Policy citations\n")...)
	hasAll(t, "markdown", md,
		"- Credit blacklist (blacklist), http://127.0.0.1:8093/blacklist\n",
		"- Check `amount > 0.0 && duration_months <= 300`: The amount must be positive. Cited: p2-3\n",
		"## Policy citations\n\np2-3\n")

	html := string(HTML(def))
	hasAll(t, "html", html,
		"<h2>External sources</h2>",
		"<li>Credit blacklist (blacklist), http://127.0.0.1:8093/blacklist</li>",
		"<li>Check <code>amount &gt; 0.0 &amp;&amp; duration_months &lt;= 300</code>: The amount must be positive. Cited: p2-3</li>",
		"<h2>Policy citations</h2>\n<p>p2-3</p>")
}

// 4b.
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
		"## Policy citations\n\np1-1, p1-2\n")
	hasAll(t, "offer", stepBlock(t, md, "Loan offer"),
		"- Type: task\n", "- Role: Legal officer\n", "- Deadline: -\n",
		"- Documents: Loan offer, Mortgage deed\n", "- Signature: Yes\n",
		"- Scope overrides: amount: hidden\n", "- Cited: p1-2, p1-1\n")
}

// 5.
func TestMinimal(t *testing.T) {
	raw := `{"schema_version":"1","name":"Mini","currency":"EUR","policy_document_id":null,
"theme":{"brand_name":"B","primary_color":"#0f4c45","logo_url":null},"roles":[],"fields":[],"scope":[],
"nodes":[%s,%s],"edges":[{"id":"e1","from":"start","to":"end","label":null,"decision":null,"condition":null,"is_default":false}],
"sources":[]}`
	n := `{"id":%q,"type":%q,"name":%q,"role":null,"deadline_hours":null,"documents":[],"signature":false,
"checks":[],"decisions":[],"end_result":%s,"scope_overrides":[],"source_ids":[],"citations":[]}`
	def, err := process.Decode([]byte(fmt.Sprintf(raw,
		fmt.Sprintf(n, "start", "start", "Go", "null"),
		fmt.Sprintf(n, "end", "end", "Done", `"approved"`))))
	if err != nil {
		t.Fatal(err)
	}
	md := string(Markdown(def))
	if c := strings.Count(md, "\n### "); c != 2 {
		t.Errorf("step blocks = %d, want 2", c)
	}
	for _, name := range []string{"Go", "Done"} {
		hasAll(t, name, stepBlock(t, md, name), "- Role: -\n")
	}
	hasAll(t, "markdown", md, "## Roles\n\n-\n", "## Data model\n\n-\n",
		"## Data scope\n\n-\n", "## Policy citations\n\n-\n")
	hasAll(t, "html", string(HTML(def)), "<svg", "<h1>Mini</h1>")
}
