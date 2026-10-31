// The test rows of the live flow diagram: the halo rule, the dot
// count rule, the edge kinds on the seed process, and the render of
// the diagram on the seed layout.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, test } from "vitest";
import { dotCount, edgeKind, haloOf, LiveDiagram, nameBox } from "./LiveFlow";
import type { Flow, SupCase, Supervision } from "./sup-api";
import { layoutProcess, walk } from "../studio/layout";
import type { Layout } from "../studio/layout";
import type { ProcessDefinition, ProcessNode } from "../studio/types";

const seed = JSON.parse(
  readFileSync("../internal/store/seed/example-process.json", "utf8"),
) as ProcessDefinition;

const entry: ProcessNode = seed.nodes.find((n) => n.id === "entry")!;

function supCase(nodeId: string, age: number, late: boolean): SupCase {
  return {
    case_id: `c-${nodeId}-${age}`,
    reference: `CASE-${age}`,
    node_id: nodeId,
    assignee: "",
    age_hours: age,
    late,
    returned: false,
    data: {},
  };
}

describe("halo rule", () => {
  test("H1: a late case gives the late halo", () => {
    expect(entry.deadline_hours).toBe(24);
    expect(haloOf(entry, [supCase("entry", 25, true)])).toEqual({ state: "late", late: 1, near: 0 });
  });
  test("H2: an age at 60 percent of the deadline gives the near halo", () => {
    expect(haloOf(entry, [supCase("entry", 15, false)])).toEqual({ state: "near", late: 0, near: 1 });
  });
  test("H3: an age under 60 percent gives no halo", () => {
    expect(haloOf(entry, [supCase("entry", 14, false)])).toEqual({ state: "ok", late: 0, near: 0 });
  });
  test("H4: a step with no deadline is never near", () => {
    const free = { ...entry, deadline_hours: null };
    expect(haloOf(free, [supCase("entry", 100, false)])).toEqual({ state: "ok", late: 0, near: 0 });
  });
  test("H5: late wins over near, both counts stay", () => {
    expect(
      haloOf(entry, [supCase("entry", 25, true), supCase("entry", 15, false)]),
    ).toEqual({ state: "late", late: 1, near: 1 });
  });
  test("H6: no case, and a case on another step only, give no halo", () => {
    expect(haloOf(entry, [])).toEqual({ state: "ok", late: 0, near: 0 });
    expect(haloOf(entry, [supCase("analysis", 100, true)])).toEqual({ state: "ok", late: 0, near: 0 });
  });
});

describe("dot count rule", () => {
  test("D1: 0 to 5 dots from the passes against the largest passes", () => {
    expect(dotCount(0, 10)).toBe(0);
    expect(dotCount(10, 10)).toBe(5);
    expect(dotCount(1, 10)).toBe(1);
    expect(dotCount(5, 10)).toBe(3);
    expect(dotCount(2, 8)).toBe(2);
    expect(dotCount(4, 0)).toBe(0);
  });
});

describe("edge kinds", () => {
  test("K1: back, refused and forward edges of the seed", () => {
    const back = walk(seed, "start").back;
    const kind = (id: string) => edgeKind(seed, seed.edges.find((e) => e.id === id)!, back);
    expect(kind("e04")).toBe("back");
    expect(kind("e11")).toBe("back");
    expect(kind("e06")).toBe("refused");
    expect(kind("e10")).toBe("refused");
    expect(kind("e01")).toBe("forward");
    expect(kind("e08")).toBe("forward");
    expect(kind("e14")).toBe("forward");
  });
});

let layout: Layout;
beforeAll(async () => {
  layout = await layoutProcess(seed);
});

const flow: Flow = {
  days: 30,
  closed: 4,
  ends: [{ node_id: "released", cases: 4, avg_lead_hours: 100 }],
  edges: [
    { edge_id: "e01", passes: 10 },
    { edge_id: "e02", passes: 5 },
  ],
  returns: 0,
  today: { people: 0, rules: 0 },
};

function sup(cases: SupCase[], late: number): Supervision {
  return {
    version_id: "v1",
    total_open: 2,
    total_late: late,
    nodes: [{ node_id: "analysis", open: 2, late, median_hours: 10 }],
    people: [],
    cases,
  };
}

function render(s: Supervision, selected: string | null = null): string {
  return renderToString(
    createElement(LiveDiagram, {
      def: seed,
      layout,
      sup: s,
      flow,
      selected,
      onSelect: () => {},
    }),
  );
}

const lateSup = sup([supCase("analysis", 50, true), supCase("analysis", 10, false)], 1);

describe("live diagram", () => {
  test("R1: task card, end labels, back edge and dots render", () => {
    const html = render(lateSup);
    expect(html).toContain('aria-label="Credit analysis: 2 waiting, 1 late"');
    expect(html).toContain("1 late");
    expect(html).toContain("median 10 h · max 48 h");
    expect(html).toContain("10 in 30 days");
    expect(html).toContain("4 in 30 days");
    expect(html).toContain("0 in 30 days");
    expect(html).toContain('stroke-dasharray="5 4"');
    expect(html.split('class="sup-dot"').length - 1).toBe(8);
  });

  test("R2: a case at 60 percent shows the near flag", () => {
    const html = render(sup([supCase("analysis", 30, false)], 0));
    expect(html).toContain("1 near the deadline");
    expect(html).not.toContain("1 late");
  });

  test("R3: the selected task is pressed, the others are not", () => {
    const html = render(lateSup, "analysis");
    const pressed = [...html.matchAll(/aria-pressed="(true|false)" aria-label="([^:"]+):/g)];
    expect(pressed.length).toBe(seed.nodes.filter((n) => n.type === "task").length);
    for (const [, value, name] of pressed) {
      expect(value).toBe(name === "Credit analysis" ? "true" : "false");
    }
  });
});

describe("node names", () => {
  test("N1: no name box of a start, gateway or end node overlaps another shape", () => {
    for (const n of layout.nodes.filter((m) => m.type !== "task")) {
      const box = nameBox(n, layout.nodes);
      for (const o of layout.nodes) {
        if (o === n) {
          continue;
        }
        const overlap =
          box.x < o.position.x + (o.width ?? 0) &&
          box.x + box.w > o.position.x &&
          box.y < o.position.y + (o.height ?? 0) &&
          box.y + 48 > o.position.y;
        expect(overlap, `${n.id} over ${o.id}`).toBe(false);
      }
    }
    // The start name sits next to the first task, so its box is narrower.
    const start = layout.nodes.find((m) => m.id === "start")!;
    expect(nameBox(start, layout.nodes).w).toBeLessThan(120);
  });
});
