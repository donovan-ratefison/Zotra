// The supervision screen: the open cases of the published version per
// step, with the counts, the heat per step and the load per
// participant. The view is read only. AppShell owns the supervision
// answer and passes it down with the users list.

import { useState } from "react";
import { moneyText, pickField } from "./InboxScreen";
import type { SupCase, Supervision } from "./sup-api";
import type { UserDTO } from "../studio/case-api";
import type {
  ProcessDefinition,
  ProcessNode,
  VersionSummary,
} from "../studio/types";

// heatColor gives the heat color of one step: the ratio of the median
// time on the step to its deadline. A step with no deadline stays
// gray.
export function heatColor(
  medianHours: number,
  deadline: number | null,
): string {
  if (deadline === null) {
    return "#71717a";
  }
  const ratio = medianHours / deadline;
  if (ratio < 0.5) {
    return "#16a34a";
  }
  if (ratio < 1) {
    return "#d97706";
  }
  return "#dc2626";
}

// Tile is one tile card of the head: the label, the value, the sub.
function Tile({ label, value, sub }: {
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1 rounded-lg border bg-card px-4 py-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-[13px] text-muted-foreground">{sub}</span>
    </div>
  );
}

// StepChip is one button of the step flow: the node name, the open
// count, and the heat bar. A step with no open case renders dimmed.
function StepChip({ node, row, pressed, onSelect }: {
  node: ProcessNode;
  row: Supervision["nodes"][number] | undefined;
  pressed: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const open = row?.open ?? 0;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onSelect(node.id)}
      className={`flex min-w-[120px] flex-col items-start gap-1 rounded-lg border bg-card px-3 py-2 text-left ${
        pressed ? "border-primary bg-accent" : ""
      } ${open === 0 ? "opacity-60" : ""}`}
    >
      <span className="text-[13px] font-medium">{node.name}</span>
      <span className="font-mono text-sm">{open}</span>
      <span
        aria-hidden
        className="h-1 w-full rounded-full"
        style={{
          backgroundColor: heatColor(
            row?.median_hours ?? 0,
            node.deadline_hours,
          ),
        }}
      />
    </button>
  );
}

// clientOf gives the first string field of the case data, - when
// absent.
function clientOf(def: ProcessDefinition, data: Record<string, unknown>) {
  const field = pickField(def, "string");
  const value = field === null ? undefined : data[field.name];
  return typeof value === "string" ? value : "-";
}

function amountOf(def: ProcessDefinition, data: Record<string, unknown>) {
  const field = pickField(def, "money");
  return field === null ? "-" : moneyText(data[field.name]);
}

// userNameOf gives the name of a user id, the raw id when unknown.
function userNameOf(users: UserDTO[], id: string): string {
  return users.find((user) => user.id === id)?.name ?? id;
}

// StepTable is the card under the flow: the open cases of the
// selected step. With no selection it asks for one.
function StepTable({ def, users, supervision, selected }: {
  def: ProcessDefinition;
  users: UserDTO[];
  supervision: Supervision;
  selected: string | null;
}) {
  if (selected === null) {
    return (
      <div className="rounded-lg border bg-card px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Select a step to see its cases.
        </p>
      </div>
    );
  }
  const node = def.nodes.find((n) => n.id === selected);
  const row = supervision.nodes.find((n) => n.node_id === selected);
  const rows = supervision.cases.filter(
    (c: SupCase) => c.node_id === selected,
  );
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{node?.name ?? selected}</h2>
        <p className="text-[13px] text-muted-foreground">
          {`${row?.open ?? 0} open, ${row?.late ?? 0} late`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Case</th>
              <th className="px-4 py-2.5 font-medium">Client</th>
              <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">With</th>
              <th className="px-4 py-2.5 text-right font-medium">
                Time on step
              </th>
              <th className="px-4 py-2.5 font-medium">Late</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.case_id} className="border-b last:border-b-0">
                <td className="px-4 py-3 font-mono text-[13px]">
                  {c.reference}
                </td>
                <td className="px-4 py-3 text-sm">
                  {clientOf(def, c.data)}
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {amountOf(def, c.data)}
                </td>
                <td className="px-4 py-3 text-sm">
                  {c.assignee === "" ? "-" : userNameOf(users, c.assignee)}
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {`${c.age_hours} h`}
                </td>
                <td className="px-4 py-3 text-sm">
                  {c.late ? (
                    <span className="text-destructive">Yes</span>
                  ) : (
                    "No"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SupervisionScreen({
  def,
  version,
  users,
  supervision,
  selectedNodeId,
}: {
  def: ProcessDefinition;
  version: VersionSummary;
  users: UserDTO[];
  supervision: Supervision;
  selectedNodeId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(
    selectedNodeId ?? null,
  );
  const flowNodes = def.nodes.filter((node) => node.type !== "start");
  const openSteps = supervision.nodes.filter((n) => n.open > 0).length;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-8 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Supervision
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {`Read only view of the open cases of v${version.number}.`}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <Tile
          label="Open cases"
          value={supervision.total_open}
          sub={`across ${openSteps} steps`}
        />
        <Tile
          label="Late"
          value={supervision.total_late}
          sub="past the step deadline"
        />
      </div>

      <div className="mb-4 rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Steps and indicators</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-4">
          {flowNodes.map((node, index) => (
            <span key={node.id} className="contents">
              {index > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  {"→"}
                </span>
              )}
              <StepChip
                node={node}
                row={supervision.nodes.find((n) => n.node_id === node.id)}
                pressed={selected === node.id}
                onSelect={setSelected}
              />
            </span>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <StepTable
          def={def}
          users={users}
          supervision={supervision}
          selected={selected}
        />
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Load per participant</h2>
          </div>
          {supervision.people.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No case is assigned.
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Participant</th>
                  <th className="px-4 py-2.5 text-right font-medium">Open</th>
                  <th className="px-4 py-2.5 text-right font-medium">Late</th>
                </tr>
              </thead>
              <tbody>
                {supervision.people.map((person) => (
                  <tr key={person.user_id} className="border-b last:border-b-0">
                    <td className="px-4 py-3 text-sm">
                      {userNameOf(users, person.user_id)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      {person.open}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      {person.late > 0 ? (
                        <span className="text-destructive">{person.late}</span>
                      ) : (
                        person.late
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
