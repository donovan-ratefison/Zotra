// The supervision screen: the key figures and the flow of the
// published versions, and their open cases per step, with the heat
// per step and the load per participant. The view is read only. AppShell owns the supervision
// answer and passes it down with the users list.

import { useState } from "react";
import { Activity, Split, TriangleAlert } from "lucide-react";
import { moneyText, pickField } from "./InboxScreen";
import { weightedLead } from "./sup-api";
import type { Flow, SupCase, Supervision } from "./sup-api";
import type { UserDTO } from "../studio/case-api";
import type { ProcessDefinition, ProcessNode } from "../studio/types";

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

export interface TileFigure {
  label: string;
  value: string;
  unit: string;
  sub: string;
  bad: boolean;
}

// nodeNameOf gives the name of a node id, the raw id when unknown.
function nodeNameOf(def: ProcessDefinition, id: string): string {
  return def.nodes.find((node) => node.id === id)?.name ?? id;
}

// tileFigures gives the 4 key figures of the head: the cases in
// progress, the average lead time of the approved cases, the late
// cases and the return rate.
export function tileFigures(
  def: ProcessDefinition,
  sup: Supervision,
  flow: Flow,
): TileFigure[] {
  const steps = sup.nodes.filter((n) => n.open > 0).length;
  const free = sup.cases.filter((c) => c.assignee === "").length;
  const approved = new Set(
    def.nodes
      .filter((n) => n.type === "end" && n.end_result === "approved")
      .map((n) => n.id),
  );
  const ends = flow.ends.filter((e) => approved.has(e.node_id));
  const leadCases = ends.reduce((sum, e) => sum + e.cases, 0);
  const lateNodes = sup.nodes.filter((n) => n.late > 0);
  let lateSub = `On ${lateNodes.length} steps`;
  if (sup.total_late === 0) {
    lateSub = "None past the deadline";
  } else if (lateNodes.length === 1) {
    lateSub = `All at ${nodeNameOf(def, lateNodes[0]!.node_id)}`;
  }
  return [
    {
      label: "Cases in progress",
      value: String(sup.total_open),
      unit: "",
      sub: `On ${steps} ${steps === 1 ? "step" : "steps"}, ${free} not assigned`,
      bad: false,
    },
    leadCases === 0
      ? {
          label: "Average lead time",
          value: "-",
          unit: "",
          sub: `No approved case in ${flow.days} days`,
          bad: false,
        }
      : {
          label: "Average lead time",
          value: (weightedLead(ends) / 24).toFixed(1),
          unit: "days",
          sub: `Approved cases, last ${flow.days} days`,
          bad: false,
        },
    {
      label: "Cases late",
      value: String(sup.total_late),
      unit: "",
      sub: lateSub,
      bad: sup.total_late > 0,
    },
    flow.closed === 0
      ? {
          label: "Return rate",
          value: "-",
          unit: "",
          sub: `No closed case in ${flow.days} days`,
          bad: false,
        }
      : {
          label: "Return rate",
          value: String(Math.round((flow.returns / flow.closed) * 100)),
          unit: "%",
          sub: `${flow.returns} ${flow.returns === 1 ? "return" : "returns"} on ${flow.closed} closed cases`,
          bad: false,
        },
  ];
}

// blockOf gives the step with the most late cases (tie: the first in
// the definition order) and the text of its card. It gives null when
// no step has a late case.
export function blockOf(
  def: ProcessDefinition,
  sup: Supervision,
  users: UserDTO[],
): { nodeId: string; name: string; text: string } | null {
  let row: Supervision["nodes"][number] | undefined;
  for (const node of def.nodes) {
    const r = sup.nodes.find((n) => n.node_id === node.id);
    if (r && r.late > (row?.late ?? 0)) {
      row = r;
    }
  }
  if (row === undefined) {
    return null;
  }
  const cases = sup.cases.filter((c) => c.node_id === row.node_id);
  const free = cases.filter((c) => c.assignee === "").length;
  const load = new Map<string, number>();
  for (const c of cases) {
    if (c.assignee !== "") {
      load.set(c.assignee, (load.get(c.assignee) ?? 0) + 1);
    }
  }
  let top: [string, number] | undefined;
  for (const entry of load) {
    if (entry[1] > (top?.[1] ?? 0)) {
      top = entry;
    }
  }
  const wait = row.open === 1 ? "1 case waits." : `${row.open} cases wait.`;
  const late = row.late === 1 ? "1 is late." : `${row.late} are late.`;
  const freeText =
    free === 0 ? "" : ` ${free} ${free === 1 ? "has" : "have"} no assignee.`;
  const holder =
    top === undefined
      ? ""
      : ` ${userNameOf(users, top[0])} holds ${top[1]} of them.`;
  return {
    nodeId: row.node_id,
    name: nodeNameOf(def, row.node_id),
    text: `${wait} ${late}${freeText}${holder}`,
  };
}

// Tile is one key figure card of the head.
function Tile({ figure }: { figure: TileFigure }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border bg-card px-3.5 py-2.5">
      <span className="text-[11.5px] font-medium text-muted-foreground">
        {figure.label}
      </span>
      <div className={figure.bad ? "text-destructive" : undefined}>
        <span className="text-2xl font-semibold">{figure.value}</span>
        {figure.unit !== "" && (
          <span className="ml-1 text-[13px] font-medium text-muted-foreground">
            {figure.unit}
          </span>
        )}
      </div>
      <span className="truncate text-[11.5px] text-muted-foreground">
        {figure.sub}
      </span>
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
  users,
  supervision,
  flow,
  selectedNodeId,
}: {
  def: ProcessDefinition;
  users: UserDTO[];
  supervision: Supervision;
  flow: Flow;
  selectedNodeId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(
    selectedNodeId ?? null,
  );
  const flowNodes = def.nodes.filter((node) => node.type !== "start");
  const block = blockOf(def, supervision, users);

  return (
    <div className="w-full px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[15px] font-semibold">Supervision</h1>
          <p className="text-xs text-muted-foreground">
            Read only view of the open cases of every published version.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Supervision views"
          className="inline-flex gap-0.5 rounded-[7px] border bg-muted p-[3px]"
        >
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="inline-flex h-7 items-center gap-[7px] rounded-[5px] bg-card px-3 text-sm font-medium ring-1 ring-inset ring-border"
          >
            <Activity aria-hidden className="size-4" />
            Live flow
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            disabled
            className="inline-flex h-7 items-center gap-[7px] rounded-[5px] px-3 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed"
          >
            <Split aria-hidden className="size-4" />
            Case flow
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-3">
        {tileFigures(def, supervision, flow).map((figure) => (
          <Tile key={figure.label} figure={figure} />
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 items-start gap-3">
        {block !== null && (
          <div className="rounded-lg border border-[#fecaca] border-l-[3px] border-l-[#dc2626] bg-[#fef2f2] px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#dc2626]">
              <TriangleAlert aria-hidden className="size-3.5" />
              Where it blocks
            </div>
            <h2 className="mt-0.5 text-[15px] font-semibold">{block.name}</h2>
            <p className="text-[12.5px] text-[#3f3f46]">{block.text}</p>
          </div>
        )}
        <div className="col-start-2 rounded-lg border bg-[#fafaf9] px-3.5 py-2.5">
          <h3 className="mb-2 text-[11.5px] font-medium text-muted-foreground">
            Who decided today, since 00:00 UTC
          </h3>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="border-l-2 border-border pl-2.5">
              <b className="block text-xl font-semibold">{flow.today.people}</b>
              <span className="text-[11.5px] text-muted-foreground">
                People: entries, decisions, signatures
              </span>
            </div>
            <div className="border-l-2 border-border pl-2.5">
              <b className="block text-xl font-semibold">{flow.today.rules}</b>
              <span className="text-[11.5px] text-muted-foreground">
                Rules: routing at the gateways
              </span>
            </div>
            <div className="border-l-2 border-[#a1a1aa] pl-2.5">
              <b className="block text-xl font-semibold text-muted-foreground">
                0
              </b>
              <span className="text-[11.5px] text-muted-foreground">AI</span>
            </div>
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            The AI never decides. It only proposes and checks.
          </p>
        </div>
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
