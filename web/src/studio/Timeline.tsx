// The event timeline of the test screen: one row per event, in seq
// order, plus the Present row. The row of the current position
// carries the blue left border. A click moves the replay position;
// TestScreen owns the position.

import type { CaseEvent } from "./case-api";
import type { ProcessDefinition } from "./types";

// eventLabel gives the text of one event. A node or edge id that the
// definition does not hold gives the raw id in the same text; any
// other type gives the raw type.
export function eventLabel(def: ProcessDefinition, e: CaseEvent): string {
  const p = e.payload;
  const nodeName = (id: unknown) =>
    def.nodes.find((nd) => nd.id === id)?.name ?? String(id ?? "");
  switch (e.type) {
    case "case_created":
      return "Case created";
    case "step_entered":
      return `Entered ${nodeName(p.node_id)}`;
    case "edge_taken": {
      const edge = def.edges.find((ed) => ed.id === p.edge_id);
      if (edge === undefined) {
        return `Link ${String(p.edge_id ?? "")} to ${String(p.edge_id ?? "")}`;
      }
      return `Link ${nodeName(edge.from)} to ${nodeName(edge.to)}`;
    }
    case "step_assigned":
      return `Assigned to ${String(p.user_id ?? "")}`;
    case "data_submitted":
      return `Data submitted on ${nodeName(p.node_id)}`;
    case "check_evaluated":
      return `Check ${String(p.check_id ?? "")} ${
        p.result === true ? "passed" : "failed"
      }`;
    case "decision_made":
      return `Decision ${String(p.decision ?? "")}`;
    case "signature_added":
      return `Signature added on ${nodeName(p.node_id)}`;
    case "case_closed":
      return `Case closed: ${String(p.result ?? "")}`;
    default:
      return e.type;
  }
}

// Timeline renders one row per event, then the Present row. The row
// of the current position carries the blue left border; when the
// position is the present, the Present row carries it.
export function Timeline({ def, events, at, onSelect }: {
  def: ProcessDefinition;
  events: CaseEvent[];
  at: number | null; // null = present
  onSelect: (at: number | null) => void;
}) {
  return (
    <ol className="flex flex-col pb-1.5">
      {events.map((e) => {
        const active = e.seq === at;
        return (
          <li key={e.seq}>
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(e.seq)}
              className={`w-full rounded px-2 py-0.5 text-left text-sm leading-tight ${
                active
                  ? "border-l-2 border-blue-600"
                  : "border-l-2 border-transparent"
              }`}
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {e.seq}
              </span>
              <span className="ml-2">{eventLabel(def, e)}</span>
              <span className="block text-[11px] text-muted-foreground">
                {e.actor}
              </span>
            </button>
          </li>
        );
      })}
      <li>
        <button
          type="button"
          aria-current={at === null ? "true" : undefined}
          onClick={() => onSelect(null)}
          className={`w-full rounded px-2 py-0.5 text-left font-mono text-muted-foreground leading-tight ${
            at === null
              ? "border-l-2 border-blue-600"
              : "border-l-2 border-transparent"
          }`}
        >
          Present
        </button>
      </li>
    </ol>
  );
}
