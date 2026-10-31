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
	"regexp"
	"slices"
	"strconv"
	"strings"
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
// kind sets one field.
type block struct {
	heading string
	text    line
	list    []line
	head    []string
	rows    []cells
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
			items = task(n, edges, roleName, nodeName, sourceName)
		}
		out = append(out, block{heading: fmt.Sprintf("3.%d %s", k+1, n.Name)}, block{list: items})
	}
	return out
}

// task is the list of one task step.
func task(n process.Node, edges []process.Edge, roleName, nodeName, sourceName map[string]string) []line {
	items := []line{plain("Responsible: no role is set.")}
	if n.Role != nil {
		items[0] = plain("Responsible: " + nameOr(roleName, *n.Role) + ".")
	}
	if n.DeadlineHours != nil {
		items = append(items, plain(fmt.Sprintf("Deadline: %d hours from the arrival of the case.", *n.DeadlineHours)))
	} else {
		items = append(items, plain("Deadline: none."))
	}
	if len(n.Documents) > 0 {
		items = append(items, plain("Required documents: "+strings.Join(n.Documents, ", ")+"."))
	}
	if n.Signature {
		items = append(items, plain("Signature: the participant signs the step before it closes."))
	}
	for _, c := range n.Checks {
		r := ""
		if len(c.Citations) > 0 {
			r = " Reference: " + refs(c.Citations) + "."
		}
		expr := span{text: c.Expression, code: true}
		if c.PlainText != nil {
			items = append(items, line{{text: "Rule: " + end(*c.PlainText) + " Expression: "}, expr, {text: "." + r}})
		} else {
			items = append(items, line{{text: "Rule: "}, expr, {text: ". Message when it fails: \"" + c.Message + "\"" + r}})
		}
	}
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
	if len(n.Citations) > 0 {
		items = append(items, plain("Reference: "+refs(n.Citations)+"."))
	}
	return items
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

const css = `body{font-family:Georgia,serif;max-width:720px;margin:2em auto;padding:0 1em;color:#111}
table{border-collapse:collapse;margin:1em 0}th,td{border:1px solid #999;padding:4px 8px;text-align:left}
code{font-size:90%}#diagram{position:relative;left:50%;transform:translateX(-50%);width:calc(100vw - 2em)}
#diagram svg{display:block;max-width:100%;height:auto;margin:1em auto}
@media print{section{break-inside:auto}#diagram{left:0;transform:none;width:auto}}`

// HTML renders the printable page: the same sections, the process
// definition as JSON for the diagram script, and minimal inline CSS.
func HTML(def process.Definition) []byte {
	var b strings.Builder
	name := html.EscapeString(def.Name)
	// Marshal cannot fail for this type. It escapes <, > and &, so the JSON cannot close the script.
	data, _ := json.Marshal(def)
	fmt.Fprintf(&b, "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"+
		"<title>%s</title>\n<style>\n%s\n</style>\n</head>\n<body>\n<h1>%s</h1>\n<p>%s</p>\n"+
		"<div id=\"diagram\"></div>\n"+
		"<script type=\"application/json\" id=\"process-definition\">%s</script>\n"+
		"<script type=\"module\" src=\"/assets/doc-diagram.js\"></script>\n",
		name, css, name, intro, data)
	for _, s := range sections(def) {
		fmt.Fprintf(&b, "<section>\n<h2>%s</h2>\n", s.title)
		for _, bl := range s.blocks {
			switch {
			case bl.heading != "":
				fmt.Fprintf(&b, "<h3>%s</h3>\n", html.EscapeString(bl.heading))
			case bl.list != nil:
				b.WriteString("<ul>\n")
				for _, l := range bl.list {
					fmt.Fprintf(&b, "<li>%s</li>\n", htm(l))
				}
				b.WriteString("</ul>\n")
			case bl.head != nil:
				b.WriteString("<table>\n<thead><tr>")
				for _, h := range bl.head {
					fmt.Fprintf(&b, "<th>%s</th>", html.EscapeString(h))
				}
				b.WriteString("</tr></thead>\n<tbody>\n")
				for _, row := range bl.rows {
					b.WriteString("<tr>")
					for _, c := range row {
						fmt.Fprintf(&b, "<td>%s</td>", htm(c))
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
	b.WriteString("</body>\n</html>\n")
	return []byte(b.String())
}
