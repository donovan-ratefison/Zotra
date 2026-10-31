// The test rows of the case flow: the columns, bars and bands of the
// seed process, the band labels, and the render of the card.

import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { caseFlow, CaseFlowCard, placeBandLabels, spaceLabels } from "./CaseFlow";
import type { Flow } from "./sup-api";
import type { ProcessDefinition } from "../studio/types";

const seed = JSON.parse(
  readFileSync("../internal/store/seed/example-process.json", "utf8"),
) as ProcessDefinition;

const PASSES: Record<string, number> = {
  e01: 20, e02: 24, e03: 18, e04: 4, e05: 12, e06: 4, e07: 6,
  e08: 6, e09: 3, e10: 1, e11: 2, e12: 9, e13: 9, e14: 8,
};

const seedFlow: Flow = {
  days: 30,
  closed: 13,
  ends: [
    { node_id: "released", cases: 8, avg_lead_hours: 120 },
    { node_id: "refused", cases: 5, avg_lead_hours: 48 },
  ],
  edges: Object.entries(PASSES).map(([edge_id, passes]) => ({ edge_id, passes })),
  returns: 6,
  today: { people: 0, rules: 0 },
};

const zeroFlow: Flow = {
  ...seedFlow,
  edges: seedFlow.edges.map((e) => ({ ...e, passes: 0 })),
};

type Model = ReturnType<typeof caseFlow>;
const barList = (m: Model) => m.bars.map((b) => `${b.nodeId}:${b.column}:${b.value}`);
const bandList = (m: Model) => m.bands.map((b) => `${b.edgeId} ${b.from}>${b.to} ${b.value}`);

describe("case flow", () => {
  test("14.4 row C1: columns, bars and bands of the seed process", () => {
    const m = caseFlow(seed, seedFlow);
    expect(m.columns).toBe(8);
    expect(barList(m)).toEqual([
      "start:0:20", "entry:1:20", "analysis:2:18", "decision:3:6", "offer:4:9",
      "signing:5:9", "release:6:9", "released:7:8", "refused:7:5",
    ]);
    expect(bandList(m)).toEqual([
      "e01 start>entry 20", "e03 entry>analysis 18", "e06 analysis>refused 4",
      "e07 analysis>decision 6", "e08 analysis>offer 6", "e09 decision>offer 3",
      "e10 decision>refused 1", "e12 offer>signing 9", "e13 signing>release 9",
      "e14 release>released 8",
    ]);
  });

  test("14.4 row C2: the refused bands and the band labels", () => {
    const bands = caseFlow(seed, seedFlow).bands;
    expect(bands.filter((b) => b.refused).map((b) => b.edgeId)).toEqual(["e06", "e10"]);
    const label = (id: string) => bands.find((b) => b.edgeId === id)!.label;
    expect(label("e01")).toBeNull();
    expect(label("e03")).toBe("File complete? Yes: 18");
    expect(label("e06")).toBe("Unfavorable: 4");
    expect(label("e07")).toBe("Amount above EUR 100,000? Yes: 6");
    expect(label("e08")).toBe("Amount above EUR 100,000? No: 6");
    expect(label("e09")).toBe("Approve: 3");
    expect(label("e10")).toBe("Refuse: 1");
    expect(label("e12")).toBeNull();
  });

  test("14.4 row C3: a link with no pass and an unknown edge draw no band", () => {
    const flow: Flow = {
      ...seedFlow,
      edges: [
        ...seedFlow.edges.map((e) => (e.edge_id === "e09" ? { ...e, passes: 0 } : e)),
        { edge_id: "e99", passes: 5 },
      ],
    };
    const m = caseFlow(seed, flow);
    const ids = m.bands.map((b) => b.edgeId);
    expect(ids).not.toContain("e09");
    expect(ids).not.toContain("e99");
    expect(m.bars.find((b) => b.nodeId === "offer")!.value).toBe(9);
  });

  test("14.4 row C4: no pass gives no band and empty bars", () => {
    const m = caseFlow(seed, zeroFlow);
    expect(m.bands).toEqual([]);
    expect(m.columns).toBe(8);
    expect(m.bars.every((b) => b.value === 0)).toBe(true);
  });

  test("14.4 row C5: a gateway with two ways in stays a bar", () => {
    const def: ProcessDefinition = {
      ...seed,
      edges: [
        ...seed.edges,
        { id: "e15", from: "start", to: "complete", label: null, decision: null, condition: null, is_default: false },
      ],
    };
    const m = caseFlow(def, seedFlow);
    expect(m.bars.map((b) => b.nodeId)).toContain("complete");
    expect(bandList(m)).toContain("e02 entry>complete 24");
    expect(m.bands.map((b) => b.edgeId)).toContain("e03");
  });

  test("14.4 row R1: the card of the seed flow", () => {
    const html = renderToString(CaseFlowCard({ def: seed, flow: seedFlow }));
    for (const text of [
      "Case flow, last 30 days",
      "13 cases closed in 30 days. The band width shows the passes on each link.",
      "Application received",
      "Outcome",
      "File complete? Yes: 18",
      "Loan released",
      "8 cases, 62%",
      "5 cases, 38%",
      'fill="#ef4444"',
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/<path[^>]*opacity="0.42"/g)).toHaveLength(10);
  });

  test("14.4 row R2: no pass shows the empty text and no diagram", () => {
    const html = renderToString(CaseFlowCard({ def: seed, flow: zeroFlow }));
    expect(html).toContain("No case passed a link in 30 days.");
    expect(html).not.toContain("<svg");
  });

  test("14.4 row P1: two labels at the same y are 14 apart", () => {
    const out = placeBandLabels(
      [
        { id: "a", x: 0, y: 50, text: "Yes: 1" },
        { id: "b", x: 0, y: 50, text: "No: 2" },
      ],
      200,
    );
    expect(out.map((l) => `${l.id}:${l.y}`)).toEqual(["a:50", "b:64"]);
  });

  test("14.4 row P2: a long label loses the end of its name, not its count", () => {
    // Room: (100 - 6 - 0) / 6.2 gives 15 characters.
    const [l] = placeBandLabels(
      [{ id: "a", x: 0, y: 50, text: "Amount above EUR 100,000? Yes: 18" }],
      100,
    );
    expect(l!.text).toBe("Amount abo…: 18");
    expect(l!.text.length).toBeLessThanOrEqual(15);
  });

  test("14.4 row P3: labels 20 apart stay in place", () => {
    const labels = [
      { id: "a", x: 0, y: 50, text: "Yes: 1" },
      { id: "b", x: 0, y: 70, text: "No: 2" },
    ];
    expect(placeBandLabels(labels, 200)).toEqual(labels);
  });

  test("14.4 row E1: two end labels 2 apart: the second starts 30 below", () => {
    const out = spaceLabels([{ id: "b", y: 102 }, { id: "a", y: 100 }], 30);
    expect(out).toEqual([{ id: "a", y: 100 }, { id: "b", y: 130 }]);
  });

  test("14.4 row R3: no closed case gives 0 percent", () => {
    const flow: Flow = {
      ...seedFlow,
      closed: 0,
      ends: seedFlow.ends.map((e) => ({ ...e, cases: 0 })),
    };
    const html = renderToString(CaseFlowCard({ def: seed, flow }));
    expect(html).toContain("0 cases, 0%");
  });
});
