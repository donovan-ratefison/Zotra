// The test rows of the compare screen. The environment is node:
// direct calls of the pure functions, and renderToString of the
// screen with a query client that holds the fixtures.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import seedJson from "../../../examples/home-loan/process.json";
import type { Supervision } from "../app/sup-api";
import {
  changeLines,
  comparePair,
  compareUrl,
  impactRows,
  pickPair,
  stageText,
  swapPair,
  versionText,
} from "./compare";
import { summarizeChanges } from "./ai-api";
import { ApiError } from "./api";
import { CompareScreen, ImpactBlock, SummaryBlock } from "./CompareScreen";
import { diffDefinitions } from "./diff";
import { HistoryBody } from "./version-actions";
import type { ProcessDefinition, Version, VersionSummary } from "./types";

const base = seedJson as unknown as ProcessDefinition;
const other: ProcessDefinition = structuredClone(base);
other.nodes.find((n) => n.id === "analysis")!.deadline_hours = 72;
other.edges = other.edges.filter((e) => e.id !== "e06");
other.nodes.push({
  id: "committee", type: "task", name: "Credit committee", role: "director",
  deadline_hours: 24, documents: [], signature: false, checks: [],
  decisions: [], end_result: null, scope_overrides: [], source_ids: [],
  citations: [],
});
other.edges.push({
  id: "e15", from: "committee", to: "offer", label: null, decision: null,
  condition: null, is_default: false,
});

function summary(
  n: number,
  status: VersionSummary["status"],
  parent: string | null,
  label: string,
): VersionSummary {
  return {
    id: `v${n}`, process_id: "p1", parent_id: parent, number: n, label,
    status, created_at: `2026-10-0${n}T09:00:00Z`, frozen_at: null,
  };
}

const v1 = summary(1, "published", null, "Initial");
const v2 = summary(2, "frozen", "v1", "Threshold");
const v3 = summary(3, "draft", "v2", "Committee");
const all = [v1, v2, v3];

const sup: Supervision = {
  version_id: "v2",
  total_open: 5,
  total_late: 0,
  nodes: [
    { node_id: "analysis", open: 3, late: 0, median_hours: 1 },
    { node_id: "entry", open: 2, late: 0, median_hours: 1 },
    { node_id: "offer", open: 0, late: 0, median_hours: 0 },
    { node_id: "ghost", open: 1, late: 0, median_hours: 1 },
  ],
  people: [],
  cases: [],
};

const ROWS = [
  "+ Task Credit committee",
  "~ Task Credit analysis modified",
  "+ Link Credit committee to Loan offer",
  "- Link Credit analysis to Application refused",
];
const CHIPS = ["+1 step", "1 modified step", "+1 link", "-1 link"];

// renderToString escapes the text: the expected strings go through
// the same escape.
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderScreen(
  versions: VersionSummary[],
  cache: [unknown[], unknown][],
): string {
  const client = new QueryClient();
  for (const [key, value] of cache) {
    client.setQueryData(key, value);
  }
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        ReactFlowProvider,
        null,
        createElement(CompareScreen, {
          versions, openId: "v3", baseId: "v2", onClose: () => {},
        }),
      ),
    ),
  );
}

const full = (v: VersionSummary, def: ProcessDefinition): Version => ({ ...v, definition: def });

describe("comparePair", () => {
  test("P1: the parent is the base", () => {
    expect(comparePair(all, "v3", null)).toEqual({ base: "v2", other: "v3" });
  });
  test("P2: the asked base, else the parent", () => {
    expect(comparePair(all, "v3", "v1")?.base).toBe("v1");
    expect(comparePair(all, "v3", "v3")?.base).toBe("v2");
    expect(comparePair(all, "v3", "ghost")?.base).toBe("v2");
  });
  test("P3: no parent: the newest other version", () => {
    expect(comparePair(all, "v1", null)).toEqual({ base: "v3", other: "v1" });
  });
  test("P4: parent not listed: the newest other version", () => {
    expect(comparePair([v1, v3], "v3", null)?.base).toBe("v1");
  });
  test("P5: one version, or an unknown open version", () => {
    expect(comparePair([v1], "v1", null)).toBeNull();
    expect(comparePair(all, "ghost", null)).toBeNull();
  });
});

describe("pickPair and swapPair", () => {
  const pair = { base: "v2", other: "v3" };
  test("K1: a side takes a new version", () => {
    expect(pickPair(pair, "base", "v1", all)).toEqual({ base: "v1", other: "v3" });
    expect(pickPair(pair, "other", "v1", all)).toEqual({ base: "v2", other: "v1" });
  });
  test("K2: the version of the other side swaps; an unknown id keeps", () => {
    expect(pickPair(pair, "base", "v3", all)).toEqual({ base: "v3", other: "v2" });
    expect(pickPair(pair, "other", "v2", all)).toEqual({ base: "v3", other: "v2" });
    expect(pickPair(pair, "base", "ghost", all)).toEqual(pair);
  });
  test("K3: swap", () => {
    expect(swapPair(pair)).toEqual({ base: "v3", other: "v2" });
  });
});

describe("texts", () => {
  test("T1: versionText", () => {
    expect(versionText(v2)).toBe("v2 · Threshold (Frozen)");
  });
  test("L1: changeLines", () => {
    expect(changeLines(diffDefinitions(base, other).rows)).toEqual(ROWS);
    expect(changeLines([])).toEqual([]);
  });
  test("I1: impactRows in the order of the definition", () => {
    expect(impactRows(sup, base)).toEqual([
      { name: "Application entry", open: 2 },
      { name: "Credit analysis", open: 3 },
    ]);
  });
  test("U1: compareUrl encodes each value", () => {
    expect(compareUrl("p 1", "v3", "v2")).toBe("/?process=p%201&version=v3&compare=v2");
  });
  test("S1: stageText", () => {
    const ok = { isPending: false, error: null };
    const bad = { isPending: false, error: new Error("boom") };
    expect(stageText(bad, ok)).toBe("The versions did not load. boom");
    expect(stageText(ok, bad)).toBe("The versions did not load. boom");
    expect(stageText({ isPending: true, error: null }, ok)).toBe("Loading the versions…");
    expect(stageText(ok, ok)).toBeNull();
  });
});

describe("CompareScreen", () => {
  test("W1: the header, the diagram card, the impact and the panel", () => {
    const html = renderScreen(all, [
      [["version", "v2"], full(v2, base)],
      [["version", "v3"], full(v3, other)],
      [["supervision", "v2"], sup],
    ]);
    const texts = [
      "Base v2 · target v3 · 4 changes",
      "Differences",
      ...CHIPS,
      "Task Credit committee",
      "Task Credit analysis modified",
      "Link Credit committee to Loan offer",
      "Link Credit analysis to Application refused",
      ROWS.join("\n"),
      "Diagram of v3 · Committee, differences with v2",
      "Added or changed",
      "Back to the diagram",
      'aria-label="Base version"',
      'aria-label="Swap the versions"',
      'aria-label="Compared version"',
      ">5<",
      "open cases on v2",
    ];
    for (const text of texts) {
      expect(html).toContain(text.startsWith("aria") || text === ">5<" ? text : esc(text));
    }
  });
  test("W2: no cache: the loading text", () => {
    expect(renderScreen(all, [])).toContain("Loading the versions…");
  });
  test("W3: one version", () => {
    expect(renderScreen([v1], [])).toContain("Compare needs two versions.");
  });
  test("W4: the same definition on both sides", () => {
    const html = renderScreen(all, [
      [["version", "v2"], full(v2, base)],
      [["version", "v3"], full(v3, base)],
      [["supervision", "v2"], sup],
    ]);
    expect(html).toContain("0 changes");
    expect(html).toContain("No change<");
    expect(html).toContain("No change.");
  });
});

describe("ImpactBlock", () => {
  const block = (s: Supervision | undefined, error: Error | null) =>
    renderToString(createElement(ImpactBlock, { baseNumber: 2, sup: s, error, def: base }));
  test("B1: error, pending, no open case", () => {
    expect(block(sup, new Error("x"))).toContain("The open cases did not load.");
    expect(block(undefined, null)).toContain("Counting the open cases…");
    expect(block({ ...sup, total_open: 0 }, null)).toContain("No open case on v2.");
  });
});

describe("HistoryBody compare", () => {
  const history = (onCompare?: (id: string) => void) =>
    renderToString(
      createElement(HistoryBody, {
        def: base, version: v3, versions: all, onCompare, onAction: () => {},
      }),
    );
  test("H1: one Compare button per version that is not shown", () => {
    const html = history(() => {});
    expect(html.match(/>Compare</g)).toHaveLength(2);
    expect(html).toContain('aria-label="Compare v1 with the shown version"');
    expect(html).toContain('aria-label="Compare v2 with the shown version"');
    expect(html).not.toContain("Compare v3");
  });
  test("H2: no prop: no Compare button", () => {
    expect(history()).not.toContain("Compare");
  });
});

describe("SummaryBlock", () => {
  const block = (p: Partial<Parameters<typeof SummaryBlock>[0]>) =>
    renderToString(
      createElement(SummaryBlock, {
        empty: false, busy: false, text: null, error: null, onSummarize: () => {}, ...p,
      }),
    );
  const button = (html: string) => html.match(/<button[^>]*>/)![0];
  test("S1: all null: the button is enabled, the muted line", () => {
    const html = block({});
    expect(html).toContain("Summarize with AI");
    expect(button(html)).not.toContain("disabled=\"\"");
    expect(html).toContain("The AI writes a short summary of the changes.");
  });
  test("S2: empty or busy: the button is disabled", () => {
    expect(button(block({ empty: true }))).toContain("disabled=\"\"");
    const busy = block({ busy: true });
    expect(busy).toContain("Summarizing…");
    expect(button(busy)).toContain("disabled=\"\"");
    expect(busy).not.toContain("The AI writes a short summary of the changes.");
  });
  test("S3: text: the paragraph", () => {
    expect(block({ text: "One step was added." })).toContain("One step was added.");
  });
  test("S4: error: the red line", () => {
    const html = block({ error: "AI down" });
    expect(html).toContain("The summary did not load. AI down");
    expect(html).toContain("color:#dc2626");
  });
});

describe("summarizeChanges", () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const stubFetch = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Promise.resolve({ ok: status < 400, status, json: async () => body });
    });
  afterEach(() => {
    seen.length = 0;
    vi.unstubAllGlobals();
  });
  test("S5: the request, the answer and the error", async () => {
    stubFetch(200, { summary: "S" });
    await expect(summarizeChanges(["+ a"])).resolves.toEqual({ summary: "S" });
    expect(seen[0].url).toBe("/api/ai/compare-versions");
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.body).toBe('{"changes":["+ a"]}');
    stubFetch(503, { error: { code: "ai_unavailable", message: "off" } });
    const error = await summarizeChanges(["+ a"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("off");
  });
});
