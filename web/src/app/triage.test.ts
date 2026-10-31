// The triage model test rows, in order.

import { afterEach, describe, expect, test, vi } from "vitest";
import seedJson from "../../../internal/store/seed/example-process.json";
import type { CaseEvent, CaseState, CommandInput } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import { ApiError } from "../studio/api";
import { fetchChecks, type CheckResult } from "./app-api";
import {
  decisionLabel,
  docConsequence,
  docStep,
  documentRows,
  dueText,
  editableTarget,
  enteredAt,
  firstDocIndex,
  keyFigures,
  leftStep,
  lockReason,
  msLeft,
  queueOrder,
  receivedText,
  sendCommands,
  sendDecision,
  sendResultText,
  shareOfIncome,
  startIndex,
  triageAction,
  zoneText,
} from "./triage";

const def = seedJson as ProcessDefinition;
const node = (id: string) => def.nodes.find((n) => n.id === id)!;
const ev = (seq: number, type: string, at: string, payload: Record<string, unknown>): CaseEvent => ({
  case_id: "c1", seq, type, at, actor: "system", payload, prev_hash: "", hash: "",
});
const events = [
  ev(1, "case_created", "2026-10-28T08:00:00Z", {}),
  ev(2, "step_entered", "2026-10-28T08:00:00Z", { node_id: "entry" }),
  ev(3, "step_entered", "2026-10-29T09:00:00Z", { node_id: "complete" }),
  ev(4, "step_entered", "2026-10-29T09:00:00Z", { node_id: "analysis" }),
  ev(5, "step_entered", "2026-10-30T09:00:00Z", { node_id: "decision" }),
  ev(6, "step_entered", "2026-10-30T10:00:00Z", { node_id: "analysis" }),
];
const now = Date.parse("2026-10-31T17:00:00Z");
const data = {
  client_name: "Hery Rasolofo", profession: "Civil engineer", amount: 180000, duration_months: 240,
  down_payment: 36000, annual_rate: 0.035, monthly_income: 5200, monthly_payment: 1043.9274923695693,
  debt_ratio: 0.20075528699414794,
};
const state = (over: Partial<CaseState> = {}): CaseState => ({
  case_id: "c1", version_id: "v1", status: "open", result: "", node_id: "analysis", assignee: "", data,
  sources: { blacklist: { listed: false }, existing_loans: { monthly_total: 420 } },
  seq: 12, prev_hash: "", ...over,
});
const doc = (id: string, name: string) => ({
  id, case_id: "c1", name, mime: "image/png", sha256: "", created_at: "2026-10-28T08:00:00Z",
});
const ok: CheckResult[] = node("analysis").checks.map((c) => ({
  id: c.id, message: c.message, expression: c.expression, passed: true, error: null,
}));

describe("triage model", () => {
  test("A1: enteredAt gives the last entry into the node", () => {
    expect(enteredAt(events, "analysis")).toBe("2026-10-30T10:00:00Z");
    expect(enteredAt(events, "offer")).toBeNull();
  });

  test("A2: msLeft", () => {
    expect(msLeft("2026-10-30T10:00:00Z", 48, now)).toBe(61200000);
    expect(msLeft(null, 48, now)).toBeNull();
    expect(msLeft("2026-10-30T10:00:00Z", null, now)).toBeNull();
  });

  test("A3: dueText", () => {
    expect(dueText(61200000)).toEqual({ text: "17 h left", tone: "warn" });
    expect(dueText(86400000)).toEqual({ text: "24 h left", tone: "ok" });
    expect(dueText(0)).toEqual({ text: "0 h left", tone: "warn" });
    expect(dueText(-1)).toEqual({ text: "Late by 1 h", tone: "late" });
    expect(dueText(-10800000)).toEqual({ text: "Late by 3 h", tone: "late" });
    expect(dueText(null)).toBeNull();
  });

  test("A4: receivedText", () => {
    expect(receivedText("2026-10-30T10:00:00Z", now)).toBe("Received 31 h ago");
    expect(receivedText("2026-10-31T16:30:00Z", now)).toBe("Received less than 1 h ago");
  });

  test("A5: queueOrder puts late first and no deadline last", () => {
    expect(
      queueOrder([
        { id: "a", reference: "CASE-2026-0005", created_at: "2026-10-30T10:00:00Z", msLeft: 61200000 },
        { id: "b", reference: "CASE-2026-0004", created_at: "2026-10-30T11:00:00Z", msLeft: -10800000 },
        { id: "c", reference: "CASE-2026-0001", created_at: "2026-10-28T08:00:00Z", msLeft: null },
        { id: "d", reference: "CASE-2026-0006", created_at: "2026-10-29T10:00:00Z", msLeft: 61200000 },
        { id: "e", reference: "CASE-2026-0003", created_at: "2026-10-30T10:00:00Z", msLeft: 61200000 },
      ]),
    ).toEqual(["b", "d", "e", "a", "c"]);
  });

  test("A6: keyFigures gives the money fields, then the sources", () => {
    expect(keyFigures(def, node("analysis"), state())).toEqual([
      { label: "Down payment", value: "€36,000.00", source: false },
      { label: "Monthly income", value: "€5,200.00", source: false },
      { label: "Monthly payment", value: "€1,043.93", source: false },
      { label: "Existing loans", value: "€420.00", source: true },
    ]);
  });

  test("A7: keyFigures with no sources", () => {
    expect(keyFigures(def, node("analysis"), state({ sources: null })).map((f) => f.label)).toEqual([
      "Down payment", "Monthly income", "Monthly payment",
    ]);
  });

  test("A8: keyFigures skips a hidden field", () => {
    const analysis = { ...node("analysis"), scope_overrides: [{ field: "down_payment", role: "analyst", access: "hidden" as const }] };
    const hidden = { ...def, nodes: def.nodes.map((n) => (n.id === "analysis" ? analysis : n)) };
    expect(keyFigures(hidden, analysis, state()).map((f) => f.label)).toEqual([
      "Monthly income", "Monthly payment", "Existing loans",
    ]);
  });

  test("A9: shareOfIncome", () => {
    expect(shareOfIncome(state())).toBeCloseTo(0.2815245177633787, 12);
    expect(shareOfIncome(state({ sources: null }))).toBeNull();
    expect(shareOfIncome(state({ data: { ...data, monthly_income: 0 } }))).toBeNull();
  });

  test("A10: documentRows of the node path against the scans", () => {
    const id = doc("d1", "ID card.png");
    const slips = doc("d2", "Salary slips.png");
    const title = doc("d3", "Property title.pdf");
    expect(documentRows(def, events, "analysis", [id, slips, title])).toEqual([
      { name: "ID card", scan: id },
      { name: "Salary slips", scan: slips },
      { name: "Bank statements", scan: null },
      { name: "Property title", scan: title },
    ]);
  });

  test("A11: documentRows with no event and no scan", () => {
    expect(documentRows(def, [], "analysis", [])).toEqual([]);
  });

  test("A12: decisionLabel", () => {
    expect(decisionLabel("favorable")).toBe("Favorable");
    expect(decisionLabel("approve")).toBe("Approve");
    expect(decisionLabel("")).toBe("");
  });
});

describe("lock rule", () => {
  const base = {
    node: node("analysis"), state: state(), userId: "u-analyst", assigneeName: "Demo Analyst 2",
    docs: [], events, checks: ok, checksError: null,
  };
  const offerDocs = [doc("d1", "Loan offer.pdf"), doc("d2", "Mortgage deed.pdf")];

  test("L1: the case is taken by another user", () => {
    expect(lockReason({ ...base, state: state({ assignee: "u-other" }) })).toBe(
      "F and U are locked. The case is taken by Demo Analyst 2.",
    );
  });

  test("L2: the checks did not load", () => {
    expect(lockReason({ ...base, checksError: "HTTP 500" })).toBe(
      "F and U are locked. The checks did not load: HTTP 500",
    );
  });

  test("L3: checks or documents still load", () => {
    expect(lockReason({ ...base, checks: null })).toBe("F and U are locked. Loading the checks.");
    expect(lockReason({ ...base, docs: null })).toBe("F and U are locked. Loading the checks.");
  });

  test("L4: a required document is missing", () => {
    expect(lockReason({ ...base, node: node("offer"), docs: [doc("d1", "Loan offer.pdf")] })).toBe(
      "F and U are locked. Missing document: Mortgage deed.",
    );
  });

  test("L5: the step needs a signature", () => {
    expect(lockReason({ ...base, node: node("offer"), docs: offerDocs })).toBe(
      "F and U are locked. The step needs a signature on the case screen.",
    );
  });

  test("L6: a signed step is not locked", () => {
    const signed = [...events, ev(7, "signature_added", "2026-10-31T10:00:00Z", { node_id: "offer" })];
    expect(
      lockReason({ ...base, node: node("offer"), state: state({ node_id: "offer" }), docs: offerDocs, events: signed }),
    ).toBeNull();
  });

  test("L7: the first failed check locks", () => {
    const checks = [ok[0]!, { ...ok[1]!, passed: false }, { ...ok[2]!, passed: false }];
    expect(lockReason({ ...base, checks })).toBe(
      "F and U are locked. The rule analysis-blacklist fails. The client is on the credit blacklist.",
    );
  });

  test("L8: a check with an error locks", () => {
    const checks = [{ ...ok[0]!, passed: false, error: "no such key: listed" }];
    expect(lockReason({ ...base, checks })).toBe(
      "F and U are locked. The rule analysis-debt-ratio has an error: no such key: listed",
    );
  });

  test("L9: all checks pass", () => {
    expect(lockReason(base)).toBeNull();
    expect(lockReason({ ...base, state: state({ assignee: "u-analyst" }) })).toBeNull();
  });
});

describe("send", () => {
  test("S1: take, submit, decide", () => {
    expect(sendCommands(def, node("analysis"), state(), [], "favorable")).toEqual([
      { type: "take" }, { type: "submit", values: {} }, { type: "decide", decision: "favorable" },
    ]);
  });

  test("S2: the analyst cannot write the documents", () => {
    const cmds = sendCommands(def, node("analysis"), state({ assignee: "u-analyst" }), [doc("d1", "ID card.png")], "unfavorable");
    expect(cmds).toEqual([{ type: "submit", values: {} }, { type: "decide", decision: "unfavorable" }]);
  });

  const entry = state({ node_id: "entry", assignee: "u-advisor", data: { client_name: "X" } });

  test("S3: the entry step submits the scan ids", () => {
    const cmds = sendCommands(def, node("entry"), entry, [doc("d1", "ID card.png"), doc("d2", "Salary slips.png")], "x");
    expect(cmds).toEqual([{ type: "submit", values: { documents: ["d1", "d2"] } }, { type: "decide", decision: "x" }]);
  });

  test("S4: no scan, no documents value", () => {
    expect(sendCommands(def, node("entry"), entry, [], "x")).toEqual([
      { type: "submit", values: {} }, { type: "decide", decision: "x" },
    ]);
  });

  const calls: string[] = [];
  const run = async (c: string, u: string, cmd: CommandInput) => {
    calls.push(`${c}:${u}:${cmd.type}`);
    if (calls.length === 2 && cmd.type === "start") throw new Error("boom");
    return { events: [ev(calls.length, cmd.type, "2026-10-31T10:00:00Z", {})], state: state({ seq: calls.length }) };
  };

  test("S5: sendDecision runs each command in order", async () => {
    calls.length = 0;
    const answer = await sendDecision("c1", "u-analyst", sendCommands(def, node("analysis"), state(), [], "favorable"), run);
    expect(calls).toEqual(["c1:u-analyst:take", "c1:u-analyst:submit", "c1:u-analyst:decide"]);
    expect(answer.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(answer.state.seq).toBe(3);
  });

  test("S6: a rejection stops the run", async () => {
    calls.length = 0;
    const cmds: CommandInput[] = [{ type: "take" }, { type: "start" }, { type: "decide", decision: "x" }];
    await expect(sendDecision("c1", "u1", cmds, run)).rejects.toThrow("boom");
    expect(calls).toHaveLength(2);
  });

  const answer = (types: [string, Record<string, unknown>][], st: Partial<CaseState>) => ({
    events: types.map(([t, p], i) => ev(i + 1, t, "2026-10-31T10:00:00Z", p)),
    state: state(st),
  });

  test("R1: the case goes to the next step", () => {
    const a = answer(
      [["check_evaluated", { check_id: "analysis-debt-ratio", result: true }], ["decision_made", { decision: "favorable" }], ["step_entered", { node_id: "offer" }]],
      { node_id: "offer" },
    );
    expect(sendResultText(a, def, "Favorable")).toEqual({ ok: true, text: "Favorable sent. Next step by rule: Loan offer." });
  });

  test("R2: the case closes", () => {
    const a = answer([["decision_made", { decision: "unfavorable" }]], { status: "closed", result: "refused", node_id: "refused" });
    expect(sendResultText(a, def, "Unfavorable")).toEqual({ ok: true, text: "Unfavorable sent. The case is closed: refused." });
  });

  test("R3: a failed check", () => {
    const a = answer([["check_evaluated", { check_id: "analysis-debt-ratio", result: false }]], {});
    expect(sendResultText(a, def, "Favorable")).toEqual({
      ok: false,
      text: "Check analysis-debt-ratio failed: The debt ratio must stay at 0.33, or the comment must explain the exception.",
    });
  });

  test("R4: a failed check that the process does not know", () => {
    const a = answer([["check_evaluated", { check_id: "zzz", result: false }]], {});
    expect(sendResultText(a, def, "Favorable")).toEqual({ ok: false, text: "Check zzz failed: zzz" });
  });
});

describe("keys", () => {
  test("K1: the key map", () => {
    expect(["k", "K", "j", "J", "f", "F", "u", "U", "Escape", "d", "D", "t"].map((k) => triageAction(k, false, false))).toEqual([
      "prev", "prev", "next", "next", "first", "first", "second", "second", "exit", "docs", "docs", null,
    ]);
    expect(triageAction("d", true, false)).toBeNull();
    expect(triageAction("d", false, true)).toBeNull();
  });

  test("K2: a modifier or an editable target gives null", () => {
    expect(triageAction("j", true, false)).toBeNull();
    expect(triageAction("j", false, true)).toBeNull();
    expect(triageAction("Escape", false, true)).toBeNull();
  });

  test("K3: editableTarget", () => {
    const targets = [
      { tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true }, { tagName: "BUTTON" }, null,
    ];
    expect(targets.map(editableTarget)).toEqual([true, true, true, true, false, false]);
  });
});

describe("open the case", () => {
  test("O1: key O opens the case", () => {
    expect([triageAction("o", false, false), triageAction("O", false, false)]).toEqual(["open", "open"]);
    expect(triageAction("o", true, false)).toBeNull();
    expect(triageAction("o", false, true)).toBeNull();
  });

  test("O2: startIndex", () => {
    expect(startIndex(["c1", "c2", "c3"], ["c2", "c3"])).toBe(1);
    expect(startIndex(["c2", "c3"], ["c1", "c2", "c3"])).toBe(0);
    expect(startIndex(["c1", "c2", "c3"], ["x", "c3"])).toBe(2);
    expect(startIndex(["c1", "c2"], ["x"])).toBe(0);
    expect(startIndex(["c1", "c2"], [])).toBe(0);
  });

  test("O3: leftStep", () => {
    const st = (node_id: string, status: CaseState["status"]): CaseState => ({
      case_id: "c1", version_id: "v1", status, result: "", node_id, assignee: "", data: {},
      sources: null, seq: 1, prev_hash: "",
    });
    expect(leftStep(st("analysis", "open"), st("decision", "open"))).toBe(true);
    expect(leftStep(st("end", "open"), st("end", "closed"))).toBe(true);
    expect(leftStep(st("analysis", "open"), st("analysis", "open"))).toBe(false);
    expect(leftStep(st("end", "closed"), st("end", "closed"))).toBe(false);
  });
});

describe("documents dialog", () => {
  const idDoc = doc("d1", "ID card.png");
  const missing = { name: "ID card", scan: null };
  const signed = (nodeId: string) => [ev(7, "signature_added", "2026-10-31T09:00:00Z", { node_id: nodeId })];

  test("G1: firstDocIndex", () => {
    expect(firstDocIndex([])).toBeNull();
    expect(firstDocIndex([{ name: "A", scan: idDoc }, { name: "B", scan: idDoc }])).toBe(0);
    expect(firstDocIndex([{ name: "A", scan: idDoc }, { name: "B", scan: null }])).toBe(1);
  });

  test("G2: docStep", () => {
    expect([
      docStep("ArrowDown", 0, 3), docStep("ArrowRight", 2, 3), docStep("ArrowUp", 0, 3),
      docStep("ArrowLeft", 2, 3), docStep("Enter", 1, 3), docStep("ArrowDown", 0, 0),
    ]).toEqual([1, 2, 0, 1, null, null]);
  });

  test("G3: zoneText", () => {
    expect(zoneText({ label: "signature", box: { x: 52, y: 436, width: 236, height: 84 } })).toEqual({
      title: "Signature found",
      detail: "signature · x 52 y 436 · 236 × 84 px",
    });
  });

  test("G4: a missing required document blocks the step", () => {
    expect(docConsequence(missing, node("entry"), [])).toEqual({
      tone: "bad",
      title: "The step cannot close until ID card is attached.",
      detail: "The process requires ID card at the step Application entry.",
    });
  });

  test("G5: a missing document of another step", () => {
    expect(docConsequence(missing, node("analysis"), [])).toEqual({
      tone: "none",
      title: "This document is missing.",
      detail: "The step Credit analysis does not require it.",
    });
  });

  test("G6: an unsigned step", () => {
    expect(docConsequence({ name: "ID card", scan: idDoc }, node("decision"), [])).toEqual({
      tone: "bad",
      title: "The step cannot close until it is signed.",
      detail:
        "The process requires a signature at the step Credit decision. Sign a scan with a signature zone on the case screen.",
    });
  });

  test("G7: a signed step passes", () => {
    expect(docConsequence({ name: "ID card", scan: idDoc }, node("decision"), signed("decision"))).toEqual({
      tone: "ok",
      title: "This document passes the check.",
      detail: "No blocker for the step Credit decision.",
    });
  });

  test("G8: the signature of another step does not count", () => {
    expect(docConsequence({ name: "ID card", scan: idDoc }, node("decision"), signed("entry")).tone).toBe("bad");
  });
});

describe("checks client", () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  function stubFetch(status: number, body: unknown) {
    seen.length = 0;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return Promise.resolve({ ok: status < 400, status, json: async () => body });
    });
  }
  afterEach(() => vi.unstubAllGlobals());

  test("C1: fetchChecks reads the route with no user header", async () => {
    const body = { node_id: "analysis", checks: ok };
    stubFetch(200, body);
    await expect(fetchChecks("c 1")).resolves.toEqual(body);
    expect(seen[0]!.url).toBe("/api/cases/c%201/checks");
    expect((seen[0]!.init?.headers as Record<string, string> | undefined)?.["X-Zotra-User"]).toBeUndefined();
  });

  test("C2: a refusal rejects as ApiError", async () => {
    stubFetch(409, { error: { code: "not_a_task", message: "the case is not on a task", details: [] } });
    const err: unknown = await fetchChecks("c1").then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).code).toBe("not_a_task");
  });
});
