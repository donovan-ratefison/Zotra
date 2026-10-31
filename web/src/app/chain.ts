// Pure model of the case chain strip: one block for each step passed,
// the ghost blocks of the next steps, and the tones and texts of a
// verify run.

import type { CaseEvent, CaseState } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import { upcomingOf } from "../studio/TimelineBar";

export type BlockKind = "step" | "rule" | "cur" | "new";
export interface ChainBlock {
  label: string;
  from: number;
  to: number;
  hash: string;
  prev: string;
  kind: BlockKind;
}
// bad is the first bad seq (0: intact). upTo is the last seq of the walk.
export interface VerifyRun {
  bad: number;
  upTo: number;
}

// chainBlocks groups the events from one step_entered to the next. The
// events before the first step_entered belong to the start node.
export function chainBlocks(def: ProcessDefinition, events: CaseEvent[], state: CaseState): ChainBlock[] {
  const start = def.nodes.find((n) => n.type === "start")?.id ?? "";
  const groups: { nodeId: string; events: CaseEvent[] }[] = [];
  for (const e of events) {
    if (e.type === "step_entered" || groups.length === 0) {
      groups.push({ nodeId: e.type === "step_entered" ? String(e.payload.node_id) : start, events: [] });
    }
    groups.at(-1)!.events.push(e);
  }
  return groups.map((g, i) => {
    const node = def.nodes.find((n) => n.id === g.nodeId);
    const first = g.events[0]!;
    const last = g.events.at(-1)!;
    const kind: BlockKind =
      i === groups.length - 1 && state.status === "open" ? "cur" : node?.type === "gateway" ? "rule" : "step";
    return {
      label: node?.name ?? g.nodeId,
      from: first.seq,
      to: last.seq,
      hash: last.hash.slice(0, 8),
      prev: first.prev_hash.slice(0, 8),
      kind,
    };
  });
}

// ghostLabels gives the next steps, so that the strip has 9 blocks at most.
export function ghostLabels(def: ProcessDefinition, state: CaseState, real: number): string[] {
  return upcomingOf(def, state).slice(0, Math.max(0, 9 - real));
}

export function seqTone(seq: number, run: VerifyRun | null): "idle" | "ok" | "bad" {
  if (run === null) return "idle";
  if (run.bad !== 0 && run.upTo >= run.bad && seq >= run.bad) return "bad";
  if (seq <= run.upTo && (run.bad === 0 || seq < run.bad)) return "ok";
  return "idle";
}

// walkEnd gives the last seq of the walk: the first bad seq, else n.
export function walkEnd(run: VerifyRun, n: number): number {
  return run.bad === 0 ? n : run.bad;
}

export function chainStatus(
  n: number,
  lastHash: string,
  run: VerifyRun | null,
): { tone: "idle" | "busy" | "ok" | "bad"; title: string; detail: string } {
  if (run === null) return { tone: "idle", title: "Case history", detail: `${n} events. Last block ${lastHash}.` };
  if (run.upTo < walkEnd(run, n)) return { tone: "busy", title: `Checking event ${run.upTo + 1} of ${n}`, detail: "" };
  if (run.bad === 0) return { tone: "ok", title: `Chain verified. ${n} events.`, detail: "" };
  return { tone: "bad", title: `Event ${run.bad} changed after it was written.`, detail: "" };
}
