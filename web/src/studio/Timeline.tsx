// The text of one case event, for the timeline tooltips and the
// audit log.

import type { CaseEvent } from "./case-api";
import type { ProcessDefinition } from "./types";

// eventLabel gives the text of one event. A node or edge id that the
// definition does not hold gives the raw id in the same text; any
// other type gives the raw type.
export function eventLabel(
  def: ProcessDefinition,
  e: CaseEvent,
  userName: (id: string) => string = (id) => id,
): string {
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
      return `Assigned to ${userName(String(p.user_id ?? ""))}`;
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
