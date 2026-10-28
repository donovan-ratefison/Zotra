// The checks tab of the test screen: one card per check of the step
// with its last result, the required documents card and the signature
// card. The results come from the events up to the state seq; the
// words carry the state, the color only backs them.

import { Check } from "lucide-react";
import { Badge } from "@/ui/badge";
import type { CaseEvent, CaseState } from "./case-api";
import type { ProcessDefinition } from "./types";

export function ChecksTab({ def, state, events, nodeId }: {
  def: ProcessDefinition;
  state: CaseState;
  events: CaseEvent[];
  nodeId: string;
}) {
  const node = def.nodes.find((nd) => nd.id === nodeId);
  if (node === undefined || node.type !== "task") {
    return (
      <p className="text-sm text-muted-foreground">Only tasks have checks.</p>
    );
  }
  const docs = Array.isArray(state.data.documents)
    ? state.data.documents.length
    : 0;

  return (
    <div className="flex flex-col gap-3">
      {node.checks.length === 0 && (
        <p className="text-sm text-muted-foreground">No check on this step.</p>
      )}
      {node.checks.map((check) => {
        // The last check_evaluated of this check at or before the
        // state seq: the state of a replay ends at its seq.
        const mine = events.filter(
          (e) =>
            e.type === "check_evaluated" &&
            e.payload.check_id === check.id &&
            e.seq <= state.seq,
        );
        const last = mine.length > 0 ? mine[mine.length - 1]! : undefined;
        const failed = last !== undefined && last.payload.result === false;
        return (
          <div
            key={check.id}
            className="flex flex-col gap-1.5 rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">{`Check ${check.id}`}</h4>
              {last === undefined ? (
                <Badge variant="secondary">Not run</Badge>
              ) : last.payload.result === true ? (
                <Badge className="bg-green-600 text-white">Passed</Badge>
              ) : (
                <Badge variant="destructive">Failed</Badge>
              )}
            </div>
            <code className="font-mono text-[12px] text-muted-foreground">
              {check.expression}
            </code>
            {failed && <p className="text-destructive text-sm">{check.message}</p>}
          </div>
        );
      })}

      {node.documents.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Required documents</h4>
            <Badge variant="secondary">{`${docs} of ${node.documents.length}`}</Badge>
          </div>
          <ul className="flex flex-col gap-1">
            {node.documents.map((name, index) => (
              <li
                key={name}
                className="flex items-center gap-2 text-sm"
                data-covered={index < docs}
              >
                {index < docs && <Check className="size-3.5 text-green-600" />}
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {node.signature && (
        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Signature</h4>
            <Badge variant="secondary">To sign</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Simple signature: name, time and document hash go to the audit
            log.
          </p>
        </div>
      )}
    </div>
  );
}
