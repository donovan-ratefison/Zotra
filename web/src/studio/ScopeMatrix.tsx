// The data scope matrix of one node: one row per field, one column
// per role. An override row of the node marks its cell with a dot,
// an outline and the process value in the title.

import { roleColor } from "./layout";
import { setScopeOverride } from "./node-edit";
import type {
  ProcessDefinition,
  ProcessNode,
  ScopeAccess,
} from "./types";

const ACCESS_LETTER: Record<ScopeAccess, string> = {
  read: "R",
  write: "W",
  hidden: "H",
};

const ACCESS_NAME: Record<ScopeAccess, string> = {
  read: "Read",
  write: "Write",
  hidden: "Hidden",
};

const NEXT_ACCESS: Record<ScopeAccess, ScopeAccess> = {
  read: "write",
  write: "hidden",
  hidden: "read",
};

// One look per access value, close to the mockup pills.
const PILL_CLASS: Record<ScopeAccess, string> = {
  read: "border border-zinc-200 bg-white text-zinc-700",
  write: "border border-transparent bg-primary text-primary-foreground",
  hidden: "border border-dashed border-zinc-400 text-zinc-500",
};

export function ScopeMatrix({
  def,
  node,
  editable,
  onChange,
}: {
  def: ProcessDefinition;
  node: ProcessNode;
  editable: boolean;
  onChange?: (def: ProcessDefinition) => void;
}) {
  // The process scope row always exists (the contract binds each
  // scope_overrides row to an existing field and role). The fallback
  // only keeps contract-breaking data from crashing the render.
  const processRow = (field: string, role: string): ScopeAccess =>
    def.scope.find((r) => r.field === field && r.role === role)?.access ??
    "hidden";
  const overrideRow = (field: string, role: string) =>
    node.scope_overrides.find((r) => r.field === field && r.role === role);

  const currentColumn = def.roles.findIndex((role) => role.id === node.role);

  return (
    <table
      aria-label="Data scope"
      className="w-full border-separate border-spacing-0 text-xs"
    >
      <thead>
        <tr>
          <th className="pb-1.5 text-left font-medium text-muted-foreground">
            Field
          </th>
          {def.roles.map((role, i) => (
            <th
              key={role.id}
              className={`pb-1.5 text-center align-bottom font-medium text-muted-foreground${
                i === currentColumn ? " rounded-t-md bg-muted/40" : ""
              }`}
            >
              <span
                className="mx-auto mb-1 block size-2 rounded-full"
                style={{ backgroundColor: roleColor(def, role.id) ?? "#a1a1aa" }}
                aria-hidden="true"
              />
              {role.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {def.fields.map((field) => {
          const rowOverridden = def.roles.some(
            (role) => overrideRow(field.name, role.id) !== undefined,
          );
          return (
            <tr key={field.name}>
              <td className="border-t py-1.5 pr-2 align-middle leading-tight">
                {field.label}
                {rowOverridden && (
                  <span className="block text-[10px] text-muted-foreground">
                    Overridden here
                  </span>
                )}
              </td>
              {def.roles.map((role, i) => {
                const ovr = overrideRow(field.name, role.id);
                const value = ovr?.access ?? processRow(field.name, role.id);
                const cellClass =
                  i === currentColumn ? " bg-muted/40" : "";
                return (
                  <td
                    key={role.id}
                    className={`border-t py-1.5 text-center align-middle${cellClass}`}
                  >
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={() =>
                        onChange?.(
                          setScopeOverride(
                            def,
                            node.id,
                            field.name,
                            role.id,
                            NEXT_ACCESS[value],
                          ),
                        )
                      }
                      aria-label={`${field.label}, ${role.name}: ${ACCESS_NAME[value]}${
                        ovr ? ", overridden here" : ""
                      }`}
                      title={
                        ovr
                          ? `Process: ${ACCESS_LETTER[processRow(field.name, role.id)]}`
                          : undefined
                      }
                      className={`inline-grid place-items-center rounded-md font-mono text-[11.5px] font-semibold leading-none size-8 ${PILL_CLASS[value]}${
                        ovr
                          ? " outline-2 outline-amber-500 [outline-style:solid]"
                          : ""
                      }${editable ? " cursor-pointer" : " cursor-not-allowed opacity-60"}`}
                    >
                      {ovr && (
                        <span
                          className="mr-0.5 inline-block size-1.5 rounded-full bg-amber-500"
                          aria-hidden="true"
                        />
                      )}
                      {ACCESS_LETTER[value]}
                    </button>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
