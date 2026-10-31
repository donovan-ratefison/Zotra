// Pure model of the case header: the stepper of the case path and the
// deadline of the current step.

import type { CaseEvent, CaseState } from "../studio/case-api";
import type { ProcessDefinition, ProcessNode } from "../studio/types";
import { upcomingIds } from "../studio/TimelineBar";
import { dayTimeText } from "./InboxScreen";
import { dueText, enteredAt, msLeft } from "./triage";

const H = 3_600_000;

export type StepMark = "done" | "current" | "next";

export interface StepperItem {
  id: string;
  label: string;
  mark: StepMark;
}

// stepperOf gives the passed steps (the start node, then each entered
// node once, in event order), the current step, and the next steps of
// the shortest path to an approved end. A closed case has no current
// or next step.
export function stepperOf(def: ProcessDefinition, events: CaseEvent[], state: CaseState): StepperItem[] {
  const nameOf = new Map(def.nodes.map((n) => [n.id, n.name]));
  const passed = [
    def.nodes.find((n) => n.type === "start")?.id,
    ...events.filter((e) => e.type === "step_entered").map((e) => String(e.payload.node_id)),
  ];
  const ids: string[] = [];
  for (const id of passed) {
    if (id !== undefined && nameOf.has(id) && !ids.includes(id)) ids.push(id);
  }
  if (state.status === "closed") {
    return ids.map((id) => ({ id, label: nameOf.get(id)!, mark: "done" }));
  }
  const current = state.node_id;
  if (current !== null && nameOf.has(current) && !ids.includes(current)) ids.push(current);
  const items: StepperItem[] = ids.map((id) => ({
    id,
    label: nameOf.get(id)!,
    mark: id === current ? "current" : "done",
  }));
  for (const id of upcomingIds(def, state)) {
    if (!ids.includes(id)) items.push({ id, label: nameOf.get(id) ?? id, mark: "next" });
  }
  return items;
}

// deadlineOf gives the due time of the current step, the hours spent
// against its deadline, and the tone of the remaining time. It is null
// for a closed case and for a step with no deadline or no entry time.
export function deadlineOf(
  events: CaseEvent[],
  node: ProcessNode | undefined,
  state: CaseState,
  now: number,
): { due: string; spent: string; tone: "ok" | "warn" | "late" } | null {
  if (state.status === "closed" || node === undefined || node.deadline_hours === null) return null;
  const entered = enteredAt(events, node.id);
  if (entered === null) return null;
  const h = node.deadline_hours;
  return {
    due: dayTimeText(new Date(Date.parse(entered) + h * H).toISOString(), false),
    spent: `${Math.floor((now - Date.parse(entered)) / H)} h of ${h} h`,
    tone: dueText(msLeft(entered, h, now))!.tone,
  };
}
