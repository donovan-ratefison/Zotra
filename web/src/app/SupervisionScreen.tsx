// The supervision screen: the key figures and the flow of the
// published versions, the live flow diagram of their open cases, the
// panel of the selected step and the load per participant. The view
// is read only. AppShell owns the supervision answer and passes it
// down with the users list.

import { useEffect, useState } from "react";
import { Activity, ChevronRight, Split, TriangleAlert, X } from "lucide-react";
import { moneyText, pickField } from "./InboxScreen";
import { FlowLegend, haloOf, LiveDiagram } from "./LiveFlow";
import { weightedLead } from "./sup-api";
import type { Flow, SupCase, Supervision } from "./sup-api";
import type { UserDTO } from "../studio/case-api";
import { layoutProcess } from "../studio/layout";
import type { Layout } from "../studio/layout";
import type { ProcessDefinition } from "../studio/types";

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

// topHolder gives the assignee with the most cases (tie: the first in
// the given order), null when no case has an assignee.
export function topHolder(
  cases: SupCase[],
): { userId: string; count: number } | null {
  const load = new Map<string, number>();
  for (const c of cases) {
    if (c.assignee !== "") {
      load.set(c.assignee, (load.get(c.assignee) ?? 0) + 1);
    }
  }
  let top: { userId: string; count: number } | null = null;
  for (const [userId, count] of load) {
    if (count > (top?.count ?? 0)) {
      top = { userId, count };
    }
  }
  return top;
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
  const top = topHolder(cases);
  const wait = row.open === 1 ? "1 case waits." : `${row.open} cases wait.`;
  const late = row.late === 1 ? "1 is late." : `${row.late} are late.`;
  const freeText =
    free === 0 ? "" : ` ${free} ${free === 1 ? "has" : "have"} no assignee.`;
  const holder =
    top === null
      ? ""
      : ` ${userNameOf(users, top.userId)} holds ${top.count} of them.`;
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

// byAge sorts the cases oldest first, tie: the reference.
export function byAge(a: SupCase, b: SupCase): number {
  return b.age_hours - a.age_hours || a.reference.localeCompare(b.reference);
}

// stepCases gives the open cases of one node, oldest first.
export function stepCases(sup: Supervision, nodeId: string): SupCase[] {
  return sup.cases.filter((c) => c.node_id === nodeId).sort(byAge);
}

// listText joins the items with commas and "and" before the last one.
export function listText(items: string[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// whyText gives the "Why it blocks" text of one step from the cases
// of the step: the late cases, the holder, the cases with no assignee
// and the returned cases.
export function whyText(cases: SupCase[], users: UserDTO[]): string {
  const n = cases.length;
  if (n === 0) {
    return "No case waits at this step.";
  }
  const refs = cases.filter((c) => c.late).sort(byAge).map((c) => c.reference);
  const parts = [
    refs.length === 0
      ? "No case is late."
      : refs.length === 1
        ? `1 case is late: ${refs[0]}.`
        : `${refs.length} cases are late: ${listText(refs)}.`,
  ];
  const top = topHolder(cases);
  if (top !== null) {
    const name = userNameOf(users, top.userId);
    parts.push(
      n === 1
        ? `${name} holds the case.`
        : `${name} holds ${top.count} of the ${n} cases.`,
    );
  }
  const free = cases.filter((c) => c.assignee === "").length;
  if (free > 0) {
    parts.push(
      free === 1
        ? "1 case has no assignee."
        : `${free} cases have no assignee.`,
    );
  }
  const back = cases.filter((c) => c.returned).length;
  if (back > 0) {
    parts.push(
      back === 1
        ? "1 case came back to this step."
        : `${back} cases came back to this step.`,
    );
  }
  return parts.join(" ");
}

// leftText gives the time left before the deadline, or the delay.
export function leftText(c: SupCase, deadline: number | null): string {
  if (deadline === null) {
    return "No deadline";
  }
  // age_hours is floored, so +1 and -1 give the ceil and floor of
  // dueText in triage.ts (the deck shows the same text).
  return c.late
    ? `Late by ${c.age_hours - deadline + 1} h`
    : `${Math.max(0, deadline - c.age_hours - 1)} h left`;
}

// trackWidth gives the width of the age bar, in percent: the deadline
// mark sits at two thirds of the track.
export function trackWidth(ageHours: number, deadline: number | null): number {
  return deadline === null
    ? 0
    : Math.min(100, (ageHours / (deadline * 1.5)) * 100);
}

// initials gives the two initials of a user name: the first
// character of each of the first two words, upper case.
export function initials(name: string): string {
  return name
    .split(" ")
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

const FILL_CLASS = { ok: "bg-primary", near: "bg-[#d97706]", late: "bg-[#dc2626]" };
const LEFT_CLASS = { ok: "", near: "text-[#d97706]", late: "text-[#dc2626]" };
const LIST_GRID = "grid grid-cols-[170px_minmax(0,1fr)_72px_24px] items-center gap-2.5";

// StepPanel is the side panel of the selected step: its figures, the
// "Why it blocks" text and its open cases, oldest first.
function StepPanel({ def, users, sup, nodeId, onClose }: {
  def: ProcessDefinition;
  users: UserDTO[];
  sup: Supervision;
  nodeId: string;
  onClose: () => void;
}) {
  const node = def.nodes.find((n) => n.id === nodeId);
  const row = sup.nodes.find((n) => n.node_id === nodeId);
  const deadline = node?.deadline_hours ?? null;
  const roleId = node?.role ?? null;
  const role = def.roles.find((r) => r.id === roleId);
  const roleText =
    roleId === null
      ? "No role"
      : role === undefined
        ? roleId
        : `${role.name} · ${role.department}`;
  const late = row?.late ?? 0;
  const figures = [
    { label: "Waiting", value: `${row?.open ?? 0}` },
    { label: "Median age", value: `${row?.median_hours ?? 0} h` },
    { label: "Deadline", value: deadline === null ? "None" : `${deadline} h` },
    { label: "Late", value: `${late}`, bad: late > 0 },
  ];
  return (
    <aside
      aria-label="Step detail"
      className="fixed top-0 right-0 bottom-0 z-20 flex w-[468px] flex-col border-l bg-white shadow-[-18px_0_40px_rgba(12,10,9,.12)]"
    >
      <div className="flex items-start justify-between gap-3 px-[18px] pt-3.5 pb-2.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground">
            Step detail
          </div>
          <h2 className="mt-0.5 text-[18px] font-semibold tracking-tight">
            {node?.name ?? nodeId}
          </h2>
          <p className="text-xs text-muted-foreground">{roleText}</p>
        </div>
        <button
          type="button"
          aria-label="Close the step detail"
          onClick={onClose}
          className="grid size-[30px] place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="mx-[18px] grid grid-cols-4 rounded-lg border">
        {figures.map((f, i) => (
          <div key={f.label} className={i === 0 ? "px-3 py-[7px]" : "border-l px-3 py-[7px]"}>
            <span className="block text-[11px] text-muted-foreground">{f.label}</span>
            <b className={f.bad ? "text-[17px] font-semibold text-[#dc2626]" : "text-[17px] font-semibold"}>
              {f.value}
            </b>
          </div>
        ))}
      </div>
      <div className="mx-[18px] mt-3 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3.5 py-2.5">
        <h3 className="mb-1 flex items-center gap-[7px] text-[12.5px] font-semibold text-[#d97706]">
          <TriangleAlert aria-hidden className="size-3.5" />
          Why it blocks
        </h3>
        <p className="text-[12.5px] leading-normal text-[#3f3f46]">
          {whyText(sup.cases.filter((c) => c.node_id === nodeId), users)}
        </p>
        <small className="mt-[5px] block text-[11px] text-muted-foreground">
          Computed from the case data. No AI writes this text.
        </small>
      </div>
      <div className={`mx-[18px] mt-3 border-b pb-1.5 text-[11px] text-muted-foreground ${LIST_GRID}`}>
        <span>Cases at this step, oldest first</span>
        <div className="relative h-3.5">
          <span className="absolute top-0 left-0 whitespace-nowrap">0 h</span>
          {deadline !== null && (
            <span className="absolute top-0 left-[66.67%] -translate-x-1/2 whitespace-nowrap font-semibold text-foreground">
              {`Deadline ${deadline} h`}
            </span>
          )}
        </div>
        <span className="text-right">Time left</span>
        <span />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-2">
        {stepCases(sup, nodeId).map((c) => {
          const tone = node === undefined ? "ok" : haloOf(node, [c]).state;
          const name = c.assignee === "" ? "" : userNameOf(users, c.assignee);
          return (
            <div
              key={c.case_id}
              data-case={c.case_id}
              className={`h-[41px] border-b border-[#f4f4f5] last:border-b-0 ${LIST_GRID}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11.5px]">{c.reference}</span>
                  {c.returned && (
                    <span className="rounded border border-[#fcd34d] px-1 text-[9.5px] font-semibold leading-[15px] text-[#b45309]">
                      Returned
                    </span>
                  )}
                </div>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {`${clientOf(def, c.data)} · ${amountOf(def, c.data)}`}
                </span>
              </div>
              <div className="relative h-2 rounded bg-[#f0f0f1]">
                <i
                  className={`absolute inset-y-0 left-0 rounded ${FILL_CLASS[tone]}`}
                  style={{ width: `${trackWidth(c.age_hours, deadline)}%` }}
                />
                {deadline !== null && (
                  <i className="absolute -inset-y-1 left-[66.67%] w-px bg-[#3f3f46] opacity-70" />
                )}
              </div>
              <span className={`whitespace-nowrap text-right text-xs font-semibold ${LEFT_CLASS[tone]}`}>
                {leftText(c, deadline)}
              </span>
              {name === "" ? (
                <span
                  title="No assignee"
                  className="grid size-6 place-items-center rounded-full border border-dashed border-zinc-300 text-[10px] font-semibold text-zinc-400"
                >
                  ?
                </span>
              ) : (
                <span
                  title={name}
                  className="grid size-6 place-items-center rounded-full bg-[#e7efed] text-[10px] font-semibold text-[#0f4c45]"
                >
                  {initials(name)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </aside>
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
  // The layout keeps its definition, so a new definition shows the
  // wait text, not the diagram of the previous process.
  const [drawn, setDrawn] = useState<{
    def: ProcessDefinition;
    layout: Layout | null;
  } | null>(null);
  const layout = drawn?.def === def ? drawn.layout : null;
  const layoutFailed = drawn?.def === def && drawn.layout === null;
  const block = blockOf(def, supervision, users);

  useEffect(() => {
    let live = true;
    layoutProcess(def).then(
      (next) => {
        if (live) {
          setDrawn({ def, layout: next });
        }
      },
      () => {
        if (live) {
          setDrawn({ def, layout: null });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [def]);

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
            <button
              type="button"
              onClick={() => setSelected(block.nodeId)}
              className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#b91c1c] hover:underline"
            >
              Open the step
              <ChevronRight aria-hidden className="size-3.5" />
            </button>
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
        <div className="flex h-10 items-center justify-between gap-4 border-b px-4">
          <h2 className="truncate text-[13.5px] font-semibold">
            {`${def.name}, live flow of the open cases`}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {`More dots where more cases pass (last ${flow.days} days). The halo shows the case ages against the step deadline.`}
          </p>
        </div>
        <div className="px-4 py-4">
          {layoutFailed ? (
            <p className="text-sm text-muted-foreground">
              The diagram could not be drawn.
            </p>
          ) : layout === null ? (
            <p className="text-sm text-muted-foreground">Drawing the diagram.</p>
          ) : (
            <LiveDiagram
              def={def}
              layout={layout}
              sup={supervision}
              flow={flow}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </div>
        <div className="border-t px-4 py-2">
          <FlowLegend />
        </div>
      </div>

      <div className="max-w-[480px] rounded-lg border bg-card">
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

      {selected !== null && (
        <StepPanel
          def={def}
          users={users}
          sup={supervision}
          nodeId={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
