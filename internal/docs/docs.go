// Package docs generates the documentation of one process version
// from its process file: Markdown and a printable HTML page. The page
// draws the diagram in the browser with the layout of the studio. The
// output depends on the definition only, so the documentation of a
// frozen version never changes.
package docs

import (
	"encoding/json"
	"fmt"
	"html"
	"slices"
	"strings"

	"github.com/donovan-ratefison/zotra/internal/process"
)

const intro = "Process documentation, generated from the process file."

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

// listOrDash returns a bullet list, or the paragraph "-" for no item.
func listOrDash(items []line) block {
	if len(items) == 0 {
		return block{text: plain("-")}
	}
	return block{list: items}
}

// sections builds the content shared by the Markdown and the HTML.
func sections(def process.Definition) []section {
	roleName := map[string]string{}
	var roles []line
	for _, r := range def.Roles {
		roleName[r.ID] = r.Name
		roles = append(roles, plain(fmt.Sprintf("%s (%s)", r.Name, r.Department)))
	}
	out := []section{
		{"Roles", []block{listOrDash(roles)}},
		{"Data model", []block{dataModel(def)}},
		{"Data scope", []block{dataScope(def)}},
		{"Steps", steps(def, roleName)},
	}
	if len(def.Sources) > 0 {
		var src []line
		for _, s := range def.Sources {
			src = append(src, plain(fmt.Sprintf("%s (%s), %s", s.Name, s.ID, s.URL)))
		}
		out = append(out, section{"External sources", []block{{list: src}}})
	}
	var cited []string
	for _, n := range def.Nodes {
		cited = append(cited, n.Citations...)
		for _, c := range n.Checks {
			cited = append(cited, c.Citations...)
		}
	}
	slices.Sort(cited)
	cited = slices.Compact(cited)
	return append(out, section{"Policy citations", []block{{text: plain(orDash(cited))}}})
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

// steps is one heading and one bullet list for each node.
func steps(def process.Definition, roleName map[string]string) []block {
	nodeName := map[string]string{}
	for _, n := range def.Nodes {
		nodeName[n.ID] = n.Name
	}
	var out []block
	for _, n := range def.Nodes {
		role, deadline := "-", "-"
		if n.Role != nil {
			role = roleName[*n.Role]
			if role == "" {
				role = *n.Role
			}
		}
		if n.DeadlineHours != nil {
			deadline = fmt.Sprintf("%d h", *n.DeadlineHours)
		}
		signature := "No"
		if n.Signature {
			signature = "Yes"
		}
		var overrides []string
		for _, o := range n.ScopeOverrides {
			overrides = append(overrides, o.Field+": "+o.Access)
		}
		items := []line{
			plain("Type: " + n.Type),
			plain("Role: " + role),
			plain("Deadline: " + deadline),
			plain("Documents: " + orDash(n.Documents)),
			plain("Signature: " + signature),
			plain("Scope overrides: " + orDash(overrides)),
		}
		if len(n.Citations) > 0 {
			items = append(items, plain("Cited: "+strings.Join(unique(n.Citations), ", ")))
		}
		for _, c := range n.Checks {
			text := "Not documented."
			if c.PlainText != nil {
				text = *c.PlainText
			}
			if len(c.Citations) > 0 {
				text += " Cited: " + strings.Join(c.Citations, ", ")
			}
			items = append(items, line{{text: "Check "}, {text: c.Expression, code: true}, {text: ": " + text}})
		}
		if n.Type == "gateway" {
			for _, e := range def.Edges {
				if e.From != n.ID {
					continue
				}
				l := line{{text: "Condition to " + nodeName[e.To] + ": "}}
				switch {
				case e.Condition != nil:
					l = append(l, span{text: *e.Condition, code: true})
				case e.Label != nil:
					l = append(l, span{text: *e.Label})
				default:
					l = append(l, span{text: "Otherwise"})
				}
				if e.IsDefault {
					l = append(l, span{text: " (default)"})
				}
				items = append(items, l)
			}
		}
		out = append(out, block{heading: n.Name}, block{list: items})
	}
	return out
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
