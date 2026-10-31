// The right panel when no step is selected: an overview of the whole
// process. Structure health, the shortest path to approval, the roles
// and the data fields. A problem row selects its step; a role row
// lights the steps of that role on the diagram.

import { CircleAlert, CircleCheck } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { currencyLabel, currencyOptions } from "./format";
import { mainPath, roleColor } from "./layout";
import type { FieldType, ProcessDefinition } from "./types";

export interface StructureProblem {
  nodeId: string;
  text: string;
}

// The structure rules a reader checks first: every step is reached
// from the start, every step that is not an end goes on, every
// gateway has a default link, and every step can reach an end.
export function structureProblems(def: ProcessDefinition): StructureProblem[] {
  const out = new Map<string, string[]>();
  const add = (nodeId: string, text: string) =>
    out.set(nodeId, [...(out.get(nodeId) ?? []), text]);
  const next = (id: string) => def.edges.filter((e) => e.from === id).map((e) => e.to);
  const prev = (id: string) => def.edges.filter((e) => e.to === id).map((e) => e.from);
  const spread = (from: string[], step: (id: string) => string[]) => {
    const seen = new Set(from);
    const queue = [...from];
    while (queue.length > 0) {
      for (const n of step(queue.shift()!)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  };
  const starts = def.nodes.filter((n) => n.type === "start").map((n) => n.id);
  const ends = def.nodes.filter((n) => n.type === "end").map((n) => n.id);
  const reached = spread(starts, next);
  const ending = spread(ends, prev);
  for (const node of def.nodes) {
    const name = node.name;
    if (node.type !== "start" && !reached.has(node.id)) {
      add(node.id, `${name} is not reached from the start.`);
    }
    if (node.type !== "end" && next(node.id).length === 0) {
      add(node.id, `${name} has no outgoing link.`);
    } else if (node.type !== "end" && !ending.has(node.id)) {
      add(node.id, `No path from ${name} reaches an end.`);
    }
    if (
      node.type === "gateway" &&
      !def.edges.some((e) => e.from === node.id && e.is_default)
    ) {
      add(node.id, `${name} has no default link.`);
    }
  }
  return [...out].flatMap(([nodeId, texts]) => texts.map((text) => ({ nodeId, text })));
}

const TYPE_LABEL: Record<FieldType, string> = {
  string: "Text",
  enum: "Choice",
  number: "Number",
  money: "Money",
  integer: "Integer",
  boolean: "Yes or no",
  date: "Date",
  document: "Document",
};

function Section({ title, aside, children }: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {aside !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">{aside}</span>
        )}
      </div>
      {children}
    </section>
  );
}

// onCurrency is set only when the version can change (a draft in
// design mode); otherwise the currency is read only.
export function ProcessPanel({ def, onSelectNode, onHighlight, onCurrency }: {
  def: ProcessDefinition;
  onSelectNode: (nodeId: string) => void;
  onHighlight: (nodeIds: string[] | null) => void;
  onCurrency?: (code: string) => void;
}) {
  const problems = structureProblems(def);
  const tasks = def.nodes.filter((n) => n.type === "task");
  const path = mainPath(def) ?? [];
  const pathTasks = path
    .map((id) => def.nodes.find((n) => n.id === id)!)
    .filter((n) => n.type === "task");
  const pathHours = pathTasks.reduce((sum, n) => sum + (n.deadline_hours ?? 0), 0);
  const approved = def.nodes.some((n) => n.id === path[path.length - 1] && n.end_result === "approved");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="px-4 pt-3.5 pb-3">
        <p className="text-xs text-muted-foreground">Process</p>
        <h2 className="text-[17px] font-semibold leading-tight">{def.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {`${def.nodes.length} steps, ${def.edges.length} links. Select a step to edit it.`}
        </p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Currency</span>
          {onCurrency === undefined ? (
            <span className="text-[13px]">{currencyLabel(def.currency)}</span>
          ) : (
            <Select value={def.currency} onValueChange={onCurrency}>
              <SelectTrigger aria-label="Currency" size="sm" className="w-48">
                <SelectValue>{currencyLabel(def.currency)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {currencyOptions(def.currency).map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </header>

      <Section title="Structure">
        {problems.length === 0 ? (
          <p className="flex items-start gap-2 text-[13px] text-zinc-700">
            <CircleCheck size={16} className="mt-px shrink-0 text-green-600" />
            Every step is reached from the start, and every path ends.
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {problems.map((p, i) => (
              <li key={`${p.nodeId}-${i}`}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-100"
                  onClick={() => onSelectNode(p.nodeId)}
                >
                  <CircleAlert size={16} className="mt-px shrink-0 text-red-600" />
                  {p.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {pathTasks.length > 0 && (
        <Section title={approved ? "Shortest path to approval" : "Shortest path to an end"}>
          <button
            type="button"
            className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100"
            onMouseEnter={() => onHighlight(path)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(path)}
            onBlur={() => onHighlight(null)}
          >
            <span className="text-[13px] text-zinc-700">
              {`${pathTasks.length} tasks, up to ${pathHours} h`}
              {pathHours >= 24 && (
                <span className="text-muted-foreground">{` (${Math.round(pathHours / 24)} days)`}</span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {pathTasks.map((n) => n.name).join(", then ")}
            </span>
          </button>
        </Section>
      )}

      <Section title="Roles" aside={`${def.roles.length}`}>
        <ul className="-mx-2 flex flex-col">
          {def.roles.map((role) => {
            const ids = tasks.filter((n) => n.role === role.id).map((n) => n.id);
            const color = roleColor(def, role.id) ?? "#a1a1aa";
            return (
              <li key={role.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100"
                  onMouseEnter={() => onHighlight(ids)}
                  onMouseLeave={() => onHighlight(null)}
                  onFocus={() => onHighlight(ids)}
                  onBlur={() => onHighlight(null)}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{role.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{role.department}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {ids.length === 1 ? "1 step" : `${ids.length} steps`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Data" aside={`${def.fields.length}`}>
        <ul className="flex flex-col gap-1.5">
          {def.fields.map((field) => (
            <li key={field.name} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate">{field.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {field.computed !== null ? "Computed" : TYPE_LABEL[field.type]}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
