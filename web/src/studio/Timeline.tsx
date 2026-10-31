// The text of one case event, for the timeline tooltips and the
// audit log.

import type { CaseEvent } from "./case-api";
import type { ProcessDefinition } from "./types";

// eventLabel gives the text of one event. A node, edge or source id
// that the definition does not hold gives the raw id in the same text;
// any other type gives the raw type. A check reads "Check <n>", its
// position in its step; an unknown check gives the raw id.
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
    case "check_evaluated": {
      const node = def.nodes.find((nd) => nd.id === p.node_id);
      const index = node?.checks.findIndex((c) => c.id === p.check_id) ?? -1;
      const name =
        index >= 0 ? `Check ${index + 1}` : `Check ${String(p.check_id ?? "")}`;
      if (p.result === true) return `${name} passed`;
      const message = index >= 0 ? node!.checks[index]!.message : "";
      return message ? `${name} failed: ${message}` : `${name} failed`;
    }
    case "decision_made":
      return `Decision ${String(p.decision ?? "")}`;
    case "signature_added":
      return `Signature added on ${nodeName(p.node_id)}`;
    case "case_closed":
      return `Case closed: ${String(p.result ?? "")}`;
    case "source_fetched": {
      const source = def.sources.find((s) => s.id === p.source_id);
      return `Fetched ${source?.name ?? String(p.source_id ?? "")}`;
    }
    default:
      return e.type;
  }
}
