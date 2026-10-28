// The inspector of the test screen: the data before and after the
// current position, as a list or as JSON, with the scope of each
// field for the role of the node. The view and the Only changes
// state are local to the inspector; TestScreen passes only the data.

import { useState } from "react";
import { Checkbox } from "@/ui/checkbox";
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

  // A field changed when a side misses it, or when both sides hold it
  // and the values differ (strict JSON inequality).
  const changed = (name: string) =>
    !(name in before) || !(name in after) || before[name] !== after[name];
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Field</th>
              <th className="py-1 pr-2 font-medium">Before</th>
              <th className="py-1 pr-2 font-medium">After</th>
              {hasRole && <th className="py-1 font-medium">Scope</th>}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const isAdded = !(field.name in before);
              const isChanged = changed(field.name);
              const access =
                hasRole && node !== undefined
                  ? accessOf(field, node, def)
                  : null;
              return (
                <tr
                  key={field.name}
                  className={
                    isAdded
                      ? "bg-[#bbf7d0]"
                      : isChanged
                        ? "bg-[#fde68a]"
                        : undefined
                  }
                >
                  <td className="py-1 pr-2">{field.label}</td>
                  <td className="py-1 pr-2">
                    {field.name in before
                      ? JSON.stringify(before[field.name])
                      : "-"}
                  </td>
                  <td className="py-1 pr-2">
                    {field.name in after
                      ? JSON.stringify(after[field.name])
                      : "-"}
                    {isChanged && field.computed !== null && (
                      <span className="ml-1 rounded border px-1 text-[10px]">
                        computed
                      </span>
                    )}
                  </td>
                  {access !== null && (
                    <td title={SCOPE_TEXT[access][1]}>{SCOPE_TEXT[access][0]}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
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
          <span className="inline-block size-3 bg-[#bbf7d0]" />
          Added
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 bg-[#fde68a]" />
          Modified
        </span>
        {hasRole && <span>R Read · W Write · H Hidden</span>}
      </div>
    </div>
  );
}
