// The live bar at the bottom of the supervision: the state of the hash
// chain and a ticker of the last events in plain sentences. The bar
// reads the audit routes again every 10 seconds.

import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { ApiError } from "../studio/api";
import type { UserDTO } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import { actorOf } from "./AuditScreen";
import { fetchAudit, fetchAuditVerify, type AuditEvent } from "./sup-api";
import { decisionLabel } from "./triage";

export const LIVE_MS = 10_000;

// liveQueries gives the two queries of the bar. Their keys do not share
// the cache of the audit screen.
export function liveQueries() {
  return {
    audit: {
      queryKey: ["audit", "live"],
      queryFn: () => fetchAudit(12),
      refetchInterval: LIVE_MS,
    },
    verify: {
      queryKey: ["audit-verify", "live"],
      queryFn: fetchAuditVerify,
      refetchInterval: LIVE_MS,
    },
  };
}

export interface TickerLine {
  time: string;
  actor: string;
  text: string;
  system: boolean;
}

// tickerLine gives the sentence of one event. The text starts with a
// lower case verb: the actor name renders before it.
export function tickerLine(
  def: ProcessDefinition,
  e: AuditEvent,
  users: UserDTO[],
): TickerLine {
  const p = e.payload;
  const ref = e.reference;
  const node = (id: unknown) =>
    def.nodes.find((n) => n.id === id)?.name ?? String(id ?? "");
  let text: string;
  switch (e.type) {
    case "case_created":
      text = `created ${ref}`;
      break;
    case "step_entered":
      text = `moved ${ref} to ${node(p.node_id)}`;
      break;
    case "edge_taken": {
      const edge = def.edges.find((ed) => ed.id === p.edge_id);
      const gateway =
        def.nodes.find((n) => n.id === edge?.from)?.type === "gateway";
      if (edge === undefined) {
        text = `sent ${ref} on the link ${String(p.edge_id ?? "")}`;
      } else if (gateway && edge.condition) {
        text = `sent ${ref} to ${node(edge.to)} by the rule ${edge.condition}`;
      } else if (gateway) {
        text = `sent ${ref} to ${node(edge.to)} by the default way`;
      } else {
        text = `sent ${ref} to ${node(edge.to)}`;
      }
      break;
    }
    case "step_assigned":
      text = `took ${ref} at ${node(p.node_id)}`;
      break;
    case "data_submitted":
      text = `submitted ${ref} at ${node(p.node_id)}`;
      break;
    case "check_evaluated":
      text = `${p.result === true ? "passed" : "failed"} the check ${String(p.check_id ?? "")} on ${ref}`;
      break;
    case "decision_made":
      text = `sent the decision ${decisionLabel(String(p.decision ?? ""))} on ${ref}`;
      break;
    case "signature_added":
      text = `signed ${ref} at ${node(p.node_id)}`;
      break;
    case "case_closed":
      text = `closed ${ref}: ${String(p.result ?? "")}`;
      break;
    case "source_fetched": {
      const source = def.sources.find((s) => s.id === p.source_id);
      text = `read ${source?.name ?? String(p.source_id ?? "")} for ${ref}`;
      break;
    }
    default:
      text = `wrote ${e.type} on ${ref}`;
  }
  return {
    time: new Date(e.at).toISOString().slice(11, 16),
    actor: actorOf(users, e.actor),
    text,
    system: e.actor === "system",
  };
}

// The mask of the mockup: the ticker fades in and out at the edges.
const viewMask: CSSProperties = {
  maskImage:
    "linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 40px), transparent)",
};

const statusClass = "text-[12.5px] text-muted-foreground pl-5";

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

export function LiveBar({
  def,
  users,
}: {
  def: ProcessDefinition;
  users: UserDTO[];
}) {
  const queries = liveQueries();
  const audit = useQuery(queries.audit);
  const verify = useQuery(queries.verify);

  let label;
  if (verify.isPending) {
    label = (
      <>
        <ShieldCheck className="size-3.5" />
        {"Event log · checking the chain"}
      </>
    );
  } else if (verify.isError) {
    label = (
      <>
        <ShieldAlert className="size-3.5 text-[#dc2626]" />
        {"Event log · the check did not load"}
      </>
    );
  } else if (verify.data.broken.length > 0) {
    label = (
      <>
        <ShieldAlert className="size-3.5 text-[#dc2626]" />
        {"Event log · chain broken"}
      </>
    );
  } else {
    label = (
      <>
        <ShieldCheck className="size-3.5 text-primary" />
        {"Event log · chain verified"}
      </>
    );
  }

  let view;
  if (audit.isPending) {
    view = <span className={statusClass}>Loading the events.</span>;
  } else if (audit.isError) {
    view = (
      <span className={statusClass}>
        {`The events did not load: ${errorText(audit.error)}`}
      </span>
    );
  } else if (audit.data.events.length === 0) {
    view = <span className={statusClass}>No event yet.</span>;
  } else {
    const lines = audit.data.events.map((e, i) => {
      const line = tickerLine(def, e, users);
      return (
        <span
          key={`${e.case_id}-${e.seq}`}
          className="inline-flex items-center gap-2 text-[12.5px] text-[#3f3f46]"
        >
          <i
            className={`size-1.5 flex-none rounded-full ${line.system ? "bg-[#2563eb]" : "bg-primary"}`}
          />
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {line.time}
          </span>
          {i === 0 && (
            <span className="rounded bg-primary px-[5px] text-[10px] font-semibold leading-4 text-primary-foreground">
              New
            </span>
          )}
          <b className="font-medium text-foreground">{line.actor}</b>
          <span>{line.text}</span>
        </span>
      );
    });
    view = (
      <div className="sup-tick flex gap-[34px] pl-5 whitespace-nowrap">
        {lines}
        <span aria-hidden="true" className="flex gap-[34px]">
          {lines}
        </span>
      </div>
    );
  }

  return (
    <footer className="sticky bottom-0 z-10 mt-auto flex h-10 flex-none items-center border-t bg-white">
      <div className="flex h-full flex-none items-center gap-[7px] border-r pr-3.5 pl-4 text-[11.5px] whitespace-nowrap text-muted-foreground">
        {label}
      </div>
      <div
        className="flex h-full min-w-0 flex-1 items-center overflow-hidden"
        style={viewMask}
      >
        {view}
      </div>
    </footer>
  );
}
