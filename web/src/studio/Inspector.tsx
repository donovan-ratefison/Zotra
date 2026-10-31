// The inspector of the test screen: the data before and after the
// current position, as a list or as JSON, with the scope of each
// field for the role of the node. The view and the Only changes
// state are local to the inspector; TestScreen passes only the data.

import { useState } from "react";
import { Checkbox } from "@/ui/checkbox";
import { valueText } from "./format";
import { accessOf } from "./StepScreen";
import type { ProcessDefinition, ScopeAccess } from "./types";

const SCOPE_TEXT: Record<ScopeAccess, [letter: string, title: string]> = {
  read: ["R", "Read"],
  write: ["W", "Write"],
  hidden: ["H", "Hidden"],
};

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
        <ul aria-label="Fields" className="flex flex-col divide-y rounded-lg border text-[13px]">
          {fields.map((field) => {
            const isAdded = !(field.name in before);
            const isChanged = changed(field.name);
            const access =
              hasRole && node !== undefined
                ? accessOf(field, node, def)
                : null;
            const show = (side: Record<string, unknown>) =>
              field.name in side ? valueText(field, side[field.name], def.currency) : "-";
            return (
              <li
                key={field.name}
                className={`flex items-start gap-2 px-2.5 py-1.5 ${
                  isAdded ? "bg-[#dcfce7]" : isChanged ? "bg-[#fef3c7]" : ""
                }`}
              >
                <span className="w-[42%] shrink-0 break-words text-muted-foreground" title={field.label}>
                  {field.label}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  {isChanged && !isAdded && (
                    <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                      {show(before)}
                    </span>
                  )}
                  {isChanged && !isAdded && <span className="mx-1 text-muted-foreground">→</span>}
                  <span className={isChanged ? "font-medium" : undefined}>{show(after)}</span>
                  {isChanged && field.computed !== null && (
                    <span className="ml-1 rounded border px-1 text-[10px]">
                      computed
                    </span>
                  )}
                </span>
                {access !== null && (
                  <span
                    title={SCOPE_TEXT[access][1]}
                    className="shrink-0 rounded border px-1 font-mono text-[10.5px] text-muted-foreground"
                  >
                    {SCOPE_TEXT[access][0]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
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
        {hasRole && <span>R Read · W Write · H Hidden</span>}
      </div>
    </div>
  );
}
