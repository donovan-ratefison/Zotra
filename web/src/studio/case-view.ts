// The case view: the diagram state that the event list and the
// effective state of one case produce. Pure functions, no React.

import type { CaseEvent, CaseState } from "./case-api";

export interface CaseView {
  currentNodeId: string | null;
  traversedEdgeIds: string[];
  traversedNodeIds: string[];
  failedCheck: boolean;
  actorName: string | null;
}

// The ids of one payload field of one event type, in list order,
// without duplicates. A return loop can take one edge twice; the
// first occurrence stays.
function collectedIds(
  events: CaseEvent[],
  type: string,
  field: string,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const event of events) {
    if (event.type !== type) {
      continue;
    }
    const id = String(event.payload[field]);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function caseViewOf(
  events: CaseEvent[],
  state: CaseState,
  userName: (id: string) => string | null,
): CaseView {
  // The events of the position, in list order: listEvents delivers
  // seq order, so the last of `past` is the event at the position.
  const past = events.filter((e) => e.seq <= state.seq);
  const last = past.length > 0 ? past[past.length - 1]! : null;
  const id =
    state.assignee !== "" ? state.assignee : last !== null ? last.actor : null;
  return {
    currentNodeId: state.status === "open" ? state.node_id : null,
    traversedEdgeIds: collectedIds(past, "edge_taken", "edge_id"),
    traversedNodeIds: collectedIds(past, "step_entered", "node_id"),
    failedCheck:
      last !== null &&
      last.type === "check_evaluated" &&
      last.payload.result === false,
    actorName: id === null ? null : userName(id),
  };
}

// The first letter of each word, upper case, at most 2 letters.
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
