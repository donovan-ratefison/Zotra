// The audit screen: the newest events of every case, with the hash
// chain check. The view is read only. AppShell owns the audit answer,
// the verify state and the export, and passes them down.

import { eventLabel } from "../studio/Timeline";
import { Button } from "@/ui/button";
import type { AuditEvent, AuditVerify } from "./sup-api";
import type { UserDTO } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";

// utcText gives the delivered UTC date form (the rule of lot 5.2).
function utcText(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", { timeZone: "UTC" });
}

// actorOf gives the name of an actor, the raw actor when the users
// list does not hold it (system stays system).
function actorOf(users: UserDTO[], actor: string): string {
  return users.find((user) => user.id === actor)?.name ?? actor;
}

export function AuditScreen({
  def,
  users,
  audit,
  verify,
  busy,
  onVerify,
  onExport,
}: {
  def: ProcessDefinition;
  users: UserDTO[];
  audit: { events: AuditEvent[]; total: number };
  verify: AuditVerify | null;
  busy: boolean;
  onVerify: () => void;
  onExport: () => void;
}) {
  const broken = verify !== null && verify.broken.length > 0;
  return (
    <div className="mx-auto w-full max-w-[1100px] px-8 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Audit log
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every event carries the hash of the previous one. The log
            cannot change.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={onVerify}>
            Verify chain
          </Button>
          <Button variant="outline" onClick={onExport}>
            Export
          </Button>
        </div>
      </div>

      {verify !== null && !broken && (
        <p
          role="status"
          className="mb-4 text-[13px]"
          style={{ color: "#16a34a" }}
        >
          {`Chain verified: ${verify.events} events across ${verify.cases} cases, no break.`}
        </p>
      )}
      {verify !== null && broken && (
        <p role="status" className="mb-4 text-[13px] text-destructive">
          {`Chain broken: case ${verify.broken[0]!.case_id} at event ${verify.broken[0]!.seq}.`}
        </p>
      )}

      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Case</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Hash</th>
                <th className="px-4 py-2.5 font-medium">Previous</th>
              </tr>
            </thead>
            <tbody>
              {audit.events.map((event) => (
                <tr key={`${event.case_id}-${event.seq}`} className="border-b last:border-b-0">
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {utcText(event.at)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px]">
                    {event.reference}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {actorOf(users, event.actor)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {eventLabel(def, event, (id) => actorOf(users, id))}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-muted-foreground">
                    {event.hash.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-muted-foreground">
                    {event.prev_hash.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2.5 text-[13px] text-muted-foreground">
          {`${audit.events.length} of ${audit.total} events.`}
        </div>
      </div>
    </div>
  );
}
