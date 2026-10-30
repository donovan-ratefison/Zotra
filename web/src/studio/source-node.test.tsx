// The test rows of the source cards on the diagram. The environment
// is node: renderToString for the components, no jsdom (the patterns
// of the delivered rows).

import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import { ElkEdge, isSourceNode, SourceCard, SourceLegendRow } from "./diagram";
import { layoutProcess, withSources } from "./layout";
import exampleJson from "../../../examples/home-loan/process.json";
import type { NodeType, ProcessDefinition, ProcessNode, SourceRow } from "./types";

const node = (id: string, type: NodeType, name: string, extra: Partial<ProcessNode> = {}): ProcessNode => ({
  id, type, name, role: null, deadline_hours: null, documents: [], signature: false,
  checks: [], decisions: [], end_result: null, scope_overrides: [], source_ids: [],
  citations: [], ...extra,
});

// The two sources of the example process, copied from
// examples/home-loan/process.json.
const exampleSources: SourceRow[] = [
  { id: "blacklist", name: "Credit blacklist", url: "http://127.0.0.1:8097/blacklist", test_values: { listed: false } },
  { id: "existing_loans", name: "Existing loans", url: "http://127.0.0.1:8097/loans", test_values: { monthly_total: 0.0 } },
];

// The miniDefinition pattern of the delivered layout rows.
function fixture(entrySources: string[], sources: SourceRow[] = exampleSources, releasedId = "released"): ProcessDefinition {
  return {
    schema_version: "1",
    name: "Mini loan",
    currency: "EUR",
    policy_document_id: null,
    theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
    roles: [{ id: "advisor", name: "Advisor", department: "Branch" }],
    fields: [{ name: "amount", label: "Amount", type: "money", options: [], computed: null }],
    scope: [{ field: "amount", role: "advisor", access: "write" }],
    nodes: [
      node("start", "start", "Application received"),
      node("entry", "task", "Application entry", { role: "advisor", deadline_hours: 24, documents: ["ID"], source_ids: entrySources }),
      node("review", "task", "Review", { role: "ghost" }),
      node("complete", "gateway", "File complete?"),
      node(releasedId, "end", "Loan released", { end_result: "approved" }),
      node("refused", "end", "Loan refused", { end_result: "refused" }),
    ],
    edges: [
      { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
      { id: "e2", from: "entry", to: "review", label: null, decision: null, condition: null, is_default: false },
      { id: "e3", from: "review", to: "complete", label: null, decision: null, condition: null, is_default: false },
      { id: "e4", from: "complete", to: releasedId, label: null, decision: null, condition: "size(documents) >= 4", is_default: false },
      { id: "e5", from: "complete", to: "refused", label: null, decision: null, condition: "amount < 0.0", is_default: false },
      { id: "e6", from: "complete", to: "entry", label: "Send back", decision: null, condition: null, is_default: true },
    ],
    sources,
  };
}

describe("source cards on the diagram", () => {
  test("W1: one card 40 px above its task, one dotted link with two points", async () => {
    const def = fixture(["blacklist"]);
    const input = await layoutProcess(def);
    const r = withSources(def, input);
    expect(r.sources.nodes.map((n) => n.id)).toEqual(["source:blacklist"]);
    const card = r.sources.nodes[0]!;
    const entry = r.nodes.find((n) => n.id === "entry")!;
    expect(card.position.y + card.height!).toBe(entry.position.y - 40);
    expect(card).toMatchObject({
      type: "source", draggable: false, selectable: false, focusable: false,
      ariaLabel: "Credit blacklist, external source",
    });
    expect(r.sources.edges).toHaveLength(1);
    const link = r.sources.edges[0]!;
    expect(link).toMatchObject({ id: "source-link:entry:blacklist", source: "source:blacklist", target: "entry", type: "elk" });
    expect(link.data!.points).toHaveLength(2);
    expect(link.data!.pill).toBeNull();
    expect(link.markerEnd).toBeUndefined();
    // The card top moves to 8, and every step moves with it.
    const dy = 8 - (input.nodes.find((n) => n.id === "entry")!.position.y - 76);
    expect(card.position.y).toBe(8);
    expect(r.height).toBe(input.height + dy);
    expect(entry.position.y).toBe(input.nodes.find((n) => n.id === "entry")!.position.y + dy);
    expect(r.edges[0]!.data!.points[0]!.y).toBe(input.edges[0]!.data!.points[0]!.y + dy);
    // The input stays unchanged.
    expect(input).not.toHaveProperty("sources");
  });

  test("W1 refused: a source id that names no source gives no card", async () => {
    const def = fixture(["ghost"]);
    const input = await layoutProcess(def);
    expect(withSources(def, input).sources).toEqual({ nodes: [], edges: [] });
  });

  test("W1b: isSourceNode", () => {
    expect(isSourceNode("source:blacklist")).toBe(true);
    expect(isSourceNode("entry")).toBe(false);
  });

  test("W1c refused: a source whose card id equals a node id is skipped", async () => {
    const def = fixture(["blacklist"], exampleSources, "source:blacklist");
    const r = withSources(def, await layoutProcess(def));
    expect(r.sources).toEqual({ nodes: [], edges: [] });
  });

  test("W1d: the example puts two cards above Credit analysis, links with four points", async () => {
    const def = exampleJson as unknown as ProcessDefinition;
    const input = await layoutProcess(def);
    const r = withSources(def, input);
    const task = r.nodes.find((n) => n.id === "analysis")!;
    expect(r.sources.nodes.map((n) => n.id)).toEqual(["source:blacklist", "source:existing_loans"]);
    for (const card of r.sources.nodes) {
      expect(card.position.y + card.height!).toBe(task.position.y - 40);
    }
    expect(r.sources.edges.map((e) => e.id)).toEqual([
      "source-link:analysis:blacklist",
      "source-link:analysis:existing_loans",
    ]);
    const ends = r.sources.edges.map((e) => e.data!.points);
    expect(ends.map((p) => p.length)).toEqual([4, 4]);
    expect(ends[0]![3]).toEqual({ x: task.position.x + task.width! / 3, y: task.position.y });
    expect(ends[1]![3]).toEqual({ x: task.position.x + (task.width! * 2) / 3, y: task.position.y });
    expect(r.height).toBe(input.height + 30);
  });

  test("W2: the card, the legend row and the dotted link render", () => {
    const card = renderToString(
      createElement(ReactFlowProvider, null, createElement(SourceCard, { source: exampleSources[0]! })),
    );
    expect(card).toContain("Credit blacklist");
    expect(card).toContain("lucide-database");
    const row = renderToString(createElement(SourceLegendRow));
    expect(row).toContain("External source");
    expect(row).toContain("lucide-database");
    const edge = renderToString(
      createElement(ElkEdge, {
        id: "source-link:entry:blacklist",
        markerEnd: "url(#arrow)",
        data: { points: [{ x: 0, y: 0 }, { x: 0, y: 40 }], pill: "Send back", anchor: { x: 0, y: 20 } },
      } as unknown as ComponentProps<typeof ElkEdge>),
    );
    expect(edge).toContain("4 3");
    expect(edge).not.toContain("marker-end");
    expect(edge).not.toContain("Send back");
  });

  test("W3: with no source the layout stays the same", async () => {
    const def = fixture([], []);
    const input = await layoutProcess(def);
    const r = withSources(def, input);
    expect(r.nodes).toBe(input.nodes);
    expect(r.edges).toBe(input.edges);
    expect(r.width).toBe(input.width);
    expect(r.height).toBe(input.height);
    expect(r.sources).toEqual({ nodes: [], edges: [] });
  });
});
