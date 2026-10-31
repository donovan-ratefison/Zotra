// The chain strip test rows B1 to B5, G1 to G3, T1, T2, C1, C2 and S1
// to S6. The environment is node: renderToString for the strip.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import seedJson from "../../../internal/store/seed/example-process.json";
import { ApiError } from "../studio/api";
import type { CaseEvent, CaseState } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import { verifyCase } from "./app-api";
import { ChainStrip } from "./CaseChain";
import { chainBlocks, chainStatus, ghostLabels, seqTone, type VerifyRun } from "./chain";

const def = seedJson as ProcessDefinition;
const h = (seq: number) => String(seq).padStart(8, "0") + "f".repeat(56);
const hev = (seq: number, type: string, payload: Record<string, unknown> = {}, actor = "system"): CaseEvent => ({
  case_id: "c1", seq, type, at: "2026-10-31T10:00:00Z", actor, payload,
  prev_hash: seq === 1 ? "0".repeat(64) : h(seq - 1), hash: h(seq),
});
const base = [
  hev(1, "case_created", {}, "u-advisor"),
  hev(2, "edge_taken", { edge_id: "e01" }),
  hev(3, "step_entered", { node_id: "entry" }),
  hev(4, "step_assigned", { node_id: "entry", user_id: "u-advisor" }, "u-advisor"),
  hev(5, "data_submitted", { node_id: "entry", values: {} }, "u-advisor"),
  hev(6, "check_evaluated", { node_id: "entry", check_id: "entry-amount", result: true, error: null }, "u-advisor"),
  hev(7, "edge_taken", { edge_id: "e02" }),
  hev(8, "step_entered", { node_id: "complete" }),
  hev(9, "edge_taken", { edge_id: "e03" }),
  hev(10, "step_entered", { node_id: "analysis" }),
  hev(11, "source_fetched", { node_id: "analysis", source_id: "blacklist", values: {} }),
  hev(12, "source_fetched", { node_id: "analysis", source_id: "existing_loans", values: {} }),
];
const st = (over: Partial<CaseState> = {}): CaseState => ({
  case_id: "c1", version_id: "v1", status: "open", result: "", node_id: "analysis", assignee: "",
  data: { amount: 180000 }, seq: 12, prev_hash: h(12), ...over,
});
const blk = (label: string, from: number, to: number, kind: string) => ({
  label, from, to, hash: h(to).slice(0, 8), prev: (from === 1 ? "0".repeat(8) : h(from - 1).slice(0, 8)), kind,
});

describe("chain blocks", () => {
  test("B1: one block for each step", () => {
    expect(chainBlocks(def, base, st())).toEqual([
      blk("Application received", 1, 2, "step"),
      blk("Application entry", 3, 7, "step"),
      blk("File complete?", 8, 9, "rule"),
      blk("Credit analysis", 10, 12, "cur"),
    ]);
  });

  test("B2: the blocks after a decision", () => {
    const more = [
      hev(13, "step_assigned", { node_id: "analysis", user_id: "u-analyst" }, "u-analyst"),
      hev(14, "data_submitted", { node_id: "analysis", values: {} }, "u-analyst"),
      hev(15, "check_evaluated", {}, "u-analyst"),
      hev(16, "check_evaluated", {}, "u-analyst"),
      hev(17, "check_evaluated", {}, "u-analyst"),
      hev(18, "decision_made", { node_id: "analysis", decision: "favorable" }, "u-analyst"),
      hev(19, "edge_taken", { edge_id: "e05" }),
      hev(20, "step_entered", { node_id: "threshold" }),
      hev(21, "edge_taken", { edge_id: "e07" }),
      hev(22, "step_entered", { node_id: "decision" }),
    ];
    const out = chainBlocks(def, [...base, ...more], st({ node_id: "decision", seq: 22 }));
    expect(out.map((b) => [b.label, b.from, b.to, b.kind])).toEqual([
      ["Application received", 1, 2, "step"],
      ["Application entry", 3, 7, "step"],
      ["File complete?", 8, 9, "rule"],
      ["Credit analysis", 10, 19, "step"],
      ["Amount above EUR 100,000?", 20, 21, "rule"],
      ["Credit decision", 22, 22, "cur"],
    ]);
  });

  test("B3: no event gives no block", () => {
    expect(chainBlocks(def, [], st())).toEqual([]);
  });

  test("B4: an unknown node gives its raw id", () => {
    const out = chainBlocks(def, [hev(1, "case_created"), hev(2, "step_entered", { node_id: "ghost" })], st());
    expect(out[1]).toMatchObject({ label: "ghost", kind: "cur" });
  });

  test("B5: a closed case has no current block", () => {
    expect(chainBlocks(def, base, st({ status: "closed" })).at(-1)!.kind).toBe("step");
  });
});

describe("ghost blocks", () => {
  test("G1: the next steps", () => {
    expect(ghostLabels(def, st(), 4)).toEqual([
      "Amount above EUR 100,000?", "Loan offer", "Client signature at the branch", "Release of funds", "Loan released",
    ]);
  });

  test("G2: 9 blocks at most", () => {
    expect(ghostLabels(def, st(), 7)).toEqual(["Amount above EUR 100,000?", "Loan offer"]);
  });

  test("G3: a closed case has no ghost", () => {
    expect(ghostLabels(def, st({ status: "closed", node_id: "released" }), 3)).toEqual([]);
  });
});

const runs: (VerifyRun | null)[] = [null, { bad: 0, upTo: 0 }, { bad: 0, upTo: 7 }, { bad: 0, upTo: 12 }, { bad: 8, upTo: 5 }, { bad: 8, upTo: 8 }];

describe("verify run", () => {
  test("T1: seqTone", () => {
    expect(runs.map((r) => [2, 7, 9, 12].map((s) => seqTone(s, r)))).toEqual([
      ["idle", "idle", "idle", "idle"],
      ["idle", "idle", "idle", "idle"],
      ["ok", "ok", "idle", "idle"],
      ["ok", "ok", "ok", "ok"],
      ["ok", "idle", "idle", "idle"],
      ["ok", "ok", "bad", "bad"],
    ]);
  });

  test("T2: chainStatus", () => {
    expect(runs.map((r) => chainStatus(12, "00000012", r))).toEqual([
      { tone: "idle", title: "Case history", detail: "12 events. Last block 00000012." },
      { tone: "busy", title: "Checking event 1 of 12", detail: "" },
      { tone: "busy", title: "Checking event 8 of 12", detail: "" },
      { tone: "ok", title: "Chain verified. 12 events.", detail: "" },
      { tone: "busy", title: "Checking event 6 of 12", detail: "" },
      { tone: "bad", title: "Event 8 changed after it was written.", detail: "" },
    ]);
  });
});

describe("verify client", () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  function stubFetch(status: number, body: unknown) {
    seen.length = 0;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return Promise.resolve({ ok: status < 400, status, json: async () => body });
    });
  }
  afterEach(() => vi.unstubAllGlobals());

  test("C1: verifyCase reads the route with no user header", async () => {
    stubFetch(200, { verify: 8 });
    await expect(verifyCase("c 1")).resolves.toBe(8);
    expect(seen[0]!.url).toBe("/api/cases/c%201/verify");
    expect((seen[0]!.init?.headers as Record<string, string> | undefined)?.["X-Zotra-User"]).toBeUndefined();
  });

  test("C2: an unknown case rejects as ApiError", async () => {
    stubFetch(404, { error: { code: "not_found", message: "no case c1", details: [] } });
    const err: unknown = await verifyCase("c1").then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe("not_found");
  });
});

const count = (html: string, s: string) => html.split(s).length - 1;
function strip(over: { run?: VerifyRun | null; error?: string | null; busy?: boolean } = {}): string {
  return renderToString(
    createElement(ChainStrip, {
      reference: "CASE-2026-0001",
      blocks: chainBlocks(def, base, st()),
      ghosts: ghostLabels(def, st(), 4),
      run: over.run ?? null,
      n: 12,
      error: over.error ?? null,
      busy: over.busy ?? false,
      onVerify: () => {},
    }),
  );
}

describe("chain strip", () => {
  test("S1: the idle strip", () => {
    const html = strip();
    for (const text of [
      'aria-label="Case history"',
      "Case history",
      "12 events. Last block ",
      ">00000012<",
      "Credit analysis",
      'title="Application entry. Events #3-7. Hash 00000007. Previous 00000002."',
      'data-kind="cur"',
      "Verify chain",
    ]) {
      expect(html).toContain(text);
    }
    expect(count(html, ">No block<")).toBe(5);
    expect(count(html, 'data-tone="idle"')).toBe(4);
    expect(html).not.toContain("Open full chain");
  });

  test("S2: a verified chain", () => {
    const html = strip({ run: { bad: 0, upTo: 12 } });
    expect(html).toContain("Chain verified. 12 events.");
    expect(count(html, 'data-tone="ok"')).toBe(4);
  });

  test("S3: a changed event", () => {
    const html = strip({ run: { bad: 8, upTo: 8 } });
    expect(html).toContain("Event 8 changed after it was written.");
    expect(count(html, 'data-tone="bad"')).toBe(2);
    expect(count(html, 'data-tone="ok"')).toBe(2);
  });

  test("S4: the walk in progress", () => {
    expect(strip({ run: { bad: 0, upTo: 7 } })).toContain("Checking event 8 of 12");
  });

  test("S5: a failed check", () => {
    expect(strip({ error: "no case c1" })).toContain("The chain check did not run: no case c1");
  });

  test("S6: a busy strip disables the button", () => {
    expect(strip({ busy: true })).toMatch(/<button type="button" aria-keyshortcuts="V" disabled=""/);
  });
});
