// The diagram of the documentation page as an SVG string: the studio
// layout, drawn with the shapes and colors of the studio canvas.

import { estimatePillWidth, labelSize, roleColor, type Layout } from "./layout";
import type { ProcessDefinition } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) => String(Math.round(v * 10) / 10);

// Words go on the last line while it has max characters or less. A
// longer word stays whole on its own line.
export function wrapLines(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ").filter(Boolean)) {
    const joined = `${lines[lines.length - 1]} ${word}`;
    if (lines.length > 0 && joined.length <= max) {
      lines[lines.length - 1] = joined;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

function textLines(lines: string[], x: number, y: number, attrs: string): string {
  const spans = lines.map((l, i) => `<tspan x="${num(x)}" dy="${i === 0 ? 0 : 14}">${esc(l)}</tspan>`);
  return `<text x="${num(x)}" y="${num(y)}" ${attrs}>${spans.join("")}</text>`;
}

function endStroke(result: string | null): string {
  if (result === "approved") return "#16a34a";
  if (result === "refused") return "#dc2626";
  return "#71717a";
}

export function diagramSvg(layout: Layout, def: ProcessDefinition): string {
  const w = num(layout.width);
  const h = num(layout.height);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter, sans-serif" font-size="11.5" role="img" aria-label="Diagram of ${esc(def.name)}">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#71717a"/></marker></defs>`,
  ];
  for (const e of layout.edges) {
    const d = e.data!.points.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ");
    out.push(`<path id="edge-${esc(e.id)}" d="${d}" fill="none" stroke="#71717a" stroke-width="1.5" marker-end="url(#arrow)"/>`);
  }
  for (const n of layout.nodes) {
    const node = n.data.node;
    const { x, y } = n.position;
    const nw = n.width ?? 0;
    const nh = n.height ?? 0;
    const cx = x + nw / 2;
    const cy = y + nh / 2;
    let body: string;
    if (node.type === "task") {
      const lines = wrapLines(node.name, 22);
      const shown = lines.length > 2 ? [lines[0]!, `${lines[1]}...`] : lines;
      const role = def.roles.find((r) => r.id === node.role)?.name;
      body =
        `<rect x="${num(x)}" y="${num(y)}" width="${num(nw)}" height="${num(nh)}" rx="8" fill="#ffffff" stroke="#d4d4d8"/>` +
        textLines(shown, x + 10, y + 21, `font-weight="600" fill="#09090b"`) +
        (role === undefined
          ? ""
          : `<text x="${num(x + 10)}" y="${num(y + nh - 10)}" font-size="10" fill="${roleColor(def, node.role)}">${esc(role)}</text>`);
    } else {
      if (node.type === "gateway") {
        body = `<polygon points="${num(cx)},${num(y)} ${num(x + nw)},${num(cy)} ${num(cx)},${num(y + nh)} ${num(x)},${num(cy)}" fill="#ffffff" stroke="#a1a1aa" stroke-width="1.5"/>`;
      } else if (node.type === "start") {
        body = `<circle cx="${num(cx)}" cy="${num(cy)}" r="18" fill="#ffffff" stroke="#71717a" stroke-width="1.5"/>`;
      } else {
        body = `<circle cx="${num(cx)}" cy="${num(cy)}" r="17" fill="#ffffff" stroke="${endStroke(node.end_result)}" stroke-width="3.5"/>`;
      }
      // The same label box as layoutProblems in layout.ts.
      const pos = n.data.labelPos ?? "below";
      const top = pos === "above" ? y - 4 - labelSize(node.name).h : y + nh + 4;
      const lines = wrapLines(node.name, 18);
      body += pos === "left"
        ? textLines(lines, cx - 8, top + 11, `text-anchor="end" fill="#3f3f46"`)
        : textLines(lines, cx, top + 11, `text-anchor="middle" fill="#3f3f46"`);
    }
    out.push(`<g id="node-${esc(n.id)}">${body}</g>`);
  }
  for (const e of layout.edges) {
    const { anchor, pill } = e.data!;
    if (anchor == null || pill === null) continue;
    const pw = estimatePillWidth(pill);
    out.push(
      `<g class="pill"><rect x="${num(anchor.x - pw / 2)}" y="${num(anchor.y - 7.5)}" width="${num(pw)}" height="15" rx="3" fill="#ffffff"/>` +
        `<text x="${num(anchor.x)}" y="${num(anchor.y + 4)}" text-anchor="middle" font-size="11" fill="#3f3f46">${esc(pill)}</text></g>`,
    );
  }
  out.push("</svg>");
  return out.join("\n");
}
