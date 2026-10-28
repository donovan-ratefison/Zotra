// The step screen: the step the case rests on, the act-as pick, the
// form from the fields and the scope, and the actions. It renders
// one command at a time through onCommand; TestScreen owns the case
// and the command answers.

import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { FieldInput, fieldInput } from "./field-inputs";
import { documentProvides, StepDocuments } from "./StepDocuments";
import type {
  CaseEvent,
  CaseState,
  CommandInput,
  UserDTO,
} from "./case-api";
import type { DocumentDTO } from "./doc-api";
import type { Field, ProcessDefinition, ProcessNode, ScopeAccess } from "./types";

const TYPE_TEXT: Record<string, string> = {
  start: "Start",
  task: "Task",
  gateway: "Gateway",
  end: "End",
};

// accessOf gives the access of one field on one node: the
// scope_overrides row of the node for (field, role) when present,
// else the scope row of the definition, else hidden. The contract
// does not force a scope row for every pair; a field without a row
// does not show. The inspector reuses the rule for its scope column.
export function accessOf(field: Field, node: ProcessNode, def: ProcessDefinition): ScopeAccess {
  const role = node.role;
  if (role !== null) {
    const over = node.scope_overrides.find(
      (row) => row.field === field.name && row.role === role,
    );
    if (over !== undefined) {
      return over.access;
    }
  }
  const row = role === null
    ? def.scope.find((r) => r.field === field.name)
    : def.scope.find((r) => r.field === field.name && r.role === role);
  return row === undefined ? "hidden" : row.access;
}

export function StepScreen({ def, state, users, actor, onActorChange, onCommand, failedChecks, decisionEnabled, onValueChange, readOnly = false, documents, documentsError, events, uploading, onUpload }: {
  def: ProcessDefinition;
  state: CaseState;
  users: UserDTO[];
  actor: string;
  onActorChange: (id: string) => void;
  onCommand: (cmd: CommandInput) => void;
  failedChecks: { id: string; message: string }[];
  decisionEnabled: boolean;
  onValueChange: () => void;
  readOnly?: boolean;
  documents: DocumentDTO[] | null;
  documentsError: string | null;
  events: CaseEvent[];
  uploading: boolean;
  onUpload: (file: File, targetName: string) => void;
}) {
  if (state.status === "closed") {
    return (
      <div className="flex flex-col gap-2 px-4 pt-3.5">
        <h2 className="text-[17px] font-semibold leading-tight">Case closed</h2>
        <p className="text-sm text-muted-foreground">{`Result: ${state.result}.`}</p>
      </div>
    );
  }

  const node = def.nodes.find((n) => n.id === state.node_id);
  if (node === undefined) {
    return null;
  }
  const roleName =
    node.role === null
      ? null
      : def.roles.find((r) => r.id === node.role)?.name ?? node.role;

  return (
    <div className="flex flex-col gap-3 px-4 pt-3.5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {TYPE_TEXT[node.type] ?? node.type}
        </span>
        <h2 className="text-[17px] font-semibold leading-tight">{node.name}</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {roleName !== null && (
            <span className="rounded-full border px-2 py-0.5">{roleName}</span>
          )}
          {node.deadline_hours !== null && <span>{node.deadline_hours} h</span>}
        </div>
      </div>

      {readOnly && (
        <p className="text-sm text-muted-foreground">
          Replay: the commands wait for the present.
        </p>
      )}

      {node.type !== "task" ? (
        <p className="text-sm text-muted-foreground">
          This step runs on its own.
        </p>
      ) : (
        <TaskBody
          def={def}
          node={node}
          state={state}
          users={users}
          actor={actor}
          onActorChange={onActorChange}
          onCommand={onCommand}
          failedChecks={failedChecks}
          decisionEnabled={decisionEnabled}
          onValueChange={onValueChange}
          readOnly={readOnly}
          documents={documents}
          documentsError={documentsError}
          events={events}
          uploading={uploading}
          onUpload={onUpload}
        />
      )}
    </div>
  );
}

// TaskBody is the task-only part: the Act as pick, then the take
// button or the form with the actions. A replay disables the pick and
// hides the commands.
function TaskBody({ def, node, state, users, actor, onActorChange, onCommand, failedChecks, decisionEnabled, onValueChange, readOnly, documents, documentsError, events, uploading, onUpload }: {
  def: ProcessDefinition;
  node: ProcessNode;
  state: CaseState;
  users: UserDTO[];
  actor: string;
  onActorChange: (id: string) => void;
  onCommand: (cmd: CommandInput) => void;
  failedChecks: { id: string; message: string }[];
  decisionEnabled: boolean;
  onValueChange: () => void;
  readOnly: boolean;
  documents: DocumentDTO[] | null;
  documentsError: string | null;
  events: CaseEvent[];
  uploading: boolean;
  onUpload: (file: File, targetName: string) => void;
}) {
  // The users whose roles contain the node role (all users on a
  // node without a role).
  const list = users.filter(
    (u) => node.role === null || u.role_ids.includes(node.role),
  );

  // The effect fires with the assignee when one is set, else with
  // the first list entry when the actor is not in the list: what the
  // screen shows is what the commands send. The wiring depends on
  // the step and on who owns it.
  useEffect(() => {
    if (state.assignee !== "") {
      onActorChange(state.assignee);
      return;
    }
    const list = users.filter(
      (u) => node.role === null || u.role_ids.includes(node.role),
    );
    if (list.length > 0 && !list.some((u) => u.id === actor)) {
      onActorChange(list[0]!.id);
    }
  }, [state.node_id, state.assignee, users, node.role, actor, onActorChange]);

  // What the screen shows is what the commands send: the assignee
  // when one is set, else the actor, else the first entry.
  const selectValue =
    state.assignee !== ""
      ? state.assignee
      : list.some((u) => u.id === actor)
        ? actor
        : (list[0]?.id ?? "");
  // A closed Radix select renders no selected label on the server,
  // so the label goes in as children (the lot 2.3 pattern).
  const selectLabel = list.find((u) => u.id === selectValue)?.name ?? "";

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Act as</span>
        <Select value={selectValue} onValueChange={onActorChange} disabled={readOnly}>
          <SelectTrigger aria-label="Act as" className="w-full">
            <SelectValue>{selectLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {list.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {state.assignee === "" ? (
        <div className="flex flex-col gap-3">
          {!readOnly && (
            <Button onClick={() => onCommand({ type: "take" })}>
              Take the step
            </Button>
          )}
          <FailedChecks failedChecks={failedChecks} />
        </div>
      ) : (
        // The key remounts the form at each step change, so the local
        // values reset without an effect.
        <StepForm
          key={state.node_id}
          def={def}
          node={node}
          state={state}
          onCommand={onCommand}
          failedChecks={failedChecks}
          decisionEnabled={decisionEnabled}
          onValueChange={onValueChange}
          readOnly={readOnly}
          documents={documents}
          documentsError={documentsError}
          events={events}
          uploading={uploading}
          onUpload={onUpload}
        />
      )}
    </div>
  );
}

// StepForm is the taken-step part: the write and read fields with
// the local values, and the actions. The key on the parent render
// resets the values at each step change. A replay disables the
// inputs and hides the actions.
function StepForm({ def, node, state, onCommand, failedChecks, decisionEnabled, onValueChange, readOnly, documents, documentsError, events, uploading, onUpload }: {
  def: ProcessDefinition;
  node: ProcessNode;
  state: CaseState;
  onCommand: (cmd: CommandInput) => void;
  failedChecks: { id: string; message: string }[];
  decisionEnabled: boolean;
  onValueChange: () => void;
  readOnly: boolean;
  documents: DocumentDTO[] | null;
  documentsError: string | null;
  events: CaseEvent[];
  uploading: boolean;
  onUpload: (file: File, targetName: string) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  // The document gate: each required name is provided by one scan,
  // and a node with a signature needs a signature_added event for
  // this step. While the documents list loads, every required name
  // counts as missing.
  const list = documents ?? [];
  const missing = node.documents.filter(
    (name) => !list.some((d) => documentProvides(d.name, name)),
  );
  const documentsReady = documents !== null && missing.length === 0;
  const signed = events.some(
    (e) =>
      e.type === "signature_added" &&
      (e.payload as { node_id?: string }).node_id === state.node_id,
  );
  const blocked = !documentsReady || (node.signature && !signed);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {def.fields.map((field) => {
          const access = accessOf(field, node, def);
          if (access === "hidden") {
            return null;
          }
          // A computed field renders read-only whatever its access:
          // the engine computes it.
          if (access === "read" || field.computed !== null) {
            return (
              <div key={field.name} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{field.label}</span>
                <span className="text-sm text-muted-foreground">
                  {fieldInput(field, state.data[field.name])}
                </span>
              </div>
            );
          }
          return (
            <label key={field.name} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{field.label}</span>
              <FieldInput
                field={field}
                value={values[field.name] ?? state.data[field.name]}
                onChange={(v) => {
                  setValues((old) => ({ ...old, [field.name]: v }));
                  onValueChange();
                }}
                disabled={readOnly}
                scans={list.map((d) => ({ id: d.id, name: d.name }))}
              />
            </label>
          );
        })}
      </div>
      {(node.documents.length > 0 || node.signature) && (
        <StepDocuments
          node={node}
          documents={documents}
          documentsError={documentsError}
          uploading={uploading}
          onUpload={onUpload}
          onCommand={onCommand}
          signed={signed}
          readOnly={readOnly}
        />
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={node.decisions.length > 0 ? "outline" : "default"}
            disabled={blocked}
            onClick={() => onCommand({ type: "submit", values })}
          >
            Submit
          </Button>
          {node.decisions.map((decision) => (
            <Button
              key={decision}
              disabled={!decisionEnabled || blocked}
              onClick={() => onCommand({ type: "decide", decision })}
            >
              {decision}
            </Button>
          ))}
        </div>
      )}
      {!readOnly && blocked && (
        <div className="flex flex-col gap-1">
          {missing.map((name) => (
            <p key={name} className="text-destructive text-sm">
              {`Missing document: ${name}.`}
            </p>
          ))}
          {node.signature && !signed && (
            <p className="text-destructive text-sm">
              The step has no signature yet.
            </p>
          )}
        </div>
      )}
      <FailedChecks failedChecks={failedChecks} />
    </div>
  );
}

// FailedChecks lists the failed checks of the last command, one line
// each. The list clears when TestScreen starts the next command.
function FailedChecks({ failedChecks }: {
  failedChecks: { id: string; message: string }[];
}) {
  if (failedChecks.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      {failedChecks.map((check) => (
        <p key={check.id} className="text-destructive text-sm">
          {`Check ${check.id}: ${check.message}`}
        </p>
      ))}
    </div>
  );
}
