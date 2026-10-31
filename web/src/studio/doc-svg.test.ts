// The test rows of the documentation diagram (D1 to D7).

import { describe, expect, test } from "vitest";
import seedJson from "../../../internal/store/seed/example-process.json";
import { diagramSvg, wrapLines } from "./doc-svg";
import { layoutProcess } from "./layout";
import type { ProcessDefinition, ProcessEdge, ProcessNode } from "./types";

const seed = seedJson as ProcessDefinition;

// The seed with a second gateway in series before "threshold".
function seriesDefinition(): ProcessDefinition {
  const threshold = seed.nodes.find((n) => n.id === "threshold")!;
  const valuation: ProcessNode = {
    id: "valuation", type: "task", name: "Property valuation", role: "analyst", deadline_hours: 72,
    documents: ["Valuation report"], signature: false, checks: [], decisions: [], end_result: null,
    scope_overrides: [], source_ids: [], citations: [],
  };
  const edge = (id: string, from: string, to: string, condition: string | null, isDefault: boolean): ProcessEdge =>
    ({ id, from, to, label: null, decision: null, condition, is_default: isDefault });
  return {
    ...seed,
    nodes: [...seed.nodes, { ...threshold, id: "high_amount", name: "Amount above EUR 300,000?" }, valuation],
    edges: [
      ...seed.edges.map((e) => (e.id === "e05" ? { ...e, to: "high_amount" } : e)),
      edge("e15", "high_amount", "valuation", "amount > 300000.0", false),
      edge("e16", "high_amount", "threshold", null, true),
      edge("e17", "valuation", "threshold", null, false),
    ],
  };
}

const count = (svg: string, part: string) => svg.split(part).length - 1;
const svgOf = async (def: ProcessDefinition) => diagramSvg(await layoutProcess(def), def);
const nodeGroup = (svg: string, id: string) => svg.split("\n").find((l) => l.startsWith(`<g id="node-${id}">`))!;
const tspans = (group: string) => [...group.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);

describe("doc-svg", () => {
  test("D1: series counts", async () => {
    const svg = await svgOf(seriesDefinition());
    expect(count(svg, '<g id="node-')).toBe(13);
    expect(count(svg, '<path id="edge-')).toBe(17);
    expect(count(svg, '<g class="pill">')).toBe(11);
    expect(count(svg, ">Yes<")).toBe(3);
    expect(count(svg, ">No<")).toBe(2);
  });

  test("D2: series first line", async () => {
    const svg = await svgOf(seriesDefinition());
    expect(svg.split("\n")[0]).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1444.8" height="572" viewBox="0 0 1444.8 572" font-family="Inter, sans-serif" font-size="11.5" role="img" aria-label="Diagram of Home loan">',
    );
  });

  test("D3: seed counts and end colors", async () => {
    const svg = await svgOf(seed);
    expect(count(svg, '<g id="node-')).toBe(11);
    expect(count(svg, '<path id="edge-')).toBe(14);
    expect(count(svg, '<g class="pill">')).toBe(9);
    expect(svg).toContain(
      '<g id="node-released"><circle cx="1172.8" cy="230" r="17" fill="#ffffff" stroke="#16a34a" stroke-width="3.5"/>',
    );
    expect(nodeGroup(svg, "refused")).toContain('stroke="#dc2626"');
  });

  test("D4: series gateway label on two lines", async () => {
    const svg = await svgOf(seriesDefinition());
    expect(tspans(nodeGroup(svg, "high_amount"))).toEqual(["Amount above EUR", "300,000?"]);
  });

  test("D5: text is escaped", async () => {
    const def: ProcessDefinition = {
      ...seed,
      name: 'A <b> & "c"',
      nodes: seed.nodes.map((n) => (n.id === "entry" ? { ...n, name: "x<y" } : n)),
    };
    const svg = await svgOf(def);
    expect(svg).toContain('aria-label="Diagram of A &lt;b&gt; &amp; &quot;c&quot;"');
    expect(svg).toContain(">x&lt;y<");
  });

  test("D6: wrapLines", () => {
    expect(wrapLines("Amount above EUR 300,000?", 18)).toEqual(["Amount above EUR", "300,000?"]);
    expect(wrapLines("Client signature at the branch", 22)).toEqual(["Client signature at", "the branch"]);
    expect(wrapLines("Supercalifragilisticexpialidocious yes", 18)).toEqual(["Supercalifragilisticexpialidocious", "yes"]);
    expect(wrapLines("", 18)).toEqual([]);
  });

  test("D7: a long task name keeps two lines", async () => {
    const name = "Check the identity documents of each borrower and guarantor";
    expect(wrapLines(name, 22)).toEqual(["Check the identity", "documents of each", "borrower and guarantor"]);
    const def: ProcessDefinition = {
      ...seed,
      nodes: seed.nodes.map((n) => (n.id === "entry" ? { ...n, name } : n)),
    };
    expect(tspans(nodeGroup(await svgOf(def), "entry"))).toEqual(["Check the identity", "documents of each..."]);
  });
});
