// Package docs generates the policy text of one process version from
// its process file: Markdown and a printable HTML page. The page
// draws the diagram in the browser with the layout of the studio. The
// output depends on the definition only, so the documentation of a
// frozen version never changes.
package docs

import (
	"cmp"
	"encoding/json"
	"fmt"
	"html"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/donovan-ratefison/zotra/internal/process"
)

const intro = "This policy comes from the process file of this version. Each change of the process changes this text."

// span is one piece of inline text. A code span holds CEL.
type span struct {
	text string
	code bool
}

// line is one line of inline text.
type line []span

// block is one item of a section: a step heading, a paragraph, a
// bullet list or a table. A table sets head and rows; each other
// kind sets one field. HTML only: tag is the card header tag of a
// step heading, and lis, when set, holds the <li> of each list line
// ("" hides the line).
type block struct {
	heading string
	text    line
	list    []line
	head    []string
	rows    []cells
	tag     string
	lis     []string
}

// cells is one table row: one line for each cell.
type cells []line

// section is one h2 section of the document.
type section struct {
	title  string
	blocks []block
}

func plain(s string) line { return line{{text: s}} }

// orDash joins the items with ", ", or returns "-" for no item.
func orDash(items []string) string {
	if len(items) == 0 {
		return "-"
	}
	return strings.Join(items, ", ")
}

// unique drops the duplicates and keeps the first order.
func unique(items []string) []string {
	var out []string
	for _, s := range items {
		if !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	return out
}

var paragraphID = regexp.MustCompile(`^p(\d+)-(\d+)$`)

// end adds a period unless the text already ends a sentence.
func end(s string) string {
	if strings.HasSuffix(s, ".") || strings.HasSuffix(s, "?") || strings.HasSuffix(s, "!") {
		return s
	}
	return s + "."
}

// ref gives "page P, paragraph I" for a paragraph id, or the id.
func ref(id string, upper bool) string {
	m := paragraphID.FindStringSubmatch(id)
	if m == nil {
		return id
	}
	page := "page"
	if upper {
		page = "Page"
	}
	return fmt.Sprintf("%s %s, paragraph %s", page, m[1], m[2])
}

// refs joins the unique references of a citation list.
func refs(ids []string) string {
	var out []string
	for _, id := range unique(ids) {
		out = append(out, ref(id, false))
	}
	return strings.Join(out, "; ")
}

// nameOr returns the name of the id, or the id when it is unknown.
func nameOr(names map[string]string, id string) string {
	if n, ok := names[id]; ok {
		return n
	}
	return id
}

// sections builds the content shared by the Markdown and the HTML.
func sections(def process.Definition) []section {
	roleName := map[string]string{}
	for _, r := range def.Roles {
		roleName[r.ID] = r.Name
	}
	var ends []string
	for _, n := range def.Nodes {
		if n.Type == "end" {
			e := n.Name
			if n.EndResult != nil {
				e += " (" + *n.EndResult + ")"
			}
			ends = append(ends, e)
		}
	}
	outcomes := "The process has no end step."
	if len(ends) > 0 {
		outcomes = "A case ends with one of these outcomes: " + strings.Join(ends, ", ") + "."
	}
	out := []section{
		{"1. Purpose and scope", []block{
			{text: plain("This policy sets the procedure \"" + def.Name + "\". It applies to each case of this process.")},
			{text: plain("Amounts are in " + def.Currency + ".")},
			{text: plain(outcomes)},
		}},
		{"2. Roles and responsibilities", []block{roles(def)}},
		{"3. Procedure", steps(def, roleName)},
		{"4. Case data", []block{
			{text: plain("The fields of a case:")},
			dataModel(def),
			{text: plain("Access by role (R: read, W: write, H: hidden, -: not set):")},
			dataScope(def),
		}},
	}
	if len(def.Sources) > 0 {
		var src []line
		for _, s := range def.Sources {
			src = append(src, plain(fmt.Sprintf("%s (%s), %s", s.Name, s.ID, s.URL)))
		}
		out = append(out, section{"5. External sources", []block{{list: src}}})
	}
	title := fmt.Sprintf("%d. Policy references", len(out)+1)
	return append(out, section{title, []block{references(def)}})
}

// roles lists each role with the steps it is responsible for.
func roles(def process.Definition) block {
	if len(def.Roles) == 0 {
		return block{text: plain("No role is set.")}
	}
	var items []line
	for _, r := range def.Roles {
		var steps []string
		for _, n := range def.Nodes {
			if n.Role != nil && *n.Role == r.ID {
				steps = append(steps, n.Name)
			}
		}
		names := "no step"
		if len(steps) > 0 {
			names = strings.Join(steps, ", ")
		}
		items = append(items, plain(fmt.Sprintf("%s (%s): %s.", r.Name, r.Department, names)))
	}
	return block{list: items}
}

// references lists each cited paragraph with the steps that cite it,
// by page and paragraph number, other ids last.
func references(def process.Definition) block {
	cites := map[string][]string{}
	var ids []string
	for _, n := range def.Nodes {
		all := slices.Clone(n.Citations)
		for _, c := range n.Checks {
			all = append(all, c.Citations...)
		}
		for _, id := range all {
			if _, ok := cites[id]; !ok {
				ids = append(ids, id)
			}
			if !slices.Contains(cites[id], n.Name) {
				cites[id] = append(cites[id], n.Name)
			}
		}
	}
	if len(ids) == 0 {
		return block{text: plain("No paragraph of a source policy is cited.")}
	}
	slices.SortFunc(ids, func(a, b string) int {
		ma, mb := paragraphID.FindStringSubmatch(a), paragraphID.FindStringSubmatch(b)
		switch {
		case ma == nil && mb == nil:
			return strings.Compare(a, b)
		case ma == nil:
			return 1
		case mb == nil:
			return -1
		}
		pa, _ := strconv.Atoi(ma[1])
		pb, _ := strconv.Atoi(mb[1])
		ia, _ := strconv.Atoi(ma[2])
		ib, _ := strconv.Atoi(mb[2])
		return cmp.Or(cmp.Compare(pa, pb), cmp.Compare(ia, ib))
	})
	var items []line
	for _, id := range ids {
		label := id
		if paragraphID.MatchString(id) {
			label = ref(id, true) + " (" + id + ")"
		}
		items = append(items, plain(label+": "+strings.Join(cites[id], ", ")+"."))
	}
	return block{list: items}
}

// dataModel is the table of the fields.
func dataModel(def process.Definition) block {
	if len(def.Fields) == 0 {
		return block{text: plain("-")}
	}
	b := block{head: []string{"Label", "Name", "Type", "Options", "Computed"}}
	for _, f := range def.Fields {
		computed := plain("-")
		if f.Computed != nil {
			computed = line{{text: *f.Computed, code: true}}
		}
		b.rows = append(b.rows, cells{plain(f.Label), plain(f.Name), plain(f.Type),
			plain(orDash(f.Options)), computed})
	}
	return b
}

// dataScope is the matrix field x role of the process scope.
func dataScope(def process.Definition) block {
	if len(def.Fields) == 0 || len(def.Roles) == 0 {
		return block{text: plain("-")}
	}
	letter := map[string]string{"read": "R", "write": "W", "hidden": "H"}
	access := map[[2]string]string{}
	for _, s := range def.Scope {
		access[[2]string{s.Field, s.Role}] = letter[s.Access]
	}
	b := block{head: []string{"Field"}}
	for _, r := range def.Roles {
		b.head = append(b.head, r.Name)
	}
	for _, f := range def.Fields {
		row := cells{plain(f.Name)}
		for _, r := range def.Roles {
			cell := access[[2]string{f.Name, r.ID}]
			if cell == "" {
				cell = "-"
			}
			row = append(row, plain(cell))
		}
		b.rows = append(b.rows, row)
	}
	return b
}

// steps is one numbered heading and one bullet list for each node.
func steps(def process.Definition, roleName map[string]string) []block {
	roleColor := map[string]string{}
	for i, r := range def.Roles {
		roleColor[r.ID] = rolePalette[i%len(rolePalette)]
	}
	nodeName := map[string]string{}
	for _, n := range def.Nodes {
		nodeName[n.ID] = n.Name
	}
	sourceName := map[string]string{}
	for _, s := range def.Sources {
		sourceName[s.ID] = s.Name
	}
	var out []block
	for k, n := range def.Nodes {
		var edges []process.Edge
		for _, e := range def.Edges {
			if e.From == n.ID {
				edges = append(edges, e)
			}
		}
		var items []line
		var lis []string
		tag := map[string]string{"start": "Start", "end": "End", "gateway": "Automatic rule"}[n.Type]
		if tag != "" {
			tag = `<span class="kind">` + tag + `</span>`
		}
		next := func(e process.Edge) line { return plain(end("Next: " + nodeName[e.To])) }
		switch n.Type {
		case "start":
			items = append(items, plain("A case starts here."))
			for _, e := range edges {
				items = append(items, next(e))
			}
		case "end":
			s := "The case ends here."
			if n.EndResult != nil {
				s += " Result: " + *n.EndResult + "."
			}
			items = append(items, plain(s))
		case "gateway":
			items = append(items, plain("The rule of the process chooses the next step. No person decides here."))
			for _, e := range edges {
				label, goes := "", ": the case goes to "+nodeName[e.To]
				if e.Label != nil && *e.Label != "" {
					label = " (" + *e.Label + ")"
				}
				switch {
				case e.Condition != nil:
					items = append(items, line{{text: "If "}, {text: *e.Condition, code: true}, {text: end(label + goes)}})
				case e.IsDefault:
					items = append(items, plain(end("Otherwise"+label+goes)))
				default:
					items = append(items, next(e))
				}
			}
		default:
			items, lis = task(n, edges, roleName, nodeName, sourceName)
			tag = taskTag(n, roleName, roleColor)
		}
		out = append(out, block{heading: fmt.Sprintf("3.%d %s", k+1, n.Name), tag: tag}, block{list: items, lis: lis})
	}
	return out
}

// rolePalette is the role color palette of the studio, in role order.
var rolePalette = []string{"#0891b2", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#65a30d"}

// taskTag is the card header tag of a task: the role chip or "No
// role", then the deadline.
func taskTag(n process.Node, roleName, roleColor map[string]string) string {
	tag := `<span class="kind">No role</span>`
	if n.Role != nil {
		color := cmp.Or(roleColor[*n.Role], "#a1a1aa")
		tag = fmt.Sprintf(`<span class="chip" style="--chip:%s">%s</span>`, color,
			html.EscapeString(nameOr(roleName, *n.Role)))
	}
	deadline := "No deadline"
	if n.DeadlineHours != nil {
		deadline = fmt.Sprintf("%d h", *n.DeadlineHours)
	}
	return tag + `<span class="deadline">` + deadline + `</span>`
}

// task is the list of one task step, and the <li> of each line for
// the HTML card.
func task(n process.Node, edges []process.Edge, roleName, nodeName, sourceName map[string]string) ([]line, []string) {
	var items []line
	var lis []string
	add := func(l line, li string) {
		items = append(items, l)
		lis = append(lis, li)
	}
	// li is the default <li> of a line.
	li := func(l line) string { return "<li>" + htm(l) + "</li>" }
	// The card header shows the role and the deadline.
	if n.Role != nil {
		add(plain("Responsible: "+nameOr(roleName, *n.Role)+"."), "")
	} else {
		add(plain("Responsible: no role is set."), "")
	}
	if n.DeadlineHours != nil {
		add(plain(fmt.Sprintf("Deadline: %d hours from the arrival of the case.", *n.DeadlineHours)), "")
	} else {
		add(plain("Deadline: none."), "")
	}
	if len(n.Documents) > 0 {
		var docs strings.Builder
		for _, d := range n.Documents {
			docs.WriteString("<li>" + html.EscapeString(d) + "</li>")
		}
		add(plain("Required documents: "+strings.Join(n.Documents, ", ")+"."),
			`<li>Required documents<ul class="docs">`+docs.String()+"</ul></li>")
	}
	if n.Signature {
		l := plain("Signature: the participant signs the step before it closes.")
		add(l, li(l))
	}
	for _, c := range n.Checks {
		r, refHTML := "", ""
		if len(c.Citations) > 0 {
			r = " Reference: " + refs(c.Citations) + "."
			refHTML = `<p class="ref">` + html.EscapeString(strings.TrimSpace(r)) + "</p>"
		}
		expr := span{text: c.Expression, code: true}
		cel := `<code class="cel">` + html.EscapeString(c.Expression) + "</code>"
		if c.PlainText != nil {
			add(line{{text: "Rule: " + end(*c.PlainText) + " Expression: "}, expr, {text: "." + r}},
				`<li class="rule"><p>`+html.EscapeString(end(*c.PlainText))+"</p>"+cel+refHTML+"</li>")
		} else {
			add(line{{text: "Rule: "}, expr, {text: ". Message when it fails: \"" + c.Message + "\"" + r}},
				`<li class="rule">`+cel+"<p>"+html.EscapeString("Message when it fails: \""+c.Message+"\"")+"</p>"+refHTML+"</li>")
		}
	}
	// The lines below keep the default <li>.
	defaults := len(items)
	if len(n.SourceIDs) > 0 {
		var names []string
		for _, id := range n.SourceIDs {
			names = append(names, nameOr(sourceName, id))
		}
		items = append(items, plain("External source: "+strings.Join(names, ", ")+"."))
	}
	if len(n.ScopeOverrides) > 0 {
		var access []string
		for _, o := range n.ScopeOverrides {
			access = append(access, o.Field+" "+o.Access+" for "+nameOr(roleName, o.Role))
		}
		items = append(items, plain("Data access at this step: "+strings.Join(access, "; ")+"."))
	}
	for _, e := range edges {
		if e.Decision != nil {
			d := []rune(*e.Decision)
			if len(d) > 0 {
				d[0] = unicode.ToUpper(d[0])
			}
			items = append(items, plain(end(fmt.Sprintf("Decision \"%s\": the case goes to %s", string(d), nodeName[e.To]))))
		} else {
			items = append(items, plain(end("Next: "+nodeName[e.To])))
		}
	}
	for _, l := range items[defaults:] {
		lis = append(lis, li(l))
	}
	if len(n.Citations) > 0 {
		r := "Reference: " + refs(n.Citations) + "."
		add(plain(r), `<li class="ref">`+html.EscapeString(r)+"</li>")
	}
	return items, lis
}

// md renders one line as Markdown. A table cell escapes the pipe.
func md(l line, cell bool) string {
	var b strings.Builder
	for _, s := range l {
		t := s.text
		if cell {
			t = strings.ReplaceAll(t, "|", `\|`)
		}
		if s.code {
			t = "`" + t + "`"
		}
		b.WriteString(t)
	}
	return b.String()
}

// Markdown renders the documentation of one definition.
func Markdown(def process.Definition) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n%s\n", def.Name, intro)
	for _, s := range sections(def) {
		fmt.Fprintf(&b, "\n## %s\n", s.title)
		for _, bl := range s.blocks {
			b.WriteString("\n")
			switch {
			case bl.heading != "":
				fmt.Fprintf(&b, "### %s\n", bl.heading)
			case bl.list != nil:
				for _, l := range bl.list {
					fmt.Fprintf(&b, "- %s\n", md(l, false))
				}
			case bl.head != nil:
				fmt.Fprintf(&b, "| %s |\n|%s\n", strings.Join(bl.head, " | "),
					strings.Repeat(" --- |", len(bl.head)))
				for _, row := range bl.rows {
					cells := make([]string, len(row))
					for i, c := range row {
						cells[i] = md(c, true)
					}
					fmt.Fprintf(&b, "| %s |\n", strings.Join(cells, " | "))
				}
			default:
				fmt.Fprintf(&b, "%s\n", md(bl.text, false))
			}
		}
	}
	return []byte(b.String())
}

// htm renders one line as escaped HTML.
func htm(l line) string {
	var b strings.Builder
	for _, s := range l {
		if s.code {
			fmt.Fprintf(&b, "<code>%s</code>", html.EscapeString(s.text))
		} else {
			b.WriteString(html.EscapeString(s.text))
		}
	}
	return b.String()
}

// Cover is the page data that does not come from the process file.
// LogoURI is a data URI or "" (no logo). The API stores only
// #rrggbb colors.
type Cover struct {
	BankName, PrimaryColor, AccentColor, LogoURI string
	Version                                      int
	Status                                       string
	Date                                         time.Time
}

// luminance is the WCAG 2 relative luminance of a #rrggbb color.
func luminance(hex string) float64 {
	v, _ := strconv.ParseUint(strings.TrimPrefix(hex, "#"), 16, 32)
	l := 0.0
	for i, k := range []float64{0.2126, 0.7152, 0.0722} {
		c := float64(v>>(16-8*i)&0xff) / 255
		if c <= 0.04045 {
			c /= 12.92
		} else {
			c = math.Pow((c+0.055)/1.055, 2.4)
		}
		l += k * c
	}
	return l
}

// onColor is the text color, #ffffff or #111111, with the higher WCAG
// contrast ratio on hex.
func onColor(hex string) string {
	l := luminance(hex)
	if 1.05/(l+0.05) >= (l+0.05)/(luminance("#111111")+0.05) {
		return "#ffffff"
	}
	return "#111111"
}

// cssString quotes s as a CSS string that cannot close the style
// element.
func cssString(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "<", `\3c `, "\n", `\a `).Replace(s) + `"`
}

// anchor is the id of a section title or a step heading: "1. Purpose"
// gives "s1", "3.10 Loan" gives "s3-10".
func anchor(title string) string {
	num, _, _ := strings.Cut(title, " ")
	return "s" + strings.ReplaceAll(strings.TrimSuffix(num, "."), ".", "-")
}

var statusText = map[string]string{"draft": "Draft", "published": "Published", "frozen": "Frozen"}

const css = `*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;padding:32px 16px;background:#f4f4f5;color:#18181b;font:15px/1.55 Inter,system-ui,sans-serif}
.sheet{max-width:820px;margin:0 auto;padding:56px 64px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06)}
.cover{display:flex;justify-content:space-between;gap:32px;padding-bottom:24px;margin-bottom:24px;border-bottom:4px solid var(--primary)}
.bank{display:flex;align-items:center;gap:12px;font-weight:600;color:var(--primary)}
.bank img{max-height:48px;max-width:160px}
.cover h1{margin:0 0 8px;font-size:26px;line-height:1.25;color:var(--primary);text-align:right}
.meta,.gen{margin:0;text-align:right;color:#52525b}
.gen{font-size:12px;color:#71717a}
.badge{display:inline-block;padding:0 8px;border-radius:999px;background:var(--primary);color:var(--on-primary);font-size:12px;font-weight:600}
h2{color:var(--primary);font-size:20px;margin:32px 0 12px;padding-bottom:4px;border-bottom:2px solid var(--accent)}
h3{margin:0;font-size:15px}
.toc ol{margin:0;padding:0;list-style:none}.toc ol ol{columns:2;padding-left:20px}
.toc a{color:inherit;text-decoration:none}.toc a:hover{text-decoration:underline}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
th,td{border:1px solid #e4e4e7;padding:6px 8px;text-align:left;vertical-align:top}
th{background:color-mix(in srgb,var(--primary) 8%,white)}
tbody tr:nth-child(even){background:#fafafa}
td.name{white-space:nowrap}
.step{border:1px solid #e4e4e7;border-radius:8px;padding:12px 16px;margin:12px 0}
.step>header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.step ul{margin:0;padding-left:20px}
.num{background:var(--primary);color:var(--on-primary);border-radius:4px;padding:0 6px;font-size:13px;font-weight:600}
.chip{color:var(--chip);border:1px solid var(--chip);background:color-mix(in srgb,var(--chip) 12%,transparent);border-radius:999px;padding:0 8px;font-size:12px}
.kind{border:1px solid #d4d4d8;border-radius:999px;padding:0 8px;font-size:12px;color:#52525b}
.deadline{margin-left:auto;font-size:12px;color:#52525b}
.rule p{margin:0}
.cel{display:block;margin:4px 0;padding:6px 8px;border-radius:4px;background:#f4f4f5;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap}
.ref{margin:4px 0;padding-left:8px;border-left:3px solid var(--accent);color:#52525b}
li.ref{list-style:none;margin-left:-20px}
figure{margin:24px 0}
#diagram svg{display:block;width:100%;height:auto}
figcaption{font-size:12px;color:#71717a;text-align:center}
@media print{body{font-size:10.5pt;padding:0;background:none}.sheet{max-width:none;padding:0;box-shadow:none}
tr,.step,.rule{break-inside:avoid}h2,h3,.step>header{break-after:avoid}}`

// HTML renders the printable page with the bank profile of c: the
// cover, the contents, the diagram, the same sections with a card for
// each step, and the process definition as JSON for the diagram script.
func HTML(def process.Definition, c Cover) []byte {
	var b strings.Builder
	name := html.EscapeString(def.Name)
	title := name + ": procedure"
	status := cmp.Or(statusText[c.Status], c.Status)
	// Marshal cannot fail for this type. It escapes <, > and &, so the JSON cannot close the script.
	data, _ := json.Marshal(def)
	all := sections(def)
	const box = ";font-size:8pt;color:#71717a}"
	fmt.Fprintf(&b, "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"+
		"<title>%s, v%d</title>\n<style>\n:root{--primary:%s;--accent:%s;--on-primary:%s}\n"+
		"@page{size:A4;margin:18mm;@top-left{content:%s%s@top-right{content:%s%s"+
		"@bottom-left{content:\"v%d\"%s@bottom-right{content:\"page \" counter(page) \" of \" counter(pages)%s}\n"+
		"%s\n</style>\n</head>\n<body>\n<main class=\"sheet\">\n<header class=\"cover\"><div class=\"bank\">",
		title, c.Version, c.PrimaryColor, c.AccentColor, onColor(c.PrimaryColor),
		cssString(c.BankName), box, cssString(def.Name+": procedure"), box, c.Version, box, box, css)
	bank := html.EscapeString(c.BankName)
	if c.LogoURI != "" {
		fmt.Fprintf(&b, "<img src=\"%s\" alt=\"%s\">", html.EscapeString(c.LogoURI), bank)
	}
	fmt.Fprintf(&b, "<span>%s</span></div><div><h1>%s</h1>"+
		"<p class=\"meta\">v%d <span class=\"badge\">%s</span> <span>%s</span></p>"+
		"<p class=\"gen\">Generated by Zotra from the process file of this version</p></div></header>\n"+
		"<nav class=\"toc\" aria-label=\"Contents\"><h2>Contents</h2><ol>\n",
		bank, title, c.Version, html.EscapeString(status), c.Date.UTC().Format("2 Jan 2006"))
	for _, s := range all {
		fmt.Fprintf(&b, "<li><a href=\"#%s\">%s</a>", anchor(s.title), html.EscapeString(s.title))
		if s.title == "3. Procedure" {
			b.WriteString("<ol>")
			for _, bl := range s.blocks {
				if bl.heading != "" {
					fmt.Fprintf(&b, "<li><a href=\"#%s\">%s</a></li>", anchor(bl.heading), html.EscapeString(bl.heading))
				}
			}
			b.WriteString("</ol>")
		}
		b.WriteString("</li>\n")
	}
	fmt.Fprintf(&b, "</ol></nav>\n<figure class=\"diagram\"><div id=\"diagram\"></div>"+
		"<figcaption>Figure 1. The steps and links of %s, v%d.</figcaption></figure>\n"+
		"<script type=\"application/json\" id=\"process-definition\">%s</script>\n"+
		"<script type=\"module\" src=\"/assets/doc-diagram.js\"></script>\n", name, c.Version, data)
	for _, s := range all {
		fmt.Fprintf(&b, "<section id=\"%s\">\n<h2>%s</h2>\n", anchor(s.title), html.EscapeString(s.title))
		for _, bl := range s.blocks {
			switch {
			case bl.heading != "":
				num, stepName, _ := strings.Cut(bl.heading, " ")
				fmt.Fprintf(&b, "<article class=\"step\" id=\"%s\"><header><span class=\"num\">%s</span><h3>%s</h3>%s</header>\n",
					anchor(bl.heading), num, html.EscapeString(stepName), bl.tag)
			case bl.list != nil:
				b.WriteString("<ul>\n")
				for i, l := range bl.list {
					switch {
					case bl.lis == nil:
						fmt.Fprintf(&b, "<li>%s</li>\n", htm(l))
					case bl.lis[i] != "":
						b.WriteString(bl.lis[i] + "\n")
					}
				}
				b.WriteString("</ul>\n")
				if s.title == "3. Procedure" {
					b.WriteString("</article>\n")
				}
			case bl.head != nil:
				b.WriteString("<table>\n<thead><tr>")
				for _, h := range bl.head {
					fmt.Fprintf(&b, "<th>%s</th>", html.EscapeString(h))
				}
				b.WriteString("</tr></thead>\n<tbody>\n")
				for _, row := range bl.rows {
					b.WriteString("<tr>")
					for i, c := range row {
						if h := bl.head[i]; h == "Name" || h == "Field" {
							fmt.Fprintf(&b, "<td class=\"name\">%s</td>", htm(c))
						} else {
							fmt.Fprintf(&b, "<td>%s</td>", htm(c))
						}
					}
					b.WriteString("</tr>\n")
				}
				b.WriteString("</tbody>\n</table>\n")
			default:
				fmt.Fprintf(&b, "<p>%s</p>\n", htm(bl.text))
			}
		}
		b.WriteString("</section>\n")
	}
	b.WriteString("</main>\n</body>\n</html>\n")
	return []byte(b.String())
}
