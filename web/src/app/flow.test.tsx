// The test rows of the case flow: the columns, bars and bands of the
// seed process, the band labels, and the render of the card.

import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  bandTitle, caseFlow, CaseFlowCard, flowLayout, leadRows, limitPath, placeBandLabels, rateText,
  returnsText, spaceLabels, textWidth,
} from "./CaseFlow";
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

// The demo history of the review server (GET /api/versions/.../flow?days=30).
const DEMO: Record<string, number> = {
  e01: 60, e02: 57, e03: 57, e04: 0, e05: 58, e06: 3, e07: 45,
  e08: 13, e09: 32, e10: 3, e11: 7, e12: 43, e13: 41, e14: 39,
};

const demoFlow: Flow = {
  days: 30,
  closed: 45,
  ends: [
    { node_id: "released", cases: 39, avg_lead_hours: 225.9 },
    { node_id: "refused", cases: 6, avg_lead_hours: 79.6 },
  ],
  edges: Object.entries(DEMO).map(([edge_id, passes]) => ({ edge_id, passes })),
  returns: 7,
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
    expect(label("e03")).toBe("Complete: 18");
    expect(label("e06")).toBe("Unfavorable: 4");
    expect(label("e07")).toBe("Above limit: 6");
    expect(label("e08")).toBe("Within limit: 6");
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
      "13 cases closed in 30 days.",
      'aria-label="About the case flow"',
      "Application received",
      "Outcome",
      "Complete: 18",
      "File complete? Yes: 18",
      "Loan released",
      "8 cases, 62%",
      "5 cases, 38%",
      'fill="#ef4444"',
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/<path[^>]*opacity="0.42"/g)).toHaveLength(10);
    expect(html).not.toContain("The band width shows");
  });

  test("14.4 row R2: no pass shows the empty text and no diagram", () => {
    const html = renderToString(CaseFlowCard({ def: seed, flow: zeroFlow }));
    expect(html).toContain("No case passed a link in 30 days.");
    // The only svg is the (?) icon of the hint.
    expect(html.match(/<svg/g)).toHaveLength(1);
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
    // Room: 100 - 3 - 0 gives 97 units.
    const [l] = placeBandLabels(
      [{ id: "a", x: 0, y: 50, text: "Amount above EUR 100,000 or more: 18" }],
      100,
    );
    expect(l!.text).toBe("Amount abo…: 18");
    expect(textWidth(l!.text)).toBeLessThanOrEqual(97);
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

  // Fixtures for the side column: the seed flow with some passes changed.
  const withPasses = (p: Record<string, number>): Flow => ({
    ...seedFlow,
    edges: seedFlow.edges.map((e) => (e.edge_id in p ? { ...e, passes: p[e.edge_id]! } : e)),
  });
  const s2: ProcessDefinition = {
    ...seed,
    edges: seed.edges.map((e) => (e.id === "e07" ? { ...e, condition: "size(documents) > 1" } : e)),
  };

  test("14.4b row P5: a text with no question mark keeps the rule of P2", () => {
    const [l] = placeBandLabels([{ id: "a", x: 0, y: 50, text: "Unfavorable decision of the bank: 4" }], 100);
    expect(l!.text).toBe("Unfavorable…: 4");
  });

  test("14.4b row S1: the limit path of the seed", () => {
    expect(limitPath(seed, seedFlow)).toEqual({
      condition: "amount > 100000.0",
      targetId: "decision",
      targetName: "Credit decision",
      passes: 6,
      total: 12,
      decisions: [
        { label: "Approve", value: 3, kind: "forward" },
        { label: "Refuse", value: 1, kind: "refused" },
        { label: "Return to Credit analysis", value: 2, kind: "back" },
      ],
    });
  });

  test("14.4b row S2: no condition names a money field", () => {
    expect(limitPath(s2, seedFlow)).toBeNull();
  });

  test("14.4b row S3: no pass through the gateway", () => {
    const l = limitPath(seed, withPasses({ e07: 0, e08: 0 }))!;
    expect([l.passes, l.total]).toEqual([0, 0]);
  });

  test("14.4b row S4: the lead rows of the seed", () => {
    expect(leadRows(seed, seedFlow)).toEqual([
      { nodeId: "released", name: "Loan released", cases: 8, days: "5.0 d", width: 100, refused: false },
      { nodeId: "refused", name: "Application refused", cases: 5, days: "2.0 d", width: 40, refused: true },
    ]);
  });

  test("14.4b row S5: an end with no case", () => {
    const flow: Flow = {
      ...seedFlow,
      ends: seedFlow.ends.map((e) => (e.node_id === "refused" ? { ...e, cases: 0 } : e)),
    };
    const row = leadRows(seed, flow).find((r) => r.nodeId === "refused")!;
    expect([row.cases, row.days, row.width]).toEqual([0, "-", 0]);
  });

  test("14.4b rows S6 to S8: the returns text", () => {
    expect(returnsText(seed, seedFlow)).toBe(
      "4 cases went back to Application entry. 2 cases went back to Credit analysis from Credit decision.",
    );
    expect(returnsText(seed, withPasses({ e04: 0, e11: 1 }))).toBe(
      "1 case went back to Credit analysis from Credit decision.",
    );
    expect(returnsText(seed, withPasses({ e04: 0, e11: 0 }))).toBe("No case went back.");
  });

  test("14.4b row S9: the return rate", () => {
    expect(rateText(seedFlow)).toBe("Return rate: 6 returns on 13 closed cases, 46 percent.");
    expect(rateText({ ...seedFlow, closed: 0 })).toBe("No closed case in 30 days.");
    expect(rateText({ ...seedFlow, returns: 1, closed: 4 })).toBe(
      "Return rate: 1 return on 4 closed cases, 25 percent.",
    );
  });

  test("14.4b row R4: the side column of the seed flow", () => {
    const html = renderToString(CaseFlowCard({ def: seed, flow: seedFlow }));
    for (const text of [
      "Cases that go to Credit decision",
      "50%",
      "6 of 12 cases",
      "amount &gt; 100000.0",
      "rule of the gateway",
      "Decisions at Credit decision",
      "Return to Credit analysis",
      "Average lead time by end, first event to end",
      "5.0 d",
      "4 cases went back to Application entry. 2 cases went back to Credit analysis from Credit decision.",
      "Return rate: 6 returns on 13 closed cases, 46 percent.",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/fill="#2563eb"/g)).toHaveLength(2);
  });

  test("14.4b row R5: no limit path gives no limit block and no blue band", () => {
    const html = renderToString(CaseFlowCard({ def: s2, flow: seedFlow }));
    expect(html).not.toContain("Cases that go to");
    expect(html).not.toContain('fill="#2563eb"');
  });

  // The 14.6 layout: lanes for skipped columns, bar order and band order.
  type Layout = ReturnType<typeof flowLayout>;
  const seedLayout = flowLayout(caseFlow(seed, seedFlow));
  const demoLayout = flowLayout(caseFlow(seed, demoFlow));
  const column = (l: Layout, c: number) => l.items.filter((i) => i.column === c);
  const seg = (l: Layout, edgeId: string, from: string) =>
    l.segments.find((s) => s.edgeId === edgeId && s.from === from)!;
  const segTo = (l: Layout, edgeId: string, to: string) =>
    l.segments.find((s) => s.edgeId === edgeId && s.to === to)!;

  test("14.6 row L1: the layout of the demo history", () => {
    const expected: [string, number][][] = [
      [["start", 44]],
      [["entry", 44]],
      [["analysis", 44]],
      [["e08@3", 44], ["decision", 143.1], ["e06@3", 432.2]],
      [["offer", 44], ["e10@4", 333.0], ["e06@4", 372.9]],
      [["signing", 44], ["e10@5", 321.2], ["e06@5", 361.0]],
      [["release", 44], ["e10@6", 309.3], ["e06@6", 349.1]],
      [["released", 44], ["refused", 297.4]],
    ];
    expect(demoLayout.K).toBeCloseTo(362 / 61, 4);
    expect(demoLayout.items.map((i) => i.id)).toEqual(expected.flat().map(([id]) => id));
    expected.forEach((list, c) => {
      const got = column(demoLayout, c);
      list.forEach(([id, y], k) => {
        expect(got[k]!.id).toBe(id);
        expect(got[k]!.y).toBeCloseTo(y, 1);
      });
    });
  });

  test("14.6 row L2: a lane never overlaps a bar of its column", () => {
    for (const l of [seedLayout, demoLayout]) {
      for (let c = 0; c < 8; c++) {
        const bars = column(l, c).filter((i) => !i.lane);
        for (const lane of column(l, c).filter((i) => i.lane)) {
          const above = lane.y + lane.h <= bars[0]!.y;
          const below = lane.y >= bars.at(-1)!.y + bars.at(-1)!.h;
          expect(above || below).toBe(true);
        }
      }
    }
  });

  test("14.6 row L3: the ports follow the other end, and no two bands cross", () => {
    for (const l of [seedLayout, demoLayout]) {
      const item = new Map(l.items.map((i) => [i.id, i]));
      const mid = (id: string) => item.get(id)!.y + item.get(id)!.h / 2;
      const after = (a: { edgeId: string }, ma: number, b: { edgeId: string }, mb: number) =>
        ma < mb || (ma === mb && a.edgeId < b.edgeId);
      for (const it of l.items) {
        const outs = l.segments.filter((s) => s.from === it.id).sort((a, b) => a.y0 - b.y0);
        const ins = l.segments.filter((s) => s.to === it.id).sort((a, b) => a.y1 - b.y1);
        let t = it.y;
        outs.forEach((s, k) => {
          expect(s.y0).toBeCloseTo(t, 6);
          t += s.h;
          if (k > 0) expect(after(outs[k - 1]!, mid(outs[k - 1]!.to), s, mid(s.to))).toBe(true);
        });
        t = it.y;
        ins.forEach((s, k) => {
          expect(s.y1).toBeCloseTo(t, 6);
          t += s.h;
          if (k > 0) expect(after(ins[k - 1]!, mid(ins[k - 1]!.from), s, mid(s.from))).toBe(true);
        });
      }
      for (const a of l.segments) {
        for (const b of l.segments) {
          if (item.get(a.from)!.column === item.get(b.from)!.column && a.y0 < b.y0) {
            expect(a.y1).toBeLessThanOrEqual(b.y1);
          }
        }
      }
    }
  });

  test("14.6 row L4: the layout of the seed flow", () => {
    expect(seedLayout.K).toBe(6);
    expect(["e08", "e07", "e06"].map((e) => seg(seedLayout, e, "analysis").y0)).toEqual([44, 80, 116]);
    expect(["e10", "e06"].map((e) => segTo(seedLayout, e, "refused").y1)).toEqual([114, 120]);
    const y = (id: string) => seedLayout.items.find((i) => i.id === id)!.y;
    expect([y("e08@3"), y("decision")]).toEqual([44, 102]);
  });

  test("14.6 row L5: the end bars sort by y, not by node order", () => {
    const nodes = [...seed.nodes];
    const r = nodes.findIndex((n) => n.id === "refused");
    nodes.splice(nodes.findIndex((n) => n.id === "released"), 0, ...nodes.splice(r, 1));
    expect(nodes.findIndex((n) => n.id === "refused")).toBeLessThan(nodes.findIndex((n) => n.id === "released"));
    const l = flowLayout(caseFlow({ ...seed, nodes }, demoFlow));
    expect(column(l, 7).map((i) => i.id)).toEqual(["released", "refused"]);
  });

  test("14.6 row L6: a bar with no incoming band goes last", () => {
    const flow: Flow = {
      ...demoFlow,
      edges: demoFlow.edges.map((e) => (["e06", "e10"].includes(e.edge_id) ? { ...e, passes: 0 } : e)),
    };
    const l = flowLayout(caseFlow(seed, flow));
    expect(l.segments.filter((s) => s.to === "refused")).toEqual([]);
    expect(column(l, 7).map((i) => i.id)).toEqual(["released", "refused"]);
    expect(column(l, 7)[1]!.h).toBe(0);
  });

  test("14.6 row L7: the band paths of the seed card", () => {
    const html = renderToString(CaseFlowCard({ def: seed, flow: seedFlow }));
    expect(html).toContain('d="M32,44 C78,44 78,44 124,44 L124,164 C78,164 78,164 32,164 Z"');
    expect(html).toContain(
      'd="M240,44 C286,44 286,44 332,44 L344,44 C390,44 390,44 436,44 L436,80 C390,80 390,80 344,80 L332,80 C286,80 286,80 240,80 Z"',
    );
  });

  // The 14.6 gateway labels: a short answer, and the full question in the title.
  const texts = (def: ProcessDefinition, flow: Flow = seedFlow) =>
    Object.fromEntries(caseFlow(def, flow).bands.map((b) => [b.edgeId, [b.label, b.title]]));
  const withThreshold = (name: string, e07: string): ProcessDefinition => ({
    ...seed,
    nodes: seed.nodes.map((n) => (n.id === "threshold" ? { ...n, name } : n)),
    edges: seed.edges.map((e) => (e.id === "e07" ? { ...e, condition: e07 } : e)),
  });

  test("14.6 row B1: the labels and titles of the seed", () => {
    const t = texts(seed);
    expect(t.e03).toEqual(["Complete: 18", "File complete? Yes: 18"]);
    expect(t.e07).toEqual(["Above limit: 6", "Amount above EUR 100,000? Yes: 6"]);
    expect(t.e08).toEqual(["Within limit: 6", "Amount above EUR 100,000? No: 6"]);
    expect(t.e06).toEqual(["Unfavorable: 4", "Unfavorable: 4"]);
    expect(t.e01).toEqual([null, "20"]);
  });

  test("14.6 row B2: an edge label wins", () => {
    const def: ProcessDefinition = {
      ...seed,
      edges: seed.edges.map((e) => (e.id === "e03" ? { ...e, label: "Full file" } : e)),
    };
    expect(texts(def).e03).toEqual(["Full file: 18", "File complete? Full file: 18"]);
    expect(bandTitle(def, def.edges.find((e) => e.id === "e03")!, 18)).toBe("File complete? Full file: 18");
  });

  test("14.6 row B3: the last word of the question", () => {
    const t = texts(withThreshold("Risk high?", "size(documents) > 1"));
    expect([t.e07![0], t.e08![0]]).toEqual(["High: 6", "Not high: 6"]);
  });

  test("14.6 row B4: a limit with >=", () => {
    expect(texts(withThreshold("Amount above EUR 100,000?", "amount >= 100000.0")).e07![0]).toBe("Above limit: 6");
  });

  test("14.6 row B5: a money condition with < is not a limit", () => {
    const t = texts(withThreshold("Amount small?", "amount < 100000.0"));
    expect([t.e07![0], t.e08![0]]).toEqual(["Small: 6", "Not small: 6"]);
  });

  test("14.6 row B6: a gateway with three branches keeps the condition", () => {
    const def: ProcessDefinition = {
      ...seed,
      edges: [
        ...seed.edges,
        { id: "e15", from: "threshold", to: "refused", label: null, decision: null, condition: "amount > 500000.0", is_default: false },
      ],
    };
    const t = texts(def);
    expect([t.e07![0], t.e08![0]]).toEqual(["amount > 100000.0: 6", "Otherwise: 6"]);
  });

  test("14.6 row T1: the width estimate", () => {
    expect(["Above limit: 45", "Within limit: 13", "Complete: 57"].map(textWidth)).toEqual([82, 80, 73]);
  });

  test("14.6 row P7: a label that fits exactly stays, one unit less cuts it", () => {
    const at = (gapRight: number) =>
      placeBandLabels([{ id: "a", x: 0, y: 50, text: "Within limit: 13" }], gapRight)[0]!.text;
    expect([at(83), at(82)]).toEqual(["Within limit: 13", "Within li…: 13"]);
  });

  test("14.6 row P8: no room for the name keeps the count", () => {
    const [l] = placeBandLabels([{ id: "a", x: 0, y: 50, text: "Approve: 12345" }], 40);
    expect(l!.text).toBe("…: 12345");
  });

  test("14.6 row R6: the card of the demo history", () => {
    const html = renderToString(CaseFlowCard({ def: seed, flow: demoFlow }));
    for (const text of [
      "Complete: 57",
      "Above limit: 45",
      "Within limit: 13",
      "Unfavorable: 3",
      "<title>File complete? Yes: 57</title>",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/<text[^>]*>[^<]*…/);
    expect(html.match(/<path[^>]*opacity="0.42"/g)).toHaveLength(10);
  });
});
