// Pure model of the triage deck: queue order, deadline texts, key
// figures, document rows, lock rule, the commands of a decision and
// their result text, and the key map.

import type { CaseEvent, CaseState, CommandInput, runCommand } from "../studio/case-api";
import type { DocumentDTO, ZoneDTO } from "../studio/doc-api";
import type { ProcessDefinition, ProcessNode } from "../studio/types";
import { documentProvides } from "../studio/StepDocuments";
import { accessOf } from "../studio/StepScreen";
import { valueText } from "../studio/format";
import { pickField } from "./InboxScreen";
import type { CheckResult } from "./app-api";

const H = 3_600_000;

// enteredAt gives the time of the last entry into the node.
export function enteredAt(events: CaseEvent[], nodeId: string): string | null {
  const hit = events.filter((e) => e.type === "step_entered" && e.payload.node_id === nodeId).at(-1);
  return hit?.at ?? null;
}

export function msLeft(entered: string | null, deadlineHours: number | null, now: number): number | null {
  if (entered === null || deadlineHours === null) return null;
  return Date.parse(entered) + deadlineHours * H - now;
}

export function dueText(ms: number | null): { text: string; tone: "ok" | "warn" | "late" } | null {
  if (ms === null) return null;
  if (ms < 0) return { text: `Late by ${Math.ceil(-ms / H)} h`, tone: "late" };
  const h = Math.floor(ms / H);
  return { text: `${h} h left`, tone: h >= 24 ? "ok" : "warn" };
}

export function receivedText(createdAt: string, now: number): string {
  const h = Math.floor((now - Date.parse(createdAt)) / H);
  return h < 1 ? "Received less than 1 h ago" : `Received ${h} h ago`;
}

export interface QueueRow {
  id: string;
  reference: string;
  created_at: string;
  msLeft: number | null;
}

// queueOrder puts the most urgent case first. A case with no deadline
// goes last.
export function queueOrder(rows: QueueRow[]): string[] {
  return [...rows]
    .sort(
      (a, b) =>
        (a.msLeft === null ? 1 : 0) - (b.msLeft === null ? 1 : 0) ||
        (a.msLeft ?? 0) - (b.msLeft ?? 0) ||
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        a.reference.localeCompare(b.reference),
    )
    .map((r) => r.id);
}

// keyFigures gives the money fields (except the header amount) and the
// number values of the sources, 4 at most.
export function keyFigures(
  def: ProcessDefinition,
  node: ProcessNode,
  state: CaseState,
): { label: string; value: string; source: boolean }[] {
  const amount = pickField(def, "money");
  const out: { label: string; value: string; source: boolean }[] = [];
  for (const f of def.fields) {
    const v = state.data[f.name];
    if (f.type === "money" && f !== amount && typeof v === "number" && accessOf(f, node, def) !== "hidden") {
      out.push({ label: f.label, value: valueText(f, v, def.currency), source: false });
    }
  }
  for (const s of def.sources) {
    for (const [name, v] of Object.entries(state.sources?.[s.id] ?? {})) {
      if (typeof v === "number") {
        const field = { name, label: s.name, type: "money" as const, options: [], computed: null };
        out.push({ label: s.name, value: valueText(field, v, def.currency), source: true });
      }
    }
  }
  return out.slice(0, 4);
}

export const SHARE_LIMIT = 0.33;

// shortcut: the field and source names and SHARE_LIMIT are the seed
// policy; read them from the check when a process sets other names.
export function shareOfIncome(state: CaseState): number | null {
  const income = state.data.monthly_income;
  const payment = state.data.monthly_payment;
  const loans = state.sources?.existing_loans?.monthly_total;
  if (typeof income !== "number" || income <= 0) return null;
  if (typeof payment !== "number" || typeof loans !== "number") return null;
  return (loans + payment) / income;
}

export interface DocRow {
  name: string;
  scan: DocumentDTO | null;
}

// documentRows lists the required documents of the node path, each
// with the first scan that provides it.
export function documentRows(
  def: ProcessDefinition,
  events: CaseEvent[],
  nodeId: string,
  docs: DocumentDTO[],
): DocRow[] {
  const ids = [...events.filter((e) => e.type === "step_entered").map((e) => String(e.payload.node_id)), nodeId];
  const names = [...new Set(ids.flatMap((id) => def.nodes.find((n) => n.id === id)?.documents ?? []))];
  return names.map((name) => ({ name, scan: docs.find((d) => documentProvides(d.name, name)) ?? null }));
}

// firstDocIndex gives the row that D opens: the first missing
// document, else the first row.
export function firstDocIndex(rows: DocRow[]): number | null {
  if (rows.length === 0) return null;
  const missing = rows.findIndex((r) => r.scan === null);
  return missing === -1 ? 0 : missing;
}

// docStep gives the new row of an arrow key in the document dialog.
export function docStep(key: string, index: number, n: number): number | null {
  if (n === 0) return null;
  if (key === "ArrowUp" || key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowDown" || key === "ArrowRight") return Math.min(n - 1, index + 1);
  return null;
}

export function zoneText(z: ZoneDTO): { title: string; detail: string } {
  const { x, y, width, height } = z.box;
  return {
    title: `${z.label.charAt(0).toUpperCase()}${z.label.slice(1)} found`,
    detail: `${z.label} · x ${x} y ${y} · ${width} × ${height} px`,
  };
}

// docConsequence gives what one document means for the step. It names
// only the rules that exist: the required documents and the signature
// of the node. The first match wins.
export function docConsequence(
  row: DocRow,
  node: ProcessNode,
  events: CaseEvent[],
): { tone: "ok" | "bad" | "none"; title: string; detail: string } {
  if (row.scan === null && node.documents.includes(row.name)) {
    return {
      tone: "bad",
      title: `The step cannot close until ${row.name} is attached.`,
      detail: `The process requires ${row.name} at the step ${node.name}.`,
    };
  }
  if (row.scan === null) {
    return { tone: "none", title: "This document is missing.", detail: `The step ${node.name} does not require it.` };
  }
  const signed = events.some((e) => e.type === "signature_added" && e.payload.node_id === node.id);
  if (node.signature && !signed) {
    return {
      tone: "bad",
      title: "The step cannot close until it is signed.",
      detail: `The process requires a signature at the step ${node.name}. Sign a scan with a signature zone on the case screen.`,
    };
  }
  return { tone: "ok", title: "This document passes the check.", detail: `No blocker for the step ${node.name}.` };
}

export function decisionLabel(decision: string): string {
  return decision.charAt(0).toUpperCase() + decision.slice(1);
}

// lockReason gives the reason why F and U are locked, or null. The
// first match wins.
export function lockReason(input: {
  node: ProcessNode;
  state: CaseState;
  userId: string;
  assigneeName: string;
  docs: DocumentDTO[] | null;
  events: CaseEvent[];
  checks: CheckResult[] | null;
  checksError: string | null;
}): string | null {
  const { node, state, docs, checks } = input;
  const locked = "F and U are locked.";
  if (state.assignee !== "" && state.assignee !== input.userId) {
    return `${locked} The case is taken by ${input.assigneeName}.`;
  }
  if (input.checksError !== null) return `${locked} The checks did not load: ${input.checksError}`;
  if (docs === null || checks === null) return `${locked} Loading the checks.`;
  const missing = node.documents.filter((name) => !docs.some((d) => documentProvides(d.name, name)));
  if (missing.length > 0) return `${locked} Missing document: ${missing.join(", ")}.`;
  const signed = input.events.some((e) => e.type === "signature_added" && e.payload.node_id === state.node_id);
  if (node.signature && !signed) return `${locked} The step needs a signature on the case screen.`;
  const bad = checks.find((c) => c.error !== null || !c.passed);
  if (bad === undefined) return null;
  if (bad.error !== null) return `${locked} The rule ${bad.id} has an error: ${bad.error}`;
  return `${locked} The rule ${bad.id} fails. ${bad.message}`;
}

// sendCommands gives the commands of the case screen for one decision:
// take if nobody has the case, submit, then decide.
export function sendCommands(
  def: ProcessDefinition,
  node: ProcessNode,
  state: CaseState,
  docs: DocumentDTO[],
  decision: string,
): CommandInput[] {
  const values: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (
      f.type === "document" &&
      f.computed === null &&
      accessOf(f, node, def) === "write" &&
      state.data[f.name] === undefined &&
      docs.length > 0
    ) {
      values[f.name] = docs.map((d) => d.id);
    }
  }
  const take: CommandInput[] = state.assignee === "" ? [{ type: "take" }] : [];
  return [...take, { type: "submit", values }, { type: "decide", decision }];
}

type Answer = { events: CaseEvent[]; state: CaseState };

// sendDecision runs the commands in order. A rejection stops the run.
export async function sendDecision(
  caseId: string,
  userId: string,
  cmds: CommandInput[],
  run: typeof runCommand,
): Promise<Answer> {
  const events: CaseEvent[] = [];
  let state: CaseState | null = null;
  for (const cmd of cmds) {
    const answer = await run(caseId, userId, cmd);
    events.push(...answer.events);
    state = answer.state;
  }
  return { events, state: state! };
}

export function sendResultText(answer: Answer, def: ProcessDefinition, label: string): { ok: boolean; text: string } {
  const { state } = answer;
  if (answer.events.some((e) => e.type === "decision_made")) {
    if (state.status === "closed") {
      return { ok: true, text: `${label} sent. The case is closed: ${state.result}.` };
    }
    const name = def.nodes.find((n) => n.id === state.node_id)?.name ?? state.node_id;
    return { ok: true, text: `${label} sent. Next step by rule: ${name}.` };
  }
  const bad = answer.events.find((e) => e.type === "check_evaluated" && e.payload.result === false);
  const id = String(bad?.payload.check_id ?? "");
  const message = def.nodes.flatMap((n) => n.checks).find((c) => c.id === id)?.message ?? id;
  return { ok: false, text: `Check ${id} failed: ${message}` };
}

const KEYS: Record<string, "prev" | "next" | "first" | "second" | "docs"> = {
  k: "prev",
  j: "next",
  f: "first",
  u: "second",
  d: "docs",
};

export function triageAction(
  key: string,
  modified: boolean,
  editable: boolean,
): "prev" | "next" | "first" | "second" | "docs" | "exit" | null {
  if (modified || editable) return null;
  if (key === "Escape") return "exit";
  return key.length === 1 ? (KEYS[key.toLowerCase()] ?? null) : null;
}

export function editableTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (target === null) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? "") || target.isContentEditable === true;
}
