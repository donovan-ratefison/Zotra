// The Screen tab of the step panel: a preview of the step screen as
// the role of the step sees it, in the brand theme, then the list of
// the form fields with their access. The designer drags a field to
// change the order of the forms. The order belongs to the data model,
// so it applies to every screen.

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Hint } from "@/ui/hint";
import { moveField } from "./node-edit";
import { accessOf } from "./StepScreen";
import type { Field, ProcessDefinition, ProcessNode } from "./types";

const TYPE_HINT: Record<string, string> = {
  string: "Text",
  money: "Amount",
  integer: "Number",
  number: "Number",
  boolean: "Yes or no",
  date: "Date",
  enum: "Choice",
  document: "Scans",
};

// Preview is the screen card: brand header, step title, the read
// values, the inputs, the documents and the action buttons. Nothing
// in it reacts: it shows the layout, not a case.
function Preview({ def, node, reads, writes }: {
  def: ProcessDefinition;
  node: ProcessNode;
  reads: Field[];
  writes: Field[];
}) {
  const role = def.roles.find((r) => r.id === node.role);
  const brand = def.theme.primary_color;
  return (
    <div aria-hidden className="overflow-hidden rounded-lg border shadow-sm">
      <div
        className="flex items-center justify-between px-3 py-2 text-[12px] font-semibold text-white"
        style={{ background: brand }}
      >
        <span className="truncate">{def.theme.brand_name}</span>
        <span className="truncate font-normal opacity-85">{role?.name ?? ""}</span>
      </div>
      <div className="flex flex-col gap-2.5 bg-card px-3 py-3">
        <div>
          <p className="text-[14px] font-semibold leading-tight">{node.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {node.deadline_hours === null
              ? "No deadline"
              : `Case reference · due in ${node.deadline_hours} h`}
          </p>
        </div>
        {reads.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {reads.map((f) => (
              <div key={f.name} className="min-w-0">
                <dt className="truncate text-[10.5px] text-muted-foreground">{f.label}</dt>
                <dd className="truncate text-[11.5px] font-medium text-muted-foreground/80">
                  {TYPE_HINT[f.type] ?? f.type}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {writes.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {writes.map((f) => (
              <div key={f.name} className={`min-w-0 ${f.type === "enum" || f.type === "document" ? "col-span-2" : ""}`}>
                <p className="truncate text-[10.5px] font-medium">{f.label}</p>
                {f.type === "enum" ? (
                  <div className="mt-0.5 flex gap-1">
                    {f.options.map((o) => (
                      <span key={o} className="flex-1 truncate rounded border px-1.5 py-1 text-center text-[10.5px] capitalize">
                        {o}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-0.5 h-6 rounded border bg-background" />
                )}
              </div>
            ))}
          </div>
        )}
        {node.documents.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="text-[10.5px] font-medium">Documents</p>
            {node.documents.map((d) => (
              <p key={d} className="truncate text-[11px] text-muted-foreground">{`· ${d}`}</p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-1.5 border-t pt-2">
          {(node.decisions.length > 0 ? node.decisions : ["Submit"]).map((d) => (
            <span
              key={d}
              className="rounded px-2.5 py-1 text-[11px] font-medium capitalize text-white"
              style={{ background: brand }}
            >
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const ACCESS_TEXT = {
  write: ["Write", "text-blue-700"],
  read: ["Read", "text-muted-foreground"],
} as const;

export function ScreenPane({ def, node, editable, onChange }: {
  def: ProcessDefinition;
  node: ProcessNode;
  editable: boolean;
  onChange: (next: ProcessDefinition) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  if (node.type !== "task") {
    return (
      <p className="text-[13px] text-muted-foreground">
        Only tasks have a screen. This step runs on its own.
      </p>
    );
  }

  const visible = def.fields.filter((f) => accessOf(f, node, def) !== "hidden");
  const hidden = def.fields.length - visible.length;
  const reads = visible.filter(
    (f) => f.type !== "document" && (accessOf(f, node, def) === "read" || f.computed !== null),
  );
  const writes = visible.filter(
    (f) => accessOf(f, node, def) === "write" && f.computed === null,
  );
  const role = def.roles.find((r) => r.id === node.role);
  const move = (name: string, to: string) => onChange(moveField(def, name, to));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[12.5px] font-medium">{`Preview for ${role?.name ?? "the role"}`}</p>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]">
          <span className="size-2 rounded-full" style={{ background: def.theme.primary_color }} />
          {def.theme.brand_name}
        </span>
      </div>
      <Preview def={def} node={node} reads={reads} writes={writes} />

      <div className="flex items-center gap-1.5 pt-1">
        <p className="text-[12.5px] font-medium">Form fields</p>
        <Hint label="About the form fields">
          Drag the handles to change the order. The order applies to every
          screen of the process. The access of a field comes from Data and
          scope.
        </Hint>
      </div>
      <ul aria-label="Form fields" className="overflow-hidden rounded-lg border">
        {visible.map((f, i) => {
          const access = f.computed !== null ? "read" : (accessOf(f, node, def) as "read" | "write");
          const [text, cls] = ACCESS_TEXT[access];
          return (
            <li
              key={f.name}
              draggable={editable}
              onDragStart={() => setDragged(f.name)}
              onDragEnd={() => {
                setDragged(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (dragged !== null) {
                  e.preventDefault();
                  setOver(f.name);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged !== null) {
                  move(dragged, f.name);
                }
                setDragged(null);
                setOver(null);
              }}
              className={`group flex items-center gap-2 border-b px-2 py-1.5 text-[12.5px] last:border-b-0 ${
                over === f.name && dragged !== f.name ? "bg-blue-50" : ""
              } ${dragged === f.name ? "opacity-50" : ""}`}
            >
              <GripVertical
                aria-hidden
                className={`size-3.5 shrink-0 text-muted-foreground ${editable ? "cursor-grab" : "opacity-40"}`}
              />
              <span className="min-w-0 flex-1 truncate">{f.label}</span>
              {f.computed !== null && (
                <span className="text-[10.5px] text-muted-foreground">computed</span>
              )}
              <span className={`text-[11.5px] ${cls}`}>{text}</span>
              {editable && (
                <span className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    aria-label={`Move ${f.label} up`}
                    disabled={i === 0}
                    onClick={() => move(f.name, visible[i - 1]!.name)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${f.label} down`}
                    disabled={i === visible.length - 1}
                    onClick={() => move(f.name, visible[i + 1]!.name)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {`${hidden} ${hidden === 1 ? "field is" : "fields are"} hidden for this role (see Data and scope).`}
        </p>
      )}
    </div>
  );
}
