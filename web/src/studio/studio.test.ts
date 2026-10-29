// The studio test rows, in order.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { getVersion, listProcesses, listVersions, ApiError } from "./api";
import {
  diagramEdgeText,
  edgePillText,
  estimatePillWidth,
  gridLayout,
  labelBox,
  layoutProcess,
  PILL_HEIGHT,
  PILL_MARGIN,
  pillPlacement,
  roleColor,
  toElkGraph,
} from "./layout";
import { EdgePill, edgeAnchor, EventShape, neighborIn, TaskCard } from "./diagram";
import { structureProblems } from "./ProcessPanel";
import { StudioShell, TopBar } from "./StudioShell";
import seedJson from "../../../internal/store/seed/example-process.json";
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

  test("51: a definition with a node the start never reaches falls back on ELK", async () => {
    const lonely: ProcessDefinition = {
      ...miniDefinition,
      nodes: [...miniDefinition.nodes, nodeCopy("entry", "lonely")],
    };
    expect(gridLayout(lonely)).toBeNull();
    const { nodes } = await layoutProcess(lonely);
    expect(nodes).toHaveLength(7);
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
    expect(html).toContain("Import a credit policy to create one.");
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
