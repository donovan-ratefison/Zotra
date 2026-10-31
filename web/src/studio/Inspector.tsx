// The inspector of the test screen: the data before and after the
// current position, as a list or as JSON, with the scope of each
// field for the role of the node. The view and the Only changes
// state are local to the inspector; TestScreen passes only the data.

import { useState } from "react";
import { Checkbox } from "@/ui/checkbox";
import { valueText } from "./format";
import { accessOf } from "./StepScreen";
import type { CaseEvent } from "./case-api";
import type { ProcessDefinition, ScopeAccess } from "./types";

const SCOPE_TEXT: Record<ScopeAccess, [letter: string, title: string]> = {
  read: ["R", "Read"],
  write: ["W", "Write"],
  hidden: ["H", "Hidden"],
};

// scopeNodeOf gives the node whose role sets the scope: the node of the
// position if it has a role, else the last entered step with a role
// (the position is on a start, gateway or end node).
export function scopeNodeOf(
  def: ProcessDefinition,
  events: CaseEvent[],
  nodeId: string,
): string {
  const withRole = (id: unknown) =>
    def.nodes.some((nd) => nd.id === id && nd.role !== null);
  if (withRole(nodeId)) return nodeId;
  const last = [...events]
    .reverse()
    .find((e) => e.type === "step_entered" && withRole(e.payload.node_id));
  return last !== undefined ? String(last.payload.node_id) : nodeId;
}

export function Inspector({
  def,
  before,
  after,
  nodeId,
  initialView = "list",
  initialOnlyChanges = false,
}: {
  def: ProcessDefinition;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  nodeId: string;
  initialView?: "list" | "json"; // test seam, the defaults hold the brief values
  initialOnlyChanges?: boolean;
}) {
  const [view, setView] = useState<"list" | "json">(initialView);
  const [onlyChanges, setOnlyChanges] = useState(initialOnlyChanges);

  const node = def.nodes.find((nd) => nd.id === nodeId);
  const hasRole = node !== undefined && node.role !== null;

  // Compare by JSON: arrays and objects are new objects at each event.
  const changed = (name: string) =>
    !(name in before) ||
    !(name in after) ||
    JSON.stringify(before[name]) !== JSON.stringify(after[name]);
  const fields = def.fields.filter(
    (f) =>
      (f.name in before || f.name in after) &&
      (!onlyChanges || changed(f.name)),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div
          role="group"
          aria-label="View"
          className="flex overflow-hidden rounded-md border text-sm"
        >
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            className={`px-2 py-1 ${
              view === "list"
                ? "bg-secondary font-medium"
                : "text-muted-foreground"
            }`}
          >
            List
          </button>
          <button
            type="button"
            aria-pressed={view === "json"}
            onClick={() => setView("json")}
            className={`px-2 py-1 ${
              view === "json"
                ? "bg-secondary font-medium"
                : "text-muted-foreground"
            }`}
          >
            JSON
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            aria-label="Only changes"
            checked={onlyChanges}
            onCheckedChange={(v) => setOnlyChanges(v === true)}
          />
          Only changes
        </label>
      </div>

      {view === "list" ? (
        <div className="overflow-hidden rounded-lg border">
          <table aria-label="Fields" className="w-full table-fixed border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] font-medium text-muted-foreground">
                <th className="w-[36%] px-2.5 py-1.5 font-medium">Field</th>
                <th className="px-2.5 py-1.5 font-medium">Before</th>
                <th className="px-2.5 py-1.5 font-medium">After</th>
                {hasRole && <th className="w-14 px-2.5 py-1.5 text-center font-medium">Scope</th>}
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => {
                const isAdded = !(field.name in before);
                const isChanged = changed(field.name);
                const access =
                  hasRole && node !== undefined ? accessOf(field, node, def) : null;
                const show = (side: Record<string, unknown>) =>
                  field.name in side ? (
                    valueText(field, side[field.name], def.currency)
                  ) : (
                    <i className="text-muted-foreground">absent</i>
                  );
                return (
                  <tr
                    key={field.name}
                    className={`border-t ${
                      isAdded ? "bg-[#dcfce7]" : isChanged ? "bg-[#fef3c7]" : ""
                    }`}
                  >
                    <td
                      className={`border-l-[3px] px-2.5 py-1.5 align-top ${
                        isAdded
                          ? "border-l-green-600"
                          : isChanged
                            ? "border-l-amber-500"
                            : "border-l-transparent"
                      }`}
                    >
                      <span className="break-words text-muted-foreground" title={field.label}>
                        {field.label}
                      </span>
                    </td>
                    <td className="break-words px-2.5 py-1.5 align-top">{show(before)}</td>
                    <td className="break-words px-2.5 py-1.5 align-top">
                      <span className={isChanged ? "font-medium" : undefined}>{show(after)}</span>
                      {isChanged && field.computed !== null && (
                        <span className="ml-1 rounded border px-1 text-[10px]">
                          computed
                        </span>
                      )}
                    </td>
                    {access !== null && (
                      <td className="px-2.5 py-1.5 text-center align-top">
                        <span
                          title={SCOPE_TEXT[access][1]}
                          className="rounded border px-1 font-mono text-[10.5px] text-muted-foreground"
                        >
                          {SCOPE_TEXT[access][0]}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="font-mono text-[12px]">
          {fields.map((field, i) => {
            const isChanged = changed(field.name);
            return (
              <div key={field.name}>
                {`${JSON.stringify(field.name)}: ${
                  field.name in after
                    ? JSON.stringify(after[field.name])
                    : "-"
                }${i < fields.length - 1 ? "," : ""}`}
                {isChanged && (
                  <span className="text-muted-foreground">
                    {!(field.name in before)
                      ? " // added"
                      : ` // before: ${JSON.stringify(before[field.name])}`}
                  </span>
                )}
              </div>
            );
          })}
        </pre>
      )}

      <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-[#dcfce7]" />
          Added
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-[#fef3c7]" />
          Modified
        </span>
        {hasRole && node !== undefined && (
          <span>{`Scope of ${node.name}: R Read · W Write · H Hidden`}</span>
        )}
      </div>
    </div>
  );
}
