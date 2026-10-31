// The studio test rows, in order.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Position, ReactFlowProvider, type Node } from "@xyflow/react";
import { getVersion, listProcesses, listVersions, ApiError } from "./api";
import {
  bends,
  bestCandidate,
  crossings,
  diagramEdgeText,
  edgePillText,
  estimatePillWidth,
  gridLayout,
  labelBox,
  labelSize,
  layoutCandidates,
  layoutProblems,
  layoutProcess,
  nextCandidate,
  PILL_HEIGHT,
  PILL_MARGIN,
  pillPlacement,
  roleColor,
  toElkGraph,
  type FlowEdge,
  type Layout,
} from "./layout";
import { EdgePill, edgeAnchor, EventShape, fitViewport, focusBox, focusViewport, neighborIn, TaskCard } from "./diagram";
import { addNode, connect } from "./edit";
import { structureProblems } from "./ProcessPanel";
import {
  afterRedo,
  afterSave,
  afterUndo,
  historyKey,
  pushUndo,
  StudioShell,
  TopBar,
} from "./StudioShell";
import ELK from "elkjs/lib/elk.bundled.js";
import seedJson from "../../../internal/store/seed/example-process.json";
import aiHomeJson from "./testdata/ai-home.json";
import aiConstructionJson from "./testdata/ai-construction.json";
import aiSmeJson from "./testdata/ai-sme.json";
import type {
  NodeType,
  ProcessDefinition,
  ProcessEdge,
  ProcessNode,
  VersionStatus,
  VersionSummary,
} from "./types";

const miniDefinition: ProcessDefinition = {
  schema_version: "1",
  name: "Mini loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
  roles: [{ id: "advisor", name: "Advisor", department: "Branch" }],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
  ],
  scope: [{ field: "amount", role: "advisor", access: "write" }],
  nodes: [
    {
      id: "start", type: "start", name: "Application received", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "entry", type: "task", name: "Application entry", role: "advisor",
      deadline_hours: 24, documents: ["ID"], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "review", type: "task", name: "Review", role: "ghost",
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "complete", type: "gateway", name: "File complete?", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "released", type: "end", name: "Loan released", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "approved", scope_overrides: [],
      source_ids: [], citations: [],
    },
    {
      id: "refused", type: "end", name: "Loan refused", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "refused", scope_overrides: [],
      source_ids: [], citations: [],
    },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
    { id: "e2", from: "entry", to: "review", label: null, decision: null, condition: null, is_default: false },
    { id: "e3", from: "review", to: "complete", label: null, decision: null, condition: null, is_default: false },
    { id: "e4", from: "complete", to: "released", label: null, decision: null, condition: "size(documents) >= 4", is_default: false },
    { id: "e5", from: "complete", to: "refused", label: null, decision: null, condition: "amount < 0.0", is_default: false },
    { id: "e6", from: "complete", to: "entry", label: "Send back", decision: null, condition: null, is_default: true },
  ],
  sources: [],
};

const edgeById = (id: string): ProcessEdge =>
  miniDefinition.edges.find((e) => e.id === id)!;

// One copy of a mini definition node, with a new id: every field
// value comes from the model node.
function nodeCopy(model: string, id: string): ProcessNode {
  return { ...miniDefinition.nodes.find((node) => node.id === model)!, id };
}

// A six-node definition for the pill placement rows: the gateway
// holds one long condition edge and one default edge, and the gap to
// the first task is 60 px, so the condition pill drops and the
// default pill stays free. It satisfies the process contract: one
// start with one outgoing edge, tasks with one outgoing edge each,
// one gateway default edge, every path reaches an end.
const craftedDefinition: ProcessDefinition = {
  ...miniDefinition,
  name: "Pill placement",
  nodes: [
    nodeCopy("start", "start"),
    nodeCopy("complete", "gt"),
    nodeCopy("entry", "t1"),
    nodeCopy("entry", "t2"),
    nodeCopy("released", "end1"),
    nodeCopy("refused", "end2"),
  ],
  edges: [
    { id: "a", from: "start", to: "gt", label: null, decision: null, condition: null, is_default: false },
    { id: "b", from: "gt", to: "t1", label: null, decision: null, condition: "amount > 100000.0", is_default: false },
    { id: "c", from: "gt", to: "t2", label: null, decision: null, condition: null, is_default: true },
    { id: "d", from: "t1", to: "end1", label: null, decision: null, condition: null, is_default: false },
    { id: "e", from: "t2", to: "end2", label: null, decision: null, condition: null, is_default: false },
  ],
};

// The error-path stubs need only ok, status and json, the surface
// that getJson reads.
function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    () => Promise.resolve({ ok: status < 400, status, json: async () => body }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// A full version row with exact values; status accepts any raw value,
// so the unknown-status row can use "archived".
function versionRow(number: number, status: string): VersionSummary {
  return {
    id: `v${number}`,
    process_id: "p1",
    parent_id: null,
    number,
    label: "Initial",
    status: status as VersionStatus,
    created_at: "2026-10-27T09:00:00Z",
    frozen_at: status === "published" ? "2026-10-27T09:30:00Z" : null,
  };
}

describe("layout helpers", () => {
  test("1: roleColor of a known role", () => {
    expect(roleColor(miniDefinition, "advisor")).toBe("#0891b2");
  });

  test("2: roleColor of an unknown role and of null", () => {
    expect(roleColor(miniDefinition, "nobody")).toBeNull();
    expect(roleColor(miniDefinition, null)).toBeNull();
  });

  test("3: edgePillText of a labeled edge", () => {
    expect(edgePillText(edgeById("e6"))).toBe("Send back");
  });

  test("4: edgePillText of a condition edge", () => {
    expect(edgePillText(edgeById("e4"))).toBe("size(documents) >= 4");
  });

  test("5: edgePillText of a decision edge", () => {
    expect(
      edgePillText({
        id: "x", from: "a", to: "b", label: null, decision: "approve",
        condition: null, is_default: false,
      }),
    ).toBe("approve");
  });

  test("6: edgePillText of a default edge", () => {
    expect(
      edgePillText({
        id: "x", from: "a", to: "b", label: null, decision: null,
        condition: null, is_default: true,
      }),
    ).toBe("Default");
  });

  test("7: edgePillText of a plain edge", () => {
    expect(edgePillText(edgeById("e1"))).toBeNull();
  });

  test("8: layoutProcess lays out the mini definition", async () => {
    const { nodes, edges } = await layoutProcess(miniDefinition);
    expect(nodes).toHaveLength(6);
    expect(edges).toHaveLength(6);
    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }
    for (const edge of edges) {
      expect(edge.data!.points.length).toBeGreaterThanOrEqual(2);
      for (const point of edge.data!.points) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }
    // The grid layout: entry and review sit on the main row, so the
    // link between them is one straight segment.
    const e2 = edges.find((edge) => edge.id === "e2")!;
    expect(e2.data!.points.length).toBe(2);
    expect(e2.data!.points[0]!.y).toBe(e2.data!.points[1]!.y);
    // The sizes live on the ELK graph itself, so this check fails
    // when toElkGraph forgets to apply a size.
    const graph = toElkGraph(miniDefinition);
    for (const child of graph.children!) {
      if (child.id === "entry" || child.id === "review") {
        expect(child.width).toBe(152);
        expect(child.height).toBe(72);
      }
      if (child.id === "complete") {
        expect(child.width).toBe(52);
        expect(child.height).toBe(52);
      }
    }
  });

  test("9: layoutProcess refuses an unknown node type", async () => {
    const badType: ProcessDefinition = {
      ...miniDefinition,
      nodes: miniDefinition.nodes.map((node) =>
        node.id === "entry"
          ? { ...node, type: "service" as unknown as NodeType }
          : node,
      ),
    };
    await expect(layoutProcess(badType)).rejects.toThrow(
      "unknown node type: service (node entry)",
    );
  });

  test("10: layoutProcess refuses an unknown edge endpoint", async () => {
    const badFrom: ProcessDefinition = {
      ...miniDefinition,
      edges: miniDefinition.edges.map((edge) =>
        edge.id === "e1" ? { ...edge, from: "nowhere" } : edge,
      ),
    };
    await expect(layoutProcess(badFrom)).rejects.toThrow(
      "unknown node id: nowhere (edge e1)",
    );
  });

  test("43: toElkGraph sets the DEPTH_FIRST cycle breaking strategy", () => {
    expect(toElkGraph(miniDefinition).layoutOptions).toMatchObject({
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    });
  });

  test("44: labelBox of the mini gateway wraps at 120 px and sits below", () => {
    const box = labelBox(
      miniDefinition.nodes.find((node) => node.id === "complete")!,
      { x: 10, y: 20, w: 52, h: 52 },
    );
    expect(box.x).toBeCloseTo(-17.2, 9);
    expect(box.y).toBe(76);
    expect(box.w).toBeCloseTo(106.4, 9);
    expect(box.h).toBe(15);
  });

  test("45: labelBox of the mini start caps at 120 px on two lines", () => {
    expect(
      labelBox(miniDefinition.nodes.find((node) => node.id === "start")!, {
        x: 0,
        y: 0,
        w: 40,
        h: 40,
      }),
    ).toEqual({ x: -40, y: 44, w: 120, h: 30 });
  });
});

describe("pill placement", () => {
  test("27: estimatePillWidth of a 7 character pill", () => {
    expect(estimatePillWidth("Default")).toBeCloseTo(60.2);
  });

  test("28: estimatePillWidth of the long condition", () => {
    expect(estimatePillWidth("amount > 100000.0")).toBeCloseTo(126.2);
  });

  test("29: pillPlacement keeps the midpoint of a free short edge", () => {
    expect(
      pillPlacement([{ x: 0, y: 0 }, { x: 40, y: 0 }], [], "abcd"),
    ).toEqual({ x: 20, y: 0 });
  });

  test("30: pillPlacement keeps the midpoint when the box is off the band", () => {
    expect(
      pillPlacement(
        [{ x: 0, y: 0 }, { x: 200, y: 0 }],
        [{ x: 0, y: 40, w: 10, h: 10 }],
        "abcd",
      ),
    ).toEqual({ x: 100, y: 0 });
  });

  test("31: pillPlacement moves to the nearest free stretch", () => {
    expect(
      pillPlacement(
        [{ x: 0, y: 0 }, { x: 300, y: 0 }],
        [{ x: 80, y: -20, w: 80, h: 40 }],
        "abcd",
      ),
    ).toEqual({ x: 241.1, y: 0 });
  });

  test("32: a box below the pill band does not block the stretch", () => {
    expect(
      pillPlacement(
        [{ x: 0, y: 0 }, { x: 300, y: 0 }],
        [{ x: 80, y: -20, w: 80, h: 40 }, { x: 230, y: 15, w: 20, h: 10 }],
        "abcd",
      ),
    ).toEqual({ x: 241.1, y: 0 });
  });

  test("33: pillPlacement moves on a blocked vertical edge", () => {
    expect(
      pillPlacement(
        [{ x: 50, y: 0 }, { x: 50, y: 300 }],
        [{ x: 30, y: 60, w: 40, h: 200 }],
        "abcd",
      ),
    ).toEqual({ x: 50, y: 25.25 });
  });

  test("34: a thin cover keeps the midpoint (10 percent hidden)", () => {
    expect(
      pillPlacement(
        [{ x: 0, y: 0 }, { x: 200, y: 0 }],
        [{ x: 0, y: 6, w: 200, h: 10 }],
        "abcd",
      ),
    ).toEqual({ x: 100, y: 0 });
  });

  test("35: a mostly hidden pill does not render (36.7 percent)", () => {
    expect(
      pillPlacement(
        [{ x: 0, y: 0 }, { x: 200, y: 0 }],
        [{ x: 0, y: 2, w: 200, h: 14 }],
        "abcd",
      ),
    ).toBeNull();
  });

  test("36: a diagonal edge has no stretch and keeps its free midpoint", () => {
    expect(
      pillPlacement(
        [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        [{ x: 0, y: 110, w: 10, h: 10 }],
        "abcd",
      ),
    ).toEqual({ x: 50, y: 50 });
  });

  test("37: edgeAnchor of data that carries an anchor", () => {
    expect(edgeAnchor({ anchor: { x: 5, y: 6 } }, [{ x: 0, y: 0 }, { x: 40, y: 0 }]))
      .toEqual({ x: 5, y: 6 });
  });

  test("38: edgeAnchor of a dropped pill", () => {
    expect(edgeAnchor({ anchor: null }, [{ x: 0, y: 0 }, { x: 40, y: 0 }]))
      .toBeNull();
  });

  test("39: edgeAnchor of legacy data without an anchor key", () => {
    expect(edgeAnchor({}, [{ x: 0, y: 0 }, { x: 40, y: 0 }]))
      .toEqual({ x: 20, y: 0 });
  });

  test("40: EdgePill renders the transform and the text", () => {
    const html = renderToString(
      createElement(EdgePill, { text: "X", anchor: { x: 5, y: 6 } }),
    );
    expect(html).toContain("translate(5px, 6px)");
    expect(html).toContain(">X<");
  });

  test("41: the yes or no gateway of the crafted definition reads Yes and No", async () => {
    const { edges } = await layoutProcess(craftedDefinition);
    expect(edges.find((edge) => edge.id === "b")!.data!.pill).toBe("Yes");
    expect(edges.find((edge) => edge.id === "c")!.data!.pill).toBe("No");
    expect(edges.find((edge) => edge.id === "b")!.data!.anchor).not.toBeNull();
  });

  test("42: the default pill of the crafted gateway stays clear", async () => {
    const { nodes, edges } = await layoutProcess(craftedDefinition);
    const anchor = edges.find((edge) => edge.id === "c")!.data!.anchor;
    expect(anchor).not.toBeNull();
    const nodeBoxes = nodes.map((n) => ({
      x: n.position.x,
      y: n.position.y,
      w: n.width ?? 0,
      h: n.height ?? 0,
    }));
    const w = estimatePillWidth("Default");
    const x = anchor!.x - w / 2 - PILL_MARGIN;
    const y = anchor!.y - PILL_HEIGHT / 2 - PILL_MARGIN;
    // The same positive-area overlap rule as the layout module.
    const overlaps = (b: { x: number; y: number; w: number; h: number }) => {
      const ox = Math.min(x + w + 2 * PILL_MARGIN, b.x + b.w) - Math.max(x, b.x);
      const oy = Math.min(y + PILL_HEIGHT + 2 * PILL_MARGIN, b.y + b.h) - Math.max(y, b.y);
      return ox > 0 && oy > 0;
    };
    for (const b of nodeBoxes) {
      expect(overlaps(b)).toBe(false);
    }
  });
});

// The seed process of the demo: the layout guard rows run on it.
const seedDefinition = seedJson as ProcessDefinition;

// Three real AI proposals (feedback item 0017).
const aiHome = aiHomeJson as ProcessDefinition;
const aiConstruction = aiConstructionJson as ProcessDefinition;
const aiSme = aiSmeJson as ProcessDefinition;

// The right edge of the widest row of a grid layout.
function widestRow(grid: NonNullable<ReturnType<typeof gridLayout>>): number {
  return Math.max(...[...grid.cells.values()].map((c) => c.cx + c.w / 2));
}

// A chain with no end: mainPath gives null, so the ELK fallback
// draws it.
function endlessChain(steps: number): ProcessDefinition {
  const def = chainDefinition(steps);
  return {
    ...def,
    nodes: def.nodes.filter((n) => n.id !== "released"),
    edges: def.edges.filter((e) => e.to !== "released"),
  };
}

// A chain of one start, the given number of plain steps and one
// approved end, for the wrap rows of gridLayout.
function chainDefinition(steps: number): ProcessDefinition {
  const nodes: ProcessNode[] = [
    { ...nodeCopy("start", "start") },
  ];
  const edges: ProcessEdge[] = [];
  for (let i = 1; i <= steps; i++) {
    nodes.push(nodeCopy("review", `t${i}`));
    edges.push({
      id: `e${i}`, from: i === 1 ? "start" : `t${i - 1}`, to: `t${i}`,
      label: null, decision: null, condition: null, is_default: false,
    });
  }
  nodes.push(nodeCopy("released", "released"));
  edges.push({
    id: `e${steps + 1}`, from: `t${steps}`, to: "released",
    label: null, decision: null, condition: null, is_default: false,
  });
  return { ...miniDefinition, name: "Chain", nodes, edges };
}

// A credit process in the shape of an AI proposal (the fb-009 probe
// of local/scratch/fb-009): a long main path of 10 steps, one refusal
// branch, and one or two return loops to early steps.
function proposalDefinition(loops: 1 | 2): ProcessDefinition {
  const node = (id: string, type: NodeType, name: string): ProcessNode => ({
    id, type, name, role: null, deadline_hours: null, documents: [],
    signature: false, checks: [], decisions: [], end_result: null,
    scope_overrides: [], source_ids: [], citations: [],
  });
  const edge = (
    id: string, from: string, to: string,
    extra: Partial<ProcessEdge> = {},
  ): ProcessEdge => (
    { id, from, to, label: null, decision: null, condition: null, is_default: false, ...extra }
  );
  const nodes: ProcessNode[] = [
    node("start", "start", "Application received"),
    node("collect", "task", "Collect documents"),
    node("fraud", "task", "Fraud screening"),
    node("complete", "gateway", "File complete?"),
    node("analysis", "task", "Credit analysis"),
    node("threshold", "gateway", "Amount above EUR 100,000?"),
    node("committee", "task", "Risk committee"),
    node("decision", "task", "Credit decision"),
    node("offer", "task", "Loan offer"),
    node("signing", "task", "Client signature"),
    node("compliance", "gateway", "Compliance clear?"),
    node("release", "task", "Release of funds"),
    { ...node("released", "end", "Loan released"), end_result: "approved" },
    { ...node("refused", "end", "Application refused"), end_result: "refused" },
  ];
  const edges: ProcessEdge[] = [
    edge("p01", "start", "collect"),
    edge("p02", "collect", "fraud"),
    edge("p03", "fraud", "complete"),
    edge("p04", "complete", "analysis", { condition: "size(documents) >= 4" }),
    edge("p05", "complete", "collect", { label: "Incomplete", is_default: true }),
    edge("p06", "analysis", "threshold", { decision: "favorable" }),
    edge("p07", "analysis", "refused", { decision: "unfavorable" }),
    edge("p08", "threshold", "committee", { condition: "amount > 100000.0" }),
    edge("p09", "threshold", "decision"),
    edge("p10", "committee", "decision"),
    edge("p11", "decision", "offer", { decision: "approve" }),
    edge("p12", "decision", "refused", { decision: "refuse" }),
    edge("p13", "decision", "analysis", { decision: "return" }),
    edge("p14", "offer", "signing"),
    edge("p15", "signing", "compliance"),
    edge("p16", "compliance", "release", { condition: "kyc == \"clear\"" }),
    edge("p18", "release", "released"),
  ];
  if (loops === 2) {
    edges.push(edge("p17", "compliance", "collect", { label: "Rejected", is_default: true }));
  } else {
    const p16 = edges.find((e) => e.id === "p16")!;
    p16.condition = null;
  }
  return { ...miniDefinition, name: "AI proposal", nodes, edges };
}

// The same proposal family over the step range of item 0016, with
// `steps - 10` extra tasks between signing and compliance. At 15
// steps the spine wraps into two rows plus the end rows: with the
// late refuser, the refusal end hangs under the credit decision
// (row 0) on row 2; without it, under the row 1 refuser of review
// round 4. The early refusal of the credit analysis then spans two
// row pairs.
function proposalFamily(steps: number, lateRefuser: boolean): ProcessDefinition {
  const edge = (
    id: string, from: string, to: string,
    extra: Partial<ProcessEdge> = {},
  ): ProcessEdge => (
    { id, from, to, label: null, decision: null, condition: null, is_default: false, ...extra }
  );
  const def = proposalDefinition(2);
  const extra = [
    ["c1", "Policy check"],
    ["c2", "Risk review"],
    ["c3", "Final review"],
    ["c4", "Offer check"],
    ["c5", "File preparation"],
    ["c6", "Data entry"],
  ] as const;
  const run = extra.slice(0, steps - 10);
  const nodes = [...def.nodes];
  nodes.splice(
    nodes.findIndex((n) => n.id === "compliance"),
    0,
    ...run.map(([id, name]) => ({
      id, type: "task" as const, name, role: null, deadline_hours: null,
      documents: [], signature: false, checks: [], decisions: [],
      end_result: null, scope_overrides: [], source_ids: [], citations: [],
    })),
  );
  const edges: ProcessEdge[] = [];
  const spine = ["signing", ...run.map(([id]) => id as string), "compliance"];
  for (const e of def.edges) {
    if (e.id === "p12" && !lateRefuser) {
      continue;
    }
    if (e.id === "p15") {
      for (let i = 1; i < spine.length; i++) {
        edges.push(edge(i === 1 ? "p15" : `s${i - 1}`, spine[i - 1]!, spine[i]!));
      }
    } else {
      edges.push({ ...e });
    }
  }
  return {
    ...def,
    name: `AI proposal ${steps}${lateRefuser ? ", both refusers" : ", early refuser"}`,
    nodes,
    edges,
  };
}

describe("diagram layout guard", () => {
  test("46: diagramEdgeText reads Yes and No on a yes or no gateway", () => {
    const text = (id: string) =>
      diagramEdgeText(seedDefinition.edges.find((e) => e.id === id)!, seedDefinition);
    expect(text("e07")).toBe("Yes");
    expect(text("e08")).toBe("No");
    expect(text("e04")).toBe("Incomplete");
    expect(text("e05")).toBe("favorable");
    expect(text("e01")).toBeNull();
  });

  test("47: diagramEdgeText keeps the condition of a gateway with more branches", () => {
    expect(diagramEdgeText(edgeById("e4"), miniDefinition)).toBe("size(documents) >= 4");
    expect(diagramEdgeText(edgeById("e6"), miniDefinition)).toBe("Send back");
  });

  test("48: the seed process takes the grid layout of the mockup", () => {
    const grid = gridLayout(seedDefinition)!;
    expect(grid).not.toBeNull();
    const row = (id: string) => grid.cells.get(id)!.row;
    for (const id of ["start", "entry", "complete", "analysis", "threshold", "offer", "signing", "release"]) {
      expect(row(id)).toBe(0);
    }
    expect(row("decision")).toBe(1);
    expect(row("refused")).toBe(2);
    expect(grid.cells.get("decision")!.cx).toBe(grid.cells.get("threshold")!.cx);
    expect(grid.cells.get("released")!.cx).toBe(grid.cells.get("release")!.cx);
  });

  test("48b: a process of 8 nodes keeps its main path on one row", () => {
    const six = gridLayout(chainDefinition(6))!;
    expect(six).not.toBeNull();
    expect(six.cells.get("start")!.row).toBe(0);
    for (let i = 1; i <= 6; i++) {
      expect(six.cells.get(`t${i}`)!.row).toBe(0);
    }
    // The final end keeps its own rule: under the task before it.
    expect(six.cells.get("released")!.row).toBe(1);
    expect(six.cells.get("released")!.cx).toBe(six.cells.get("t6")!.cx);
    // Seven steps on the main path still take the one row of the
    // mockup: the seed process is one.
    const seven = gridLayout(chainDefinition(7))!;
    expect(seven).not.toBeNull();
    for (let i = 1; i <= 7; i++) {
      expect(seven.cells.get(`t${i}`)!.row).toBe(0);
    }
  });

  test("48c: a main path wider than the row budget wraps left to right", () => {
    const grid = gridLayout(chainDefinition(12))!;
    expect(grid).not.toBeNull();
    // Row 0 holds start to t7 and stops under the row budget.
    expect(grid.cells.get("start")!.row).toBe(0);
    for (let i = 1; i <= 7; i++) {
      expect(grid.cells.get(`t${i}`)!.row).toBe(0);
    }
    expect(grid.cells.get("t7")!.cx + grid.cells.get("t7")!.w / 2).toBe(1356);
    // Row 1 holds t8 to t12, again left to right.
    for (let i = 8; i <= 12; i++) {
      expect(grid.cells.get(`t${i}`)!.row).toBe(1);
      expect(grid.cells.get(`t${i}`)!.cy).toBe(140);
    }
    expect(grid.cells.get("t8")!.cx).toBeLessThan(grid.cells.get("t9")!.cx);
    // The turn runs through the corridor between the two rows.
    const turn = grid.points.get("e8")!;
    expect(turn).toHaveLength(4);
    expect(turn[1]!.y).toBe(turn[2]!.y);
    expect(turn[1]!.y).toBeGreaterThan(36);
    expect(turn[1]!.y).toBeLessThan(104);
    // A spine step of row 1 is one straight link.
    expect(grid.points.get("e9")!).toHaveLength(2);
    // The final end keeps its rule: under the task before it.
    expect(grid.cells.get("released")!.cx).toBe(grid.cells.get("t12")!.cx);
    expect(grid.cells.get("released")!.row).toBe(2);
  });

  test("48d: an AI proposal shape with one loop takes the grid", () => {
    const grid = gridLayout(proposalDefinition(1))!;
    expect(grid).not.toBeNull();
    // The refusal end and the committee sit below the main row.
    expect(grid.cells.get("refused")!.row).toBe(1);
    expect(grid.cells.get("committee")!.row).toBe(1);
    expect(grid.cells.get("released")!.row).toBe(2);
    // The widest row stops under the row budget.
    const widest = Math.max(...[...grid.cells.values()].map((c) => c.cx + c.w / 2));
    expect(widest).toBeLessThanOrEqual(1360);
    // The committee return runs through the corridor between the rows.
    const up = grid.points.get("p10")!;
    expect(up).toHaveLength(4);
    expect(up[1]!.y).toBe(up[2]!.y);
    expect(up[1]!.y).toBeGreaterThan(36);
    expect(up[1]!.y).toBeLessThan(104);
    // The refusal drop ran through the corridor: its direct way down
    // would hit the committee node of row 1. It lands on the top edge
    // of the refusal end.
    const drop = grid.points.get("p07")!;
    expect(drop).toHaveLength(4);
    expect(drop[3]!.x).toBeCloseTo(936.8, 6);
    expect(drop[3]!.y).toBe(120);
  });

  test("48e: an AI proposal shape with two loops takes the grid", () => {
    const grid = gridLayout(proposalDefinition(2))!;
    expect(grid).not.toBeNull();
    expect(grid.cells.get("refused")!.row).toBe(1);
    const widest = Math.max(...[...grid.cells.values()].map((c) => c.cx + c.w / 2));
    expect(widest).toBeLessThanOrEqual(1360);
    // Both cross-row returns run through the corridor.
    for (const id of ["p10", "p17"]) {
      const pts = grid.points.get(id)!;
      expect(pts).toHaveLength(4);
      expect(pts[1]!.y).toBe(pts[2]!.y);
      expect(pts[1]!.y).toBeGreaterThan(36);
      expect(pts[1]!.y).toBeLessThan(104);
    }
  });

  test("48f: every fixture takes the grid path, not the ELK band", async () => {
    const fixtures = [
      seedDefinition,
      chainDefinition(6),
      chainDefinition(7),
      chainDefinition(12),
      proposalDefinition(1),
      proposalDefinition(2),
      proposalFamily(12, false),
      proposalFamily(15, true),
      proposalFamily(15, false),
      proposalFamily(16, true),
      aiHome,
      aiConstruction,
      aiSme,
    ];
    for (const def of fixtures) {
      expect(gridLayout(def), def.name).not.toBeNull();
      const { nodes } = await layoutProcess(def);
      // The grid path tags every node with a label position; the ELK
      // path does not.
      for (const n of nodes) {
        expect("labelPos" in (n.data ?? {}), `${def.name}: ${n.id}`).toBe(true);
      }
    }
  });

  test("48g: the seed cells stay identical to the layout before the wrap", () => {
    // The pinned cells of the layout at 2899fd0, before the left to
    // right wrap. The seed reads as in the mockup and no wrap rule
    // may move it.
    const old: Record<string, { cx: number; cy: number; w: number; h: number; row: number }> = {
      start: { cx: 20, cy: 0, w: 40, h: 40, row: 0 },
      entry: { cx: 152, cy: 0, w: 152, h: 72, row: 0 },
      complete: { cx: 290, cy: 0, w: 52, h: 52, row: 0 },
      analysis: { cx: 431.2, cy: 0, w: 152, h: 72, row: 0 },
      threshold: { cx: 610.8, cy: 0, w: 52, h: 52, row: 0 },
      offer: { cx: 748.8, cy: 0, w: 152, h: 72, row: 0 },
      signing: { cx: 936.8, cy: 0, w: 152, h: 72, row: 0 },
      release: { cx: 1124.8, cy: 0, w: 152, h: 72, row: 0 },
      released: { cx: 1124.8, cy: 140, w: 40, h: 40, row: 1 },
      decision: { cx: 610.8, cy: 140, w: 152, h: 72, row: 1 },
      refused: { cx: 610.8, cy: 280, w: 40, h: 40, row: 2 },
    };
    const grid = gridLayout(seedDefinition)!;
    const cells: Record<string, { cx: number; cy: number; w: number; h: number; row: number }> = {};
    for (const [id, c] of grid.cells) {
      cells[id] = { cx: c.cx, cy: c.cy, w: c.w, h: c.h, row: c.row };
    }
    expect(cells).toEqual(old);
  });

  test("48h: a 15-step proposal with both refusers takes the grid", () => {
    const grid = gridLayout(proposalFamily(15, true))!;
    expect(grid).not.toBeNull();
    // The refusal end, the committee and the release step sit on the
    // rows under the two spine rows, and the released end under the
    // release step.
    expect(grid.cells.get("refused")!.row).toBe(2);
    expect(grid.cells.get("committee")!.row).toBe(2);
    expect(grid.cells.get("release")!.row).toBe(2);
    expect(grid.cells.get("released")!.row).toBe(3);
    // The early refusal of the credit analysis spans two row pairs:
    // it runs through the band at each end and the outer margin
    // between, never through the band of the wrapped row 1.
    const drop = grid.points.get("p07")!;
    expect(drop).toHaveLength(6);
    expect(drop[1]!.y).toBe(drop[2]!.y);
    expect(drop[3]!.y).toBe(drop[4]!.y);
    expect(drop[1]!.y).toBeLessThan(104);
    expect(drop[3]!.y).toBeGreaterThan(176);
    // The straight drop of the threshold gateway is blocked by the
    // row 1 committee band and takes the same way out.
    expect(grid.points.get("p08")!).toHaveLength(6);
    // The return of the committee climbs through the margin too.
    expect(grid.points.get("p10")!).toHaveLength(6);
  });

  test("48i: a 15-step proposal with an early refuser takes the grid", () => {
    const grid = gridLayout(proposalFamily(15, false))!;
    expect(grid).not.toBeNull();
    // The right-most refuser is the final review on row 1, so the
    // refusal end lands on row 2 and the early refusal of the credit
    // analysis spans two row pairs.
    expect(grid.cells.get("refused")!.row).toBe(2);
    const drop = grid.points.get("p07")!;
    expect(drop).toHaveLength(6);
    expect(drop[1]!.y).toBeLessThan(104);
    expect(drop[3]!.y).toBeGreaterThan(176);
    expect(grid.points.get("p08")!).toHaveLength(6);
  });

  test("49: no seed link has a diagonal segment or crosses a shape", async () => {
    const { nodes, edges } = await layoutProcess(seedDefinition);
    const boxes = nodes.map((n) => ({
      id: n.id, x: n.position.x, y: n.position.y, w: n.width!, h: n.height!,
    }));
    for (const edge of edges) {
      const pts = edge.data!.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const box of boxes) {
          if (box.id === edge.source || box.id === edge.target) {
            continue;
          }
          const inside =
            Math.max(a.x, b.x) > box.x + 1 && Math.min(a.x, b.x) < box.x + box.w - 1 &&
            Math.max(a.y, b.y) > box.y + 1 && Math.min(a.y, b.y) < box.y + box.h - 1;
          expect(inside, `${edge.id} crosses ${box.id}`).toBe(false);
        }
      }
    }
  });

  test("50: no two seed shapes or link texts overlap", async () => {
    const { nodes, edges } = await layoutProcess(seedDefinition);
    const boxes = nodes.map((n) => ({ x: n.position.x, y: n.position.y, w: n.width!, h: n.height! }));
    for (const edge of edges) {
      const a = edge.data!.anchor;
      if (a) {
        const w = estimatePillWidth(edge.data!.pill!) - 6;
        boxes.push({ x: a.x - w / 2, y: a.y - 8, w, h: 16 });
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i]!;
        const q = boxes[j]!;
        const overlap =
          Math.min(p.x + p.w, q.x + q.w) > Math.max(p.x, q.x) &&
          Math.min(p.y + p.h, q.y + q.h) > Math.max(p.y, q.y);
        expect(overlap, `boxes ${i} and ${j}`).toBe(false);
      }
    }
  });

  test("48j: the real home loan proposal takes the grid on five rows", () => {
    const grid = gridLayout(aiHome)!;
    expect(grid).not.toBeNull();
    const rows: Record<string, number> = {
      n_start: 0, n_assemble: 0, n_financial: 0, n_legal: 0, n_conditions: 0, g_amount: 0,
      n_payment: 1, n_records: 1, n_branch: 1,
      n_approved: 2, g_high: 2,
      n_committee: 3,
      n_refused: 4,
    };
    for (const [id, row] of Object.entries(rows)) {
      expect(grid.cells.get(id)!.row, id).toBe(row);
    }
    expect(widestRow(grid)).toBeLessThanOrEqual(1360);
    // The link to itself is a lane over its task: out of the top edge
    // and back into the top edge, 32 px apart or more.
    const task = grid.cells.get("n_assemble")!;
    const pts = grid.points.get("e3")!;
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    expect(first.y).toBe(task.cy - task.h / 2);
    expect(last.y).toBe(task.cy - task.h / 2);
    expect(Math.abs(first.x - last.x)).toBeGreaterThanOrEqual(32);
    expect(pts[1]!.y).toBeLessThan(first.y);
    expect(pts[1]!.y).toBe(pts[2]!.y);
    expect(grid.anchors.get("e3")).not.toBeNull();
  });

  test("48k: the real construction loan proposal wraps on the row budget", () => {
    const grid = gridLayout(aiConstruction)!;
    expect(grid).not.toBeNull();
    expect(grid.cells.get("start")!.row).toBe(0);
    expect(grid.cells.get("approval_gateway")!.row).toBe(1);
    expect(widestRow(grid)).toBeLessThanOrEqual(1360);
  });

  test("48l: the real SME equipment loan proposal stays wrapped", () => {
    const grid = gridLayout(aiSme)!;
    expect(grid).not.toBeNull();
    expect(widestRow(grid)).toBeLessThanOrEqual(1360);
  });

  test("48m: a link from a gateway to itself falls back on ELK", async () => {
    const def: ProcessDefinition = {
      ...miniDefinition,
      edges: [
        ...miniDefinition.edges,
        { id: "self", from: "complete", to: "complete", label: null, decision: null, condition: null, is_default: false },
      ],
    };
    expect(gridLayout(def)).toBeNull();
    const { nodes } = await layoutProcess(def);
    expect(nodes.map((n) => n.id).sort()).toEqual(def.nodes.map((n) => n.id).sort());
  });

  // Each node carries its measured size and its two handles, so a new
  // node object never clears the handle bounds of React Flow and the
  // links stay on the canvas after a save (feedback item 0006).
  function expectFrame(nodes: Node[]) {
    for (const n of nodes) {
      const { width, height } = n as { width: number; height: number };
      expect(n.measured).toEqual({ width, height });
      expect(n.handles).toEqual([
        { type: "target", position: Position.Left, x: 0, y: height / 2, width: 1, height: 1, id: null },
        { type: "source", position: Position.Right, x: width, y: height / 2, width: 1, height: 1, id: null },
      ]);
    }
  }

  test("49a: each grid node carries its measured size and two handles", async () => {
    expect(gridLayout(seedDefinition)).not.toBeNull();
    const { nodes } = await layoutProcess(seedDefinition);
    expect(nodes).toHaveLength(seedDefinition.nodes.length);
    expectFrame(nodes);
  });

  test("49b: each ELK node carries its measured size and two handles", async () => {
    const def: ProcessDefinition = {
      ...miniDefinition,
      edges: [
        ...miniDefinition.edges,
        { id: "self", from: "complete", to: "complete", label: null, decision: null, condition: null, is_default: false },
      ],
    };
    expect(gridLayout(def)).toBeNull();
    const { nodes } = await layoutProcess(def);
    expect(nodes).toHaveLength(def.nodes.length);
    expectFrame(nodes);
  });

  test("49c: the seed geometry stays identical to the layout before the handles", async () => {
    const { nodes, edges, width, height } = await layoutProcess(seedDefinition);
    // The node boxes and the digest of the edges at 1242c8a.
    expect(nodes.map((n) => [n.id, n.position.x, n.position.y, n.width, n.height])).toEqual([
      ["start", 48, 70, 40, 40],
      ["entry", 124, 54, 152, 72],
      ["complete", 312, 64, 52, 52],
      ["analysis", 403.2, 54, 152, 72],
      ["threshold", 632.8, 64, 52, 52],
      ["offer", 720.8, 54, 152, 72],
      ["signing", 908.8, 54, 152, 72],
      ["release", 1096.8, 54, 152, 72],
      ["released", 1152.8, 210, 40, 40],
      ["decision", 582.8, 194, 152, 72],
      ["refused", 638.8, 350, 40, 40],
    ]);
    const geom = JSON.stringify({
      nodes: nodes.map((n) => [n.id, n.position, n.width, n.height]),
      edges,
      width,
      height,
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(geom));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(
      "0f4f389fd0ac476d8aef438d6dbe2e339c42ff297a0e7744e35851891de8029b",
    );
  });

  test("48n: a wide ELK fallback wraps under the row budget", async () => {
    const def = endlessChain(12);
    expect(gridLayout(def)).toBeNull();
    const { width } = await layoutProcess(def);
    expect(width).toBeLessThanOrEqual(1360);
    // 2608: the single band width of ELK without wrapping (scratch run).
    expect(width).toBeLessThan(2608);
  });

  test("48o: a 20-step ELK fallback wraps under the row budget", async () => {
    const { width } = await layoutProcess(endlessChain(20));
    expect(width).toBeLessThanOrEqual(1360);
  });

  test("48p: a narrow ELK fallback keeps the first pass", async () => {
    // A link to itself on a gateway: the grid refuses it.
    const looped: ProcessDefinition = {
      ...miniDefinition,
      edges: [
        ...miniDefinition.edges,
        { id: "self", from: "complete", to: "complete", label: null, decision: null, condition: null, is_default: false },
      ],
    };
    expect(gridLayout(looped)).toBeNull();
    const first = await new ELK().layout(toElkGraph(looped));
    const { width } = await layoutProcess(looped);
    expect(width).toBe(first.width);
  });

  test("48q: the fit covers the full layout box of a wide proposal", () => {
    const v = fitViewport({ width: 1150.8, height: 690 }, { width: 1366, height: 671 });
    expect(v.zoom).toBeCloseTo(0.8855, 4);
    expect(v.x).toBeCloseTo(173.479, 3);
    expect(v.y).toBe(30);
  });

  test("48r: the fit of a small layout stops at 100 % and centers it", () => {
    const v = fitViewport({ width: 600, height: 200 }, { width: 1366, height: 671 });
    expect(v.zoom).toBe(1);
    expect(v.x).toBe(383);
    expect(v.y).toBe(235.5);
  });

  test("51: a node the start never reaches goes on the parking row", async () => {
    const lonely: ProcessDefinition = {
      ...miniDefinition,
      nodes: [...miniDefinition.nodes, nodeCopy("entry", "lonely")],
    };
    const grid = gridLayout(lonely);
    expect(grid).not.toBeNull();
    const rows = [...grid!.cells].filter(([id]) => id !== "lonely").map(([, c]) => c.row);
    expect(grid!.cells.get("lonely")!.row).toBe(Math.max(...rows) + 1);
    const { nodes } = await layoutProcess(lonely);
    expect(nodes).toHaveLength(7);
  });

  // Rows G1 to G7 (feedback item 0024): a step that the start does not
  // reach goes on a parking row, and the seed cells do not move.
  const seedGrid = () => gridLayout(seedDefinition)!;
  const seedRow = () => Math.max(...[...seedGrid().cells.values()].map((c) => c.row));
  function expectSeedCells(grid: NonNullable<ReturnType<typeof gridLayout>>, skip = "") {
    for (const [id, c] of seedGrid().cells) {
      if (id === skip) {
        continue;
      }
      const g = grid.cells.get(id)!;
      expect([id, g.cx, g.cy, g.row]).toEqual([id, c.cx, c.cy, c.row]);
    }
  }

  test("G1: an added task keeps every seed cell", () => {
    const grid = gridLayout(addNode(seedDefinition, "task").def);
    expect(grid).not.toBeNull();
    expectSeedCells(grid!);
  });

  test("G2: the added task sits at the left of the first parking row", () => {
    const { def, id } = addNode(seedDefinition, "task");
    const c = gridLayout(def)!.cells.get(id)!;
    expect(c.row).toBe(seedRow() + 1);
    expect(c.cx).toBe(76);
    expect(c.cy).toBe((seedRow() + 1) * 140);
  });

  test("G3: three added steps sit left to right on one parking row", () => {
    const a = addNode(seedDefinition, "task");
    const b = addNode(a.def, "gateway");
    const e = addNode(b.def, "end");
    const grid = gridLayout(e.def);
    expect(grid).not.toBeNull();
    const cells = [a.id, b.id, e.id].map((id) => grid!.cells.get(id)!);
    expect(cells.map((c) => c.row)).toEqual(Array(3).fill(seedRow() + 1));
    for (let i = 1; i < 3; i++) {
      const gap = cells[i]!.cx - cells[i]!.w / 2 - (cells[i - 1]!.cx + cells[i - 1]!.w / 2);
      expect(gap).toBe(36);
    }
  });

  test("G4: a link from a parked task gets a route", () => {
    const { def, id } = addNode(seedDefinition, "task");
    const linked = connect(def, id, "analysis")!;
    const grid = gridLayout(linked);
    expect(grid).not.toBeNull();
    expectSeedCells(grid!);
    const edge = linked.edges.find((e) => e.from === id)!;
    expect(grid!.points.get(edge.id)!.length).toBeGreaterThanOrEqual(2);
  });

  test("G5: a link into the new task makes it a reached node", () => {
    const { def, id } = addNode(seedDefinition, "task");
    const grid = gridLayout(connect(def, "decision", id)!);
    expect(grid).not.toBeNull();
    // Step 2 places the new task first in the topological order, so
    // "refused" takes the next free row under it.
    expectSeedCells(grid!, "refused");
    const decision = grid!.cells.get("decision")!;
    const c = grid!.cells.get(id)!;
    // The anchor rule of step 2: under the node that leads to it.
    expect([c.cx, c.row]).toEqual([decision.cx, decision.row + 1]);
    expect(grid!.cells.get("refused")!.row).toBe(decision.row + 2);
  });

  test("G6: parked rows wrap under the row budget", () => {
    let def = chainDefinition(12);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const added = addNode(def, "task");
      def = added.def;
      ids.push(added.id);
    }
    const grid = gridLayout(def);
    expect(grid).not.toBeNull();
    const cells = ids.map((id) => grid!.cells.get(id)!);
    expect(new Set(cells.map((c) => c.row)).size).toBeGreaterThan(1);
    for (const c of cells) {
      expect(c.cx + c.w / 2).toBeLessThanOrEqual(1360);
    }
  });

  test("G7: the layout of an added task keeps the seed positions", async () => {
    const def = addNode(seedDefinition, "task").def;
    const { nodes } = await layoutProcess(def);
    expect(nodes).toHaveLength(seedDefinition.nodes.length + 1);
    const seedIds = new Set(seedDefinition.nodes.map((n) => n.id));
    expect(nodes.filter((n) => seedIds.has(n.id)).map((n) => [n.id, n.position.x, n.position.y]))
      .toEqual([
        ["start", 48, 70],
        ["entry", 124, 54],
        ["complete", 312, 64],
        ["analysis", 403.2, 54],
        ["threshold", 632.8, 64],
        ["offer", 720.8, 54],
        ["signing", 908.8, 54],
        ["release", 1096.8, 54],
        ["released", 1152.8, 210],
        ["decision", 582.8, 194],
        ["refused", 638.8, 350],
      ]);
    expectFrame(nodes);
  });
});

describe("process overview and keyboard", () => {
  test("52: the seed process has no structure problem", () => {
    expect(structureProblems(seedDefinition)).toEqual([]);
  });

  test("53: structureProblems names an unreached step, a dead end and a missing default", () => {
    const broken: ProcessDefinition = {
      ...miniDefinition,
      nodes: [...miniDefinition.nodes, nodeCopy("entry", "lonely")],
      edges: miniDefinition.edges
        .filter((e) => e.id !== "e3")
        .map((e) => (e.id === "e6" ? { ...e, is_default: false } : e)),
    };
    const texts = structureProblems(broken).map((p) => p.text);
    expect(texts).toContain("Application entry is not reached from the start.");
    expect(texts).toContain("Review has no outgoing link.");
    expect(texts).toContain("File complete? has no default link.");
    expect(texts).toContain("File complete? is not reached from the start.");
  });

  test("54: neighborIn follows the row, then the branch below", async () => {
    const { nodes } = await layoutProcess(seedDefinition);
    expect(neighborIn(nodes, "analysis", "ArrowRight")).toBe("threshold");
    expect(neighborIn(nodes, "threshold", "ArrowDown")).toBe("decision");
    expect(neighborIn(nodes, "decision", "ArrowUp")).toBe("threshold");
    expect(neighborIn(nodes, "start", "ArrowLeft")).toBeNull();
  });

  const boxOf = (n: { position: { x: number; y: number }; width?: number; height?: number }) => ({
    x: n.position.x, y: n.position.y, width: n.width!, height: n.height!,
  });
  const ids = (nodes: string[], edges: string[]) => ({ nodes: new Set(nodes), edges: new Set(edges) });
  const near = (b: { x: number; y: number; width: number; height: number }) => ({
    x: expect.closeTo(b.x, 9), y: expect.closeTo(b.y, 9),
    width: expect.closeTo(b.width, 9), height: expect.closeTo(b.height, 9),
  });

  test("52a: focusBox gives the box of one step", async () => {
    const layout = await layoutProcess(seedDefinition);
    const analysis = layout.nodes.find((n) => n.id === "analysis")!;
    expect(focusBox(layout, ids(["analysis"], []))).toEqual(near(boxOf(analysis)));
  });

  test("52b: focusBox gives the union box of two steps", async () => {
    const layout = await layoutProcess(seedDefinition);
    const a = boxOf(layout.nodes.find((n) => n.id === "analysis")!);
    const b = boxOf(layout.nodes.find((n) => n.id === "offer")!);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    expect(focusBox(layout, ids(["analysis", "offer"], []))).toEqual(near({
      x, y,
      width: Math.max(a.x + a.width, b.x + b.width) - x,
      height: Math.max(a.y + a.height, b.y + b.height) - y,
    }));
  });

  test("52c: focusBox takes the two ends of a link", async () => {
    const layout = await layoutProcess(seedDefinition);
    expect(focusBox(layout, ids([], ["e03"]))).toEqual(focusBox(layout, ids(["complete", "analysis"], [])));
  });

  test("52d: focusBox skips unknown ids and gives null", async () => {
    const layout = await layoutProcess(seedDefinition);
    expect(focusBox(layout, ids(["missing"], ["missing"]))).toBeNull();
  });

  test("52e: focusBox gives null with no id", async () => {
    const layout = await layoutProcess(seedDefinition);
    expect(focusBox(layout, ids([], []))).toBeNull();
  });

  test("52f: focusViewport shows one small step at 100 % in the canvas center", async () => {
    const layout = await layoutProcess(seedDefinition);
    const focus = focusBox(layout, ids(["analysis"], []))!;
    const vp = focusViewport(layout, focus, { width: 1366, height: 671 });
    expect(vp.zoom).toBe(1);
    expect(Math.abs(vp.x + vp.zoom * (focus.x + focus.width / 2) - 683)).toBeLessThan(0.5);
    expect(Math.abs(vp.y + vp.zoom * (focus.y + focus.height / 2) - 335.5)).toBeLessThan(0.5);
  });

  test("52g: focusViewport on the full layout box keeps the full-diagram zoom", async () => {
    const layout = await layoutProcess(seedDefinition);
    const canvas = { width: 1366, height: 671 };
    const full = { x: 0, y: 0, width: layout.width, height: layout.height };
    expect(focusViewport(layout, full, canvas).zoom).toBeCloseTo(fitViewport(layout, canvas).zoom, 5);
  });
});

describe("api client", () => {
  test("11: listProcesses maps the API error body", async () => {
    stubFetch(500, { error: { code: "internal", message: "boom", details: [] } });
    const error: unknown = await listProcesses().then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(500);
    expect(apiError.code).toBe("internal");
    expect(apiError.message).toBe("boom");
  });

  test("12: listProcesses falls back on a non-JSON error body", async () => {
    stubFetch(500, "not json");
    const error: unknown = await listProcesses().then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(500);
    expect(apiError.code).toBe("http");
    expect(apiError.message).toBe("HTTP 500");
  });

  test("13: listVersions unwraps the versions envelope", async () => {
    stubFetch(200, {
      versions: [
        {
          id: "v2", process_id: "p1", parent_id: null, number: 2,
          label: "Draft 2", status: "draft",
          created_at: "2026-10-27T10:00:00Z", frozen_at: null,
        },
        {
          id: "v1", process_id: "p1", parent_id: null, number: 1,
          label: "Initial", status: "published",
          created_at: "2026-10-27T09:00:00Z",
          frozen_at: "2026-10-27T09:30:00Z",
        },
      ],
    });
    const rows = await listVersions("p1");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe("v2");
  });

  test("14: getVersion unwraps the version envelope", async () => {
    stubFetch(200, {
      version: {
        id: "v1", process_id: "p1", parent_id: null, number: 1,
        label: "Initial", status: "published",
        created_at: "2026-10-27T09:00:00Z",
        frozen_at: "2026-10-27T09:30:00Z",
        definition: miniDefinition,
      },
    });
    const version = await getVersion("v1");
    expect(version.definition.name).toBe("Mini loan");
  });
});

describe("top bar", () => {
  test("15: the top bar renders brand, process and version", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(1, "published"),
      }),
    );
    expect(html).toContain("Mini Bank");
    expect(html).toContain("Mini loan");
    expect(html).toContain("v1 · Published");
    expect(html).toContain("Design");
    expect(html).toContain("Test");
    expect(html).toContain("Monitor");
  });

  test("fix-monitor row M6: Monitor links to the app supervision of the process", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(1, "published"),
        processId: "p1",
      }),
    );
    expect(html).toMatch(
      /<a href="\/app\?view=supervision&amp;process=p1"[^>]*>Monitor<\/a>/,
    );
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Monitor</);
  });

  test("fix-monitor row M7: with no process, Monitor is a disabled button", () => {
    const html = renderToString(
      createElement(TopBar, { def: miniDefinition, version: versionRow(1, "published") }),
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*title="Open a process first"[^>]*>Monitor<\/button>/,
    );
  });

  test("16: a draft version reads v2 · Draft", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(2, "draft"),
      }),
    );
    expect(html).toContain("v2 · Draft");
  });

  test("17: a frozen version reads v4 · Frozen", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(4, "frozen"),
      }),
    );
    expect(html).toContain("v4 · Frozen");
  });

  test("18: an unknown status shows its raw value", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(3, "archived"),
      }),
    );
    expect(html).toContain("v3 · archived");
  });

  test("18b: the version selector lists every version, enabled", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(2, "draft"),
        versions: [versionRow(2, "draft"), versionRow(1, "published")],
        onSelectVersion: () => {},
      }),
    );
    expect(html).toContain(`aria-label="Version"`);
    expect(html).toContain("v2 · Draft");
    expect(html).toContain("v1 · Published");
    // The option of the open version carries selected="".
    expect(html).toMatch(/<option[^>]*value="v2"[^>]*selected=""/);
    // The select tag carries no disabled attribute.
    expect(html.match(/<select[^>]*>/)![0]).not.toContain("disabled");
  });

  test("18c: with no handler the selector is disabled, one option", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(1, "published"),
      }),
    );
    const select = html.match(/<select[^>]*>/)![0];
    expect(select).toContain(`aria-label="Version"`);
    expect(select).toContain(`disabled=""`);
    expect(html).toContain("v1 · Published");
  });

  test("18d: a proposal top bar names the proposal with a badge and no version", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        proposalName: "Home Loan Release",
      }),
    );
    // The breadcrumb names the brand and the proposal, not the
    // definition that was open, with the violet Proposal badge.
    expect(html).toContain("Mini Bank");
    expect(html).toContain("Home Loan Release");
    expect(html).toContain("#7c3aed");
    expect(html).toContain("Proposal");
    expect(html).not.toContain("&gt;Mini loan&lt;");
    // No version select and no version actions during the review.
    expect(html).not.toContain('aria-label="Version"');
    expect(html).not.toContain("New draft from this version");
    expect(html).not.toContain("Freeze version");
  });

  // The Policy button tag, found by its text.
  const policyButton = (policyOpen?: boolean): string => {
    const html = renderToString(
      createElement(TopBar, { def: miniDefinition, version: versionRow(1, "published"), policyOpen }),
    );
    const m = html.match(/<button[^>]*>(?:(?!<\/button>).)*Policy<\/button>/);
    expect(m).not.toBeNull();
    return m![0];
  };

  test("fb-027 P1: an open policy gives a pressed Policy button", () => {
    const tag = policyButton(true);
    expect(tag).toContain('aria-pressed="true"');
    expect(tag).toContain('title="Hide the policy"');
    expect(tag).toContain("background:var(--secondary)");
    expect(tag).toContain("box-shadow:inset 0 0 0 1px var(--border)");
    expect(tag).toContain("lucide-panel-right-close");
    expect(tag).not.toContain("lucide-file-text");
  });

  test("fb-027 P2: a closed policy gives the outline Policy button", () => {
    const tag = policyButton(false);
    expect(tag).toContain('aria-pressed="false"');
    expect(tag).toContain('title="Show the policy"');
    expect(tag).not.toContain("var(--secondary)");
    expect(tag).toContain("lucide-file-text");
  });

  test("fb-027 P3: with no policyOpen prop the button has the closed look", () => {
    expect(policyButton(undefined)).toBe(policyButton(false));
  });
});

describe("node shapes", () => {
  test("19: the task card shows role, deadline and document count", () => {
    const entry = miniDefinition.nodes.find((node) => node.id === "entry")!;
    const html = renderToString(
      createElement(TaskCard, {
        node: entry,
        color: roleColor(miniDefinition, "advisor"),
        roleName: "Advisor",
        selected: false,
      }),
    );
    expect(html).toContain("Advisor");
    expect(html).toContain("24 h");
    expect(html).toContain("1");
  });

  test("20: unknown role shows Automatic, null deadline shows nothing", () => {
    const review = miniDefinition.nodes.find((node) => node.id === "review")!;
    const html = renderToString(
      createElement(TaskCard, {
        node: review,
        color: null,
        roleName: null,
        selected: false,
      }),
    );
    expect(html).toContain("Automatic");
    expect(html).not.toMatch(/\d+ h/);
  });

  test("21: the selected task card carries the selection blue", () => {
    const entry = miniDefinition.nodes.find((node) => node.id === "entry")!;
    const html = renderToString(
      createElement(TaskCard, {
        node: entry,
        color: roleColor(miniDefinition, "advisor"),
        roleName: "Advisor",
        selected: true,
      }),
    );
    expect(html).toContain("#2563eb");
  });

  test("22: the approved end circle is green", () => {
    const released = miniDefinition.nodes.find((node) => node.id === "released")!;
    const html = renderToString(
      createElement(EventShape, { node: released, selected: false }),
    );
    expect(html).toContain("#16a34a");
  });

  test("23: the refused end circle is red", () => {
    const refused = miniDefinition.nodes.find((node) => node.id === "refused")!;
    const html = renderToString(
      createElement(EventShape, { node: refused, selected: false }),
    );
    expect(html).toContain("#dc2626");
  });

  test("24: the selected end circle carries the selection blue", () => {
    const released = miniDefinition.nodes.find((node) => node.id === "released")!;
    const html = renderToString(
      createElement(EventShape, { node: released, selected: true }),
    );
    expect(html).toContain("#2563eb");
  });
});

describe("shell states", () => {
  function renderShell(client: QueryClient): string {
    return renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ReactFlowProvider, null, createElement(StudioShell)),
      ),
    );
  }

  test("25: an empty process list shows the empty process state", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["processes"], []);
    const html = renderShell(client);
    expect(html).toContain("No process yet.");
    expect(html).toContain("Import a credit policy");
    expect(html).toContain("Start from scratch");
  });

  test("26: an empty version list shows the empty version state", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["processes"], [
      { id: "p1", name: "Mini loan", created_at: "2026-10-27T09:00:00Z" },
    ]);
    client.setQueryData(["versions", "p1"], []);
    const html = renderShell(client);
    expect(html).toContain("No version yet.");
    expect(html).toContain("Create a draft to start.");
  });
});

describe("undo", () => {
  // The Undo button is an icon button: its name is the aria-label.
  const undoButton = /<button[^>]*aria-label="Undo"[^>]*>/;

  test("55: the top bar of a draft has no Undo button", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(2, "draft"),
      }),
    );
    expect(html).not.toMatch(undoButton);
  });

  test("56: pushUndo keeps at most 20 entries", () => {
    let stack: ProcessDefinition[] = [];
    for (let i = 0; i < 22; i++) {
      stack = pushUndo(stack, { ...miniDefinition, name: `d${i}` });
    }
    expect(stack).toHaveLength(20);
    expect(stack[0]!.name).toBe("d2");
    expect(stack[19]!.name).toBe("d21");
    expect(pushUndo([], miniDefinition)).toEqual([miniDefinition]);
  });

  const named = (name: string): ProcessDefinition => ({ ...miniDefinition, name });
  const [a, b, c, d] = ["a", "b", "c", "d"].map(named) as [
    ProcessDefinition,
    ProcessDefinition,
    ProcessDefinition,
    ProcessDefinition,
  ];

  test("H1: a save pushes the old definition and clears the redo stack", () => {
    expect(afterSave({ undo: [a], redo: [b] }, c)).toEqual({ undo: [a, c], redo: [] });
  });

  test("H2: an undo moves the current definition to the redo stack", () => {
    expect(afterUndo({ undo: [a, c], redo: [] }, d)).toEqual({ undo: [a], redo: [d] });
  });

  test("H3: a redo moves the current definition to the undo stack", () => {
    expect(afterRedo({ undo: [a], redo: [d] }, c)).toEqual({ undo: [a, c], redo: [] });
  });

  test("H4: a redo keeps at most 20 undo entries", () => {
    const undo = Array.from({ length: 20 }, (_, i) => named(`u${i}`));
    const h = afterRedo({ undo, redo: [d] }, c);
    expect(h.undo).toHaveLength(20);
    expect(h.undo[0]!.name).toBe("u1");
    expect(h.undo[19]).toEqual(c);
  });

  const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) =>
    historyKey({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

  test("K1: Ctrl+Z and Cmd+Z undo", () => {
    expect(key("z", { ctrlKey: true })).toBe("undo");
    expect(key("Z", { metaKey: true })).toBe("undo");
  });

  test("K2: Ctrl+Shift+Z and Ctrl+Y redo", () => {
    expect(key("Z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(key("y", { ctrlKey: true })).toBe("redo");
  });

  test("K3: other keys do nothing", () => {
    expect(key("z")).toBeNull();
    expect(key("z", { ctrlKey: true, altKey: true })).toBeNull();
    expect(key("y", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(key("a", { ctrlKey: true })).toBeNull();
  });
});

// The shape of feedback item 0026: the seed plus a proposed task
// between the client signature and the release of funds.
function shapeDefinition(): ProcessDefinition {
  const signing = seedDefinition.nodes.find((n) => n.id === "signing")!;
  const validation: ProcessNode = {
    ...signing, id: "validation", name: "Signature validation", role: "legal", deadline_hours: 24, signature: false,
  };
  const nodes = [...seedDefinition.nodes];
  nodes.splice(nodes.findIndex((n) => n.id === "release"), 0, validation);
  const edges = seedDefinition.edges.map((e) => (e.id === "e13" ? { ...e, to: "validation" } : e));
  edges.push({ id: "e15", from: "validation", to: "release", label: null, decision: null, condition: null, is_default: false });
  return { ...seedDefinition, nodes, edges };
}

describe("layout candidates", () => {
  type Grid = NonNullable<ReturnType<typeof gridLayout>>;
  function expectCell(grid: Grid, id: string, [cx, cy, row]: [number, number, number]) {
    const c = grid.cells.get(id)!;
    expect(c.cx).toBe(cx);
    expect(c.cy).toBe(cy);
    expect(c.row).toBe(row);
  }
  const line = (id: string, pts: [number, number][]) =>
    ({ id, source: "a", target: "b", data: { points: pts.map(([x, y]) => ({ x, y })), pill: null } }) as unknown as FlowEdge;
  const A = line("A", [[0, 0], [100, 0]]);
  const B = line("B", [[50, -50], [50, 50]]);
  const C = line("C", [[100, 0], [100, 50]]);
  const D = line("D", [[0, 0], [60, 0]]);
  const L = line("L", [[0, 0], [0, 50], [80, 50]]);
  const withEdges = (edges: FlowEdge[]) => ({ nodes: [], edges, width: 10, height: 10 }) as unknown as Layout;

  test("L1: a short tail goes down under the last node of the row", () => {
    const grid = gridLayout(shapeDefinition());
    expect(grid).not.toBeNull();
    expectCell(grid!, "validation", [1124.8, 0, 0]);
    expectCell(grid!, "release", [1124.8, 140, 1]);
    expectCell(grid!, "released", [1124.8, 280, 2]);
    expectCell(grid!, "decision", [610.8, 140, 1]);
    expectCell(grid!, "refused", [610.8, 280, 2]);
  });

  test("L2: the tail links go straight down", () => {
    const grid = gridLayout(shapeDefinition())!;
    expect(grid.points.get("e15")).toEqual([{ x: 1124.8, y: 36 }, { x: 1124.8, y: 104 }]);
    expect(grid.points.get("e14")).toEqual([{ x: 1124.8, y: 176 }, { x: 1124.8, y: 260 }]);
  });

  test("L3: the default layout of the item shape has no link crossing", async () => {
    expect(crossings((await layoutProcess(shapeDefinition())).edges)).toBe(0);
  });

  test("L4: a tail of 2 makes a column", () => {
    const grid = gridLayout(chainDefinition(8))!;
    expectCell(grid, "t8", [1280, 140, 1]);
    expectCell(grid, "released", [1280, 280, 2]);
  });

  test("L5: a tail of 3 keeps the left-to-right row", () => {
    const grid = gridLayout(chainDefinition(9))!;
    expectCell(grid, "t8", [76, 140, 1]);
    expectCell(grid, "t9", [264, 140, 1]);
    expectCell(grid, "released", [264, 280, 2]);
  });

  test("L6: a tail of 1 sits under the last task", () => {
    const grid = gridLayout(chainDefinition(7))!;
    expectCell(grid, "t7", [1280, 0, 0]);
    expectCell(grid, "released", [1280, 140, 1]);
  });

  test("L7: with no row budget the main path stays on one row", () => {
    const grid = gridLayout(chainDefinition(12), Infinity)!;
    expectCell(grid, "t12", [2220, 0, 0]);
    expectCell(grid, "released", [2220, 140, 1]);
  });

  test("L8: the seed has three candidates, the default first", async () => {
    const list = await layoutCandidates(seedDefinition);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual(await layoutProcess(seedDefinition));
  });

  test("L9: a gateway link to itself keeps only the ELK candidate", async () => {
    const def: ProcessDefinition = {
      ...miniDefinition,
      edges: [
        ...miniDefinition.edges,
        { id: "self", from: "complete", to: "complete", label: null, decision: null, condition: null, is_default: false },
      ],
    };
    const list = await layoutCandidates(def);
    expect(list).toHaveLength(1);
    expect(list[0]!.nodes.some((n) => n.data.labelPos !== undefined)).toBe(false);
  });

  test("L10: crossings count only strict crossings of two links", () => {
    expect(crossings([A, B])).toBe(1);
    expect(crossings([A, C])).toBe(0);
    expect(crossings([A, D])).toBe(0);
    expect(crossings([L, B])).toBe(0);
    expect(crossings([L])).toBe(0);
  });

  test("L11: bends count the inner points", () => {
    expect(bends([A, L])).toBe(1);
  });

  test("L12: the best candidate has the fewest crossings, then bends, then the first index", () => {
    expect(bestCandidate([withEdges([A, B]), withEdges([A, L]), withEdges([A, C]), withEdges([C])])).toBe(2);
  });

  test("L13: the default grid is the best candidate of the seed and of the item shape", async () => {
    expect(bestCandidate(await layoutCandidates(seedDefinition))).toBe(0);
    expect(bestCandidate(await layoutCandidates(shapeDefinition()))).toBe(0);
  });

  test("L14: the next candidate skips equal positions and wraps", async () => {
    const list = await layoutCandidates(seedDefinition);
    expect(nextCandidate(list, list[0]!)).toBe(2);
    expect(nextCandidate(list, list[2]!)).toBe(0);
  });

  test("L15: the item shape cycles through its three candidates", async () => {
    const list = await layoutCandidates(shapeDefinition());
    expect(nextCandidate(list, list[0]!)).toBe(1);
    expect(nextCandidate(list, list[1]!)).toBe(2);
    expect(nextCandidate(list, list[2]!)).toBe(0);
  });

  test("L16: one candidate gives no other path", async () => {
    const list = await layoutCandidates(seedDefinition);
    expect(nextCandidate([list[0]!], list[0]!)).toBe(-1);
  });
});

// The seed with a second gateway in series before "threshold": the AI
// proposal that broke Rearrange and Try another path.
function seriesDefinition(): ProcessDefinition {
  const threshold = seedDefinition.nodes.find((n) => n.id === "threshold")!;
  const valuation: ProcessNode = {
    id: "valuation", type: "task", name: "Property valuation", role: "analyst", deadline_hours: 72,
    documents: ["Valuation report"], signature: false, checks: [], decisions: [], end_result: null,
    scope_overrides: [], source_ids: [], citations: [],
  };
  const edge = (id: string, from: string, to: string, condition: string | null, isDefault: boolean): ProcessEdge =>
    ({ id, from, to, label: null, decision: null, condition, is_default: isDefault });
  return {
    ...seedDefinition,
    nodes: [...seedDefinition.nodes, { ...threshold, id: "high_amount", name: "Amount above EUR 300,000?" }, valuation],
    edges: [
      ...seedDefinition.edges.map((e) => (e.id === "e05" ? { ...e, to: "high_amount" } : e)),
      edge("e15", "high_amount", "valuation", "amount > 300000.0", false),
      edge("e16", "high_amount", "threshold", null, true),
      edge("e17", "valuation", "threshold", null, false),
    ],
  };
}

describe("12.14 layout after a new gateway", () => {
  const series = seriesDefinition();
  const seedStart = ["label start x node entry"];
  const hand = (id: string, model: "entry" | "complete", name: string, x: number, y: number, labelPos?: string) => {
    const size = model === "entry" ? [152, 72] : [52, 52];
    return { id, position: { x, y }, width: size[0], height: size[1], data: { node: { ...nodeCopy(model, id), name }, labelPos } };
  };
  const link = (pts: [number, number][], pill: string | null = null, anchor: [number, number] | null = null) =>
    ({ id: "x", source: "a", target: "b", data: { points: pts.map(([x, y]) => ({ x, y })), pill, anchor: anchor && { x: anchor[0], y: anchor[1] } } });
  const hl = (nodes: unknown[], edges: unknown[]) => ({ nodes, edges, width: 400, height: 300 }) as unknown as Layout;

  test("N1: the series candidates have no problem, except the seed start label", async () => {
    const list = await layoutCandidates(series);
    expect(list.map(layoutProblems)).toEqual([seedStart, seedStart, []]);
  });

  test("N2: the ELK candidate is the best and the next path", async () => {
    const list = await layoutCandidates(series);
    expect(list.map((l) => crossings(l.edges))).toEqual([3, 3, 0]);
    expect(bestCandidate(list)).toBe(2);
    expect(nextCandidate(list, list[0]!)).toBe(2);
  });

  test("N3: the grid keeps the two gateway labels apart", () => {
    const grid = gridLayout(series)!;
    expect(grid.cells.get("high_amount")!.cx).toBeCloseTo(610.8, 6);
    expect(grid.cells.get("threshold")!.cx).toBeCloseTo(738.8, 6);
    expect(grid.cells.get("threshold")!.cx - grid.cells.get("high_amount")!.cx).toBeCloseTo(128, 6);
    expect(grid.labelPos.get("high_amount")).toBe("above");
    expect(grid.labelPos.get("threshold")).toBe("above");
  });

  test("N4: the seed candidates keep their problems and the default grid", async () => {
    const list = await layoutCandidates(seedDefinition);
    expect(list.map(layoutProblems)).toEqual([seedStart, seedStart, []]);
    expect(bestCandidate(list)).toBe(0);
  });

  test("N5: the AI proposals have no problem in any candidate", async () => {
    for (const def of [aiHome, aiConstruction, aiSme]) {
      for (const l of await layoutCandidates(def)) {
        expect(layoutProblems(l)).toEqual([]);
      }
    }
  });

  test("N6: the wrapped ELK fallback has no problem", async () => {
    const twelve = await layoutProcess(endlessChain(12));
    const twenty = await layoutProcess(endlessChain(20));
    expect([twelve.width, twenty.width]).toEqual([952, 1164]);
    expect(layoutProblems(twelve)).toEqual([]);
    expect(layoutProblems(twenty)).toEqual([]);
  });

  test("N7: the ELK graph holds the node labels and the widest pill", () => {
    const g = toElkGraph(series);
    expect(g.layoutOptions!["elk.layered.spacing.nodeNodeBetweenLayers"]).toBe("94.6");
    expect(g.layoutOptions!["elk.spacing.labelNode"]).toBe("4");
    const gate = g.children!.find((c) => c.id === "high_amount")!;
    expect(gate.labels).toEqual([{ text: "Amount above EUR 300,000?", width: 120, height: 30 }]);
    expect(gate.layoutOptions).toEqual({ "elk.nodeLabels.placement": "OUTSIDE V_BOTTOM H_CENTER" });
    expect("labels" in g.children!.find((c) => c.id === "valuation")!).toBe(false);
  });

  test("N8: labelSize caps the width at 120 and counts the lines", () => {
    const short = labelSize("File complete?");
    expect(short.w).toBeCloseTo(106.4, 6);
    expect(short.h).toBe(15);
    expect(labelSize("Amount above EUR 300,000?")).toEqual({ w: 120, h: 30 });
    expect(labelSize("")).toEqual({ w: 14, h: 15 });
  });

  test("N9: the ELK candidate shows the pill texts of the grid", async () => {
    const elk = (await layoutCandidates(series))[2]!;
    const pills = Object.fromEntries(elk.edges.map((e) => [e.id, e.data!.pill]));
    expect([pills.e03, pills.e07, pills.e08, pills.e15, pills.e16]).toEqual(["Yes", "Yes", "No", "Yes", "No"]);
  });

  test("N10: diagonal and outside links, outside pills", () => {
    expect(layoutProblems(hl([], [link([[0, 0], [50, 50]])]))).toEqual(["diagonal x"]);
    expect(layoutProblems(hl([], [link([[0, 0], [0, 302]])]))).toEqual(["outside x"]);
    expect(layoutProblems(hl([], [link([[0, 0], [0, 100]], "Yes", [0, 50])]))).toEqual(["outside pill x"]);
    expect(layoutProblems(hl([], [link([[0, 0], [400, 0]], "No", null)]))).toEqual([]);
  });

  test("N11: two overlapping nodes, one free gateway", () => {
    expect(layoutProblems(hl([hand("a", "entry", "A", 10, 10), hand("b", "entry", "B", 100, 50)], []))).toEqual(["node a x node b"]);
    expect(layoutProblems(hl([hand("g", "complete", "Go?", 100, 100)], []))).toEqual([]);
  });

  test("N12: the node label sits above, left or below", () => {
    expect(layoutProblems(hl([hand("g", "complete", "Go?", 100, 100, "above"), hand("t", "entry", "T", 80, 20)], [])))
      .toEqual(["label g x node t"]);
    expect(layoutProblems(hl([hand("g", "complete", "Go?", 200, 100, "left"), hand("t", "entry", "T", 40, 140)], [])))
      .toEqual(["label g x node t"]);
    expect(layoutProblems(hl([hand("g", "complete", "Go?", 100, 100, "below")], [link([[126, 150], [126, 250]], "Yes", [126, 160])])))
      .toEqual(["label g x pill x"]);
  });
});
