// The chain strip test rows B1 to B5, G1 to G3, T1, T2, C1, C2, S1 to
// S6, N1 to N3, A1, A2, G5, G6, S7 to S10, P1 and P2 of the stamp, P1 to P3 of
// the sheet progress, H1 to H7, and F1 and F2 of the dialog focus. The
// environment is node: renderToString for the strip.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import seedJson from "../../../internal/store/seed/example-process.json";
import { ApiError } from "../studio/api";
import { focusContent } from "../ui/dialog";
import type { CaseEvent, CaseState } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import { verifyCase } from "./app-api";
import { ChainSheetBody, ChainStrip, SignedStamp } from "./CaseChain";
import {
  appendBlock,
  blockText,
  chainBlocks,
  chainStatus,
  ghostLabels,
  newBlock,
  seqTone,
  sheetProgress,
  type VerifyRun,
} from "./chain";

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

// The events of the command answer of a send (as in row B2).
const answer = [
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
      onOpen: () => {},
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
    expect(html).toContain("Open full chain");
    expect(html).toContain('aria-label="Open the full chain of CASE-2026-0001"');
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

describe("new block", () => {
  const n1 = newBlock(answer, "Favorable");
  const b1 = chainBlocks(def, base, st());
  const after = st({ node_id: "decision", seq: 22 });

  test("N1: one block for the answer events", () => {
    expect(n1).toEqual({ label: "Decision · Favorable", from: 13, to: 22, hash: "00000022", prev: "00000012", kind: "new" });
  });

  test("N2: no event gives no block", () => {
    expect(newBlock([], "Favorable")).toBeNull();
  });

  test("N3: the block text", () => {
    expect(blockText(n1!)).toBe("Block #13-22 signed: 00000022, previous 00000012.");
  });

  test("A1: the current block becomes a passed step", () => {
    expect(appendBlock(b1, n1).map((b) => [b.label, b.from, b.to, b.kind])).toEqual([
      ["Application received", 1, 2, "step"],
      ["Application entry", 3, 7, "step"],
      ["File complete?", 8, 9, "rule"],
      ["Credit analysis", 10, 12, "step"],
      ["Decision · Favorable", 13, 22, "new"],
    ]);
  });

  test("A2: no block gives the same array", () => {
    expect(appendBlock(b1, null)).toBe(b1);
  });

  test("G5: the ghosts after the new block", () => {
    expect(ghostLabels(def, after, 6)).toEqual(["Loan offer", "Client signature at the branch", "Release of funds"]);
  });

  test("G6: a closed case has no ghost after the new block", () => {
    expect(ghostLabels(def, st({ status: "closed", result: "refused", node_id: "refused" }), 6)).toEqual([]);
  });

  function sent(run: VerifyRun | null): string {
    return renderToString(
      createElement(ChainStrip, {
        reference: "CASE-2026-0001",
        blocks: appendBlock(b1, n1),
        ghosts: ghostLabels(def, after, 6),
        run,
        n: 22,
        error: null,
        busy: false,
        onVerify: () => {},
        onOpen: () => {},
      }),
    );
  }

  test("S7: the new block locks with its hash", () => {
    const html = sent(null);
    for (const text of [
      "22 events. Last block ",
      "Decision · Favorable",
      " prev 00000012",
      'title="Your decision. Events #13-22. Hash 00000022. Previous 00000012."',
      "flex-[2.3_1_0%]",
      "top-[5px]",
    ]) {
      expect(html).toContain(text);
    }
    expect(count(html, 'data-tone="ok"')).toBe(1);
    expect(count(html, 'data-tone="idle"')).toBe(4);
    expect(count(html, ">No block<")).toBe(3);
    expect(html).not.toContain('data-kind="cur"');
  });

  test("S8: a verified chain after a send", () => {
    const html = sent({ bad: 0, upTo: 22 });
    expect(html).toContain("Chain verified. 22 events.");
    expect(count(html, 'data-tone="ok"')).toBe(5);
  });

  test("S9: a changed event before the new block", () => {
    const html = sent({ bad: 8, upTo: 8 });
    expect(html).toContain("Event 8 changed after it was written.");
    expect(count(html, 'data-tone="bad"')).toBe(3);
    expect(count(html, 'data-tone="ok"')).toBe(2);
  });

  test("S10: the walk in progress", () => {
    const html = sent({ bad: 0, upTo: 12 });
    expect(html).toContain("Checking event 13 of 22");
    expect(count(html, 'data-tone="ok"')).toBe(4);
    expect(count(html, 'data-tone="idle"')).toBe(1);
  });
});

describe("signed stamp", () => {
  test("P1: the first decision", () => {
    const html = renderToString(createElement(SignedStamp, { label: "Favorable", first: true }));
    expect(html).toContain("Signed · Favorable");
    expect(html).toContain("text-primary");
    expect(html).not.toContain("text-red-700");
  });

  test("P2: another decision", () => {
    const html = renderToString(createElement(SignedStamp, { label: "Unfavorable", first: false }));
    expect(html).toContain("Signed · Unfavorable");
    expect(html).toContain("text-red-700");
  });
});

describe("sheet progress", () => {
  test("P1: the count and the width of a 12 event walk", () => {
    const runs: (VerifyRun | null)[] = [
      null,
      { bad: 0, upTo: 0 },
      { bad: 0, upTo: 6 },
      { bad: 0, upTo: 12 },
      { bad: 4, upTo: 3 },
      { bad: 4, upTo: 4 },
    ];
    expect(runs.map((r) => sheetProgress(12, r))).toEqual([
      { done: 0, pct: 0 },
      { done: 0, pct: 0 },
      { done: 6, pct: 50 },
      { done: 12, pct: 100 },
      { done: 3, pct: 25 },
      { done: 3, pct: 25 },
    ]);
  });

  test("P2: a bad event stops the count before it", () => {
    const p = sheetProgress(12, { bad: 8, upTo: 8 });
    expect(p.done).toBe(7);
    expect(p.pct).toBeCloseTo(58.33, 2);
  });

  test("P3: no event gives a zero width", () => {
    expect(sheetProgress(0, null)).toEqual({ done: 0, pct: 0 });
    expect(sheetProgress(0, { bad: 0, upTo: 0 })).toEqual({ done: 0, pct: 0 });
  });
});

const U = [{ id: "u-advisor", name: "Fara Rakoto", role_ids: [] }];
const BUSY_V = /<button(?=[^>]*aria-keyshortcuts="V")(?=[^>]*disabled="")/;
function sheet(
  over: { events?: CaseEvent[]; firstNew?: number | null; run?: VerifyRun | null; error?: string | null; busy?: boolean } = {},
): string {
  return renderToString(
    createElement(ChainSheetBody, {
      reference: "CASE-2026-0001",
      client: "Hery Rasolofo",
      def,
      users: U,
      events: over.events ?? base,
      firstNew: over.firstNew ?? null,
      run: over.run ?? null,
      error: over.error ?? null,
      busy: over.busy ?? false,
      onVerify: () => {},
      onClose: () => {},
    }),
  );
}

describe("chain sheet", () => {
  test("H1: the idle sheet", () => {
    const html = sheet();
    for (const text of [
      "Case history",
      "CASE-2026-0001 · Hery Rasolofo",
      'aria-label="About the case history"',
      "Ready to check 12 events",
      "0 / 12",
      "width:0%",
      ">Esc<",
      "Close",
      "Verify chain",
      ">Event<",
      ">Actor<",
      ">Previous<",
      "Case created",
      'title="case_created"',
      "Assigned to Fara Rakoto",
      "Check 1 passed",
      "System",
      ">00000012<",
      ">00000000<",
      "sha256(prev_hash + &quot;\\n&quot; + event)",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Each event carries the hash");
    expect(html).not.toContain("append only");
    expect(count(html, "31 Oct, 10:00:00")).toBe(12);
    expect(count(html, 'data-tone="idle"')).toBe(12);
    expect(html).not.toContain("data-new");
    expect(html).not.toMatch(BUSY_V);
  });

  test("H2: a verified chain", () => {
    const html = sheet({ run: { bad: 0, upTo: 12 } });
    expect(html).toContain("Chain verified. 12 events.");
    expect(html).toContain("12 / 12");
    expect(html).toContain("width:100%");
    expect(count(html, 'data-tone="ok"')).toBe(12);
    expect(html).not.toContain('data-tone="idle"');
  });

  test("H3: the walk in progress", () => {
    const html = sheet({ run: { bad: 0, upTo: 6 } });
    expect(html).toContain("Checking event 7 of 12");
    expect(html).toContain("6 / 12");
    expect(html).toContain("width:50%");
    expect(count(html, 'data-tone="ok"')).toBe(6);
    expect(count(html, 'data-tone="idle"')).toBe(6);
  });

  test("H4: a changed event", () => {
    const html = sheet({ run: { bad: 8, upTo: 8 } });
    expect(html).toContain("Event 8 changed after it was written.");
    expect(html).toContain("7 / 12");
    expect(html).toContain("bg-red-600");
    expect(count(html, 'data-tone="ok"')).toBe(7);
    expect(count(html, 'data-tone="bad"')).toBe(5);
  });

  test("H5: a failed check", () => {
    const html = sheet({ error: "no case c1" });
    expect(html).toContain("The chain check did not run: no case c1");
    expect(html).toContain("0 / 12");
    expect(html).toContain("bg-red-600");
  });

  test("H6: the events of a send are new", () => {
    const html = sheet({ events: [...base, ...answer], firstNew: 13 });
    expect(html).toContain("Ready to check 22 events");
    expect(html).toContain("0 / 22");
    expect(count(html, 'data-new="true"')).toBe(10);
    expect(html).toContain("Decision favorable");
    expect(html).toContain("u-analyst");
  });

  test("H7: a busy sheet disables the button", () => {
    expect(sheet({ busy: true })).toMatch(BUSY_V);
  });
});

describe("focusContent", () => {
  test("F1: it stops the default focus and focuses the dialog content", () => {
    const preventDefault = vi.fn();
    const focus = vi.fn();
    focusContent({ preventDefault, currentTarget: { focus } } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  // Radix always sets currentTarget for onOpenAutoFocus: a null target is
  // outside the contract of the handler.
  test("F2: a null currentTarget throws a TypeError", () => {
    const e = { preventDefault: vi.fn(), currentTarget: null } as unknown as Event;
    expect(() => focusContent(e)).toThrow(TypeError);
  });
});
