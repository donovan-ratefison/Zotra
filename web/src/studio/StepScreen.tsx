// The step screen: the step the case rests on, the act-as pick, the
// form from the fields and the scope, and the actions. It renders
// one command through onCommand, or a decision chain through
// onDecide. The parent owns the case and the command answers.
//
// Layout rule: the form is compact (two columns, read values as a
// short summary) and the actions sit in a footer that sticks to the
// bottom of the scroll container, so the submit button never hides
// under a scroll.

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import { Hint } from "@/ui/hint";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { decisionLabel } from "../app/triage";
import { FieldInput } from "./field-inputs";
import { valueText } from "./format";
import { roleColor } from "./layout";
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

// actorsFor gives the users who can act on the node: the users whose
// roles hold the node role, or every user on a node without a role.
export function actorsFor(users: UserDTO[], node: ProcessNode): UserDTO[] {
  return users.filter((u) => node.role === null || u.role_ids.includes(node.role));
}

// shownActor gives the user the screen shows, which is the user the
// commands send: the assignee when one is set, else the actor when
// the list holds it, else the first entry.
export function shownActor(users: UserDTO[], node: ProcessNode, state: CaseState, actor: string): string {
  if (state.assignee !== "") {
    return state.assignee;
  }
  const list = actorsFor(users, node);
  return list.some((u) => u.id === actor) ? actor : (list[0]?.id ?? "");
}

// ActorSelect is the Act as pick of one task node. The test screen
// renders it in its toolbar; the step screen renders it when no
// toolbar holds it.
export function ActorSelect({ users, node, state, actor, onActorChange, disabled, className }: {
  users: UserDTO[];
  node: ProcessNode;
  state: CaseState;
  actor: string;
  onActorChange: (id: string) => void;
  disabled: boolean;
  className?: string;
}) {
  const list = actorsFor(users, node);
  const value = shownActor(users, node, state, actor);
  // A closed Radix select renders no selected label on the server,
  // so the label goes in as children (the lot 2.3 pattern).
  const label = list.find((u) => u.id === value)?.name ?? "";
  return (
    <Select value={value} onValueChange={onActorChange} disabled={disabled || state.assignee !== ""}>
      <SelectTrigger aria-label="Act as" className={className ?? "w-full"}>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {list.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// StepHeader is the title block of one node: the type and the step
// number, the name, then the role, the deadline and the documents.
export function StepHeader({ def, node }: { def: ProcessDefinition; node: ProcessNode }) {
  const roleName =
    node.role === null
      ? null
      : def.roles.find((r) => r.id === node.role)?.name ?? node.role;
  const color = roleColor(def, node.role);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {`${TYPE_TEXT[node.type] ?? node.type} · Step ${def.nodes.indexOf(node) + 1}`}
      </span>
      <h2 className="text-[17px] font-semibold leading-tight">{node.name}</h2>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {roleName !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5">
            {color !== null && (
              <span className="size-1.5 rounded-full" style={{ background: color }} />
            )}
            {roleName}
          </span>
        )}
        {node.deadline_hours !== null && (
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
            {`Deadline ${node.deadline_hours} h`}
          </span>
        )}
        {node.documents.length > 0 && (
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
            {`${node.documents.length} ${node.documents.length === 1 ? "document" : "documents"} required`}
          </span>
        )}
      </div>
    </div>
  );
}

// Footer is the sticky action bar at the bottom of the scroll
// container.
function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-1.5 border-t bg-background px-4 py-3">
      {children}
    </div>
  );
}

export function StepScreen({ def, state, users, actor, onActorChange, onCommand, onDecide, failedChecks, readOnly = false, actorLocked = false, actorInBar = false, showHeader = true, finalData = false, documents, documentsError, events, uploading, onUpload, showSummary = true, checkResult }: {
  def: ProcessDefinition;
  state: CaseState;
  users: UserDTO[];
  actor: string;
  onActorChange: (id: string) => void;
  onCommand: (cmd: CommandInput) => void;
  onDecide: (cmds: CommandInput[]) => void;
  failedChecks: { id: string; message: string }[];
  readOnly?: boolean;
  actorLocked?: boolean;
  actorInBar?: boolean; // the caller renders ActorSelect in its toolbar
  showHeader?: boolean; // the caller renders StepHeader above its tabs
  finalData?: boolean; // the test screen shows the final data of a closed case
  documents: DocumentDTO[] | null;
  documentsError: string | null;
  events: CaseEvent[];
  uploading: boolean;
  onUpload: (file: File, targetName: string) => void;
  showSummary?: boolean; // false: the caller renders the case data
  checkResult?: ReactNode; // the check result, above the actions
}) {
  if (state.status === "closed") {
    return (
      <div className="flex flex-col gap-2 px-4 pt-3.5">
        <h2 className="text-[17px] font-semibold leading-tight">Case closed</h2>
        <p className="text-sm text-muted-foreground">{`Result: ${state.result}.`}</p>
        {finalData && (
          <DataList
            def={def}
            state={state}
            label="Final data"
            fields={def.fields.filter((field) => {
              const value = state.data[field.name];
              return value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
            })}
          />
        )}
      </div>
    );
  }

  const node = def.nodes.find((n) => n.id === state.node_id);
  if (node === undefined) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-col">
      {showHeader && (
        <div className="px-4 pt-3.5">
          <StepHeader def={def} node={node} />
        </div>
      )}
      {readOnly && (
        <p className="mx-4 mt-3 rounded-md bg-blue-50 px-2.5 py-1.5 text-[12.5px] text-blue-900">
          Replay: the commands wait for the present.
        </p>
      )}
      {node.type !== "task" ? (
        <p className="px-4 pt-3 text-sm text-muted-foreground">
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
          onDecide={onDecide}
          failedChecks={failedChecks}
          readOnly={readOnly}
          actorLocked={actorLocked}
          actorInBar={actorInBar}
          documents={documents}
          documentsError={documentsError}
          events={events}
          uploading={uploading}
          onUpload={onUpload}
          showSummary={showSummary}
          checkResult={checkResult}
        />
      )}
    </div>
  );
}

// TaskBody is the task-only part: the Act as pick, then the take
// button or the form with the actions. A replay disables the pick and
// hides the commands.
function TaskBody({ def, node, state, users, actor, onActorChange, onCommand, onDecide, failedChecks, readOnly, actorLocked, actorInBar, documents, documentsError, events, uploading, onUpload, showSummary, checkResult }: {
  def: ProcessDefinition;
  node: ProcessNode;
  state: CaseState;
  users: UserDTO[];
  actor: string;
  onActorChange: (id: string) => void;
  onCommand: (cmd: CommandInput) => void;
  onDecide: (cmds: CommandInput[]) => void;
  failedChecks: { id: string; message: string }[];
  readOnly: boolean;
  actorLocked: boolean;
  actorInBar: boolean;
  documents: DocumentDTO[] | null;
  documentsError: string | null;
  events: CaseEvent[];
  uploading: boolean;
  onUpload: (file: File, targetName: string) => void;
  showSummary: boolean;
  checkResult: ReactNode;
}) {
  // The effect fires with the assignee when one is set, else with
  // the first list entry when the actor is not in the list: what the
  // screen shows is what the commands send. The wiring depends on
  // the step and on who owns it. A locked actor stays the one given
  // (the delivered app owns the actor; the shell sends it).
  useEffect(() => {
    if (actorLocked) {
      return;
    }
    if (state.assignee !== "") {
      onActorChange(state.assignee);
      return;
    }
    const list = actorsFor(users, node);
    if (list.length > 0 && !list.some((u) => u.id === actor)) {
      onActorChange(list[0]!.id);
    }
  }, [state.node_id, state.assignee, users, node, actor, onActorChange, actorLocked]);

  const actorName = (id: string) => users.find((u) => u.id === id)?.name ?? id;

  const actorLine = actorLocked ? (
    // The delivered app locks the actor to the picked demo profile:
    // the line replaces the select.
    <p className="text-[13px] text-muted-foreground">{`Acting as ${actorName(actor)}`}</p>
  ) : actorInBar ? null : (
    <label className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium">Act as</span>
      <ActorSelect
        users={users}
        node={node}
        state={state}
        actor={actor}
        onActorChange={onActorChange}
        disabled={readOnly}
      />
    </label>
  );

  if (actorLocked && state.assignee !== "" && state.assignee !== actor) {
    // The shared-role rule: the first taker owns the case. A locked
    // actor that is not the assignee sees the owner and no commands.
    return (
      <div className="flex flex-col gap-3 px-4 pt-3">
        {actorLine}
        <div className="rounded-lg border p-3 text-sm">
          {`Taken by ${actorName(state.assignee)}.`}
        </div>
        <FailedChecks failedChecks={failedChecks} />
        {checkResult}
      </div>
    );
  }

  if (state.assignee === "") {
    return (
      <>
        <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
          {actorLine}
          {showSummary && <CaseSummary def={def} node={node} state={state} withWrites />}
          <FailedChecks failedChecks={failedChecks} />
          {checkResult}
        </div>
        {!readOnly && (
          <Footer>
            <Button onClick={() => onCommand({ type: "take" })}>Take the step</Button>
          </Footer>
        )}
      </>
    );
  }

  // The key remounts the form at each step change, so the local
  // values reset without an effect.
  return (
    <StepForm
      key={state.node_id}
      def={def}
      node={node}
      state={state}
      actorLine={actorLine}
      onCommand={onCommand}
      onDecide={onDecide}
      failedChecks={failedChecks}
      readOnly={readOnly}
      documents={documents}
      documentsError={documentsError}
      events={events}
      uploading={uploading}
      onUpload={onUpload}
      showSummary={showSummary}
      checkResult={checkResult}
    />
  );
}

// CaseSummary lists the values the role reads on this step, two per
// row, in their display form. A computed field shows here whatever
// its access: the engine computes it. withWrites adds the fields the
// role writes: before the take, the form is not open yet.
export function CaseSummary({ def, node, state, withWrites = false }: {
  def: ProcessDefinition;
  node: ProcessNode;
  state: CaseState;
  withWrites?: boolean;
}) {
  // An empty value says nothing yet: it stays out of the summary.
  const rows = def.fields.filter((field) => {
    const access = accessOf(field, node, def);
    const value = state.data[field.name];
    return (
      access !== "hidden" &&
      field.type !== "document" &&
      value !== null &&
      value !== undefined &&
      value !== "" &&
      (withWrites || access === "read" || field.computed !== null)
    );
  });
  return <DataList def={def} state={state} fields={rows} label="Case data" />;
}

function DataList({ def, state, fields, label }: {
  def: ProcessDefinition;
  state: CaseState;
  fields: Field[];
  label: string;
}) {
  if (fields.length === 0) {
    return null;
  }
  return (
    <section aria-label={label} className="rounded-lg bg-muted/50 px-3 py-2.5">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        {fields.map((field) => (
          <div key={field.name} className="flex min-w-0 flex-col">
            <dt className="truncate text-[11.5px] text-muted-foreground">{field.label}</dt>
            <dd className="truncate text-[13px] font-medium">
              {valueText(field, state.data[field.name], def.currency)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// nextStepText tells where a decision sends the case: a task, a
// closing result, or a gateway that the rules resolve later.
export function nextStepText(def: ProcessDefinition, nodeId: string, decision: string): string {
  const edge = def.edges.find((e) => e.from === nodeId && e.decision === decision);
  const target = def.nodes.find((n) => n.id === edge?.to);
  if (target?.type === "task") return `Next step by rule: ${target.name}.`;
  if (target?.type === "end" && target.end_result !== null) return `The case closes: ${target.end_result}.`;
  return "The rules of the process choose the next step.";
}

// decisionCommands gives the commands of one decision click: the form
// values first (null sends none), then the decision.
export function decisionCommands(decision: string, values: Record<string, unknown> | null): CommandInput[] {
  const decide: CommandInput = { type: "decide", decision };
  return values === null ? [decide] : [{ type: "submit", values }, decide];
}

// DecisionConfirmBody is the body of the decision confirmation dialog.
export function DecisionConfirmBody({ decision, text, onCancel, onConfirm }: {
  decision: string;
  text: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const label = decisionLabel(decision);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold leading-none">{`${label} this case?`}</h2>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm}>{label}</Button>
      </div>
    </div>
  );
}

// sendsBack tells if the link of a decision goes to a step that the case
// entered before its first entry in the current step. Such a link sends
// the case back, so the gate of the current step does not apply to that
// decision. A forward link after a loop keeps the gate.
export function sendsBack(def: ProcessDefinition, nodeId: string, decision: string, events: CaseEvent[]): boolean {
  const edge = def.edges.find((e) => e.from === nodeId && e.decision === decision);
  const entered = (id: string) =>
    events.filter((e) => e.type === "step_entered" && (e.payload as { node_id?: string }).node_id === id);
  const here = entered(nodeId);
  if (edge === undefined || here.length === 0) {
    return false;
  }
  const first = Math.min(...here.map((e) => e.seq));
  return entered(edge.to).some((e) => e.seq < first);
}

// StepForm is the taken-step part: the case summary, the write
// fields with the local values, the documents, and the sticky
// actions. The key on the parent render resets the values at each
// step change. A replay disables the inputs and hides the actions.
function StepForm({ def, node, state, actorLine, onCommand, onDecide, failedChecks, readOnly, documents, documentsError, events, uploading, onUpload, showSummary, checkResult }: {
  def: ProcessDefinition;
  node: ProcessNode;
  state: CaseState;
  actorLine: ReactNode;
  onCommand: (cmd: CommandInput) => void;
  onDecide: (cmds: CommandInput[]) => void;
  failedChecks: { id: string; message: string }[];
  readOnly: boolean;
  documents: DocumentDTO[] | null;
  documentsError: string | null;
  events: CaseEvent[];
  uploading: boolean;
  onUpload: (file: File, targetName: string) => void;
  showSummary: boolean;
  checkResult: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  // asked is the decision that waits for its confirmation.
  const [asked, setAsked] = useState<string | null>(null);

  // fillTargets is the field list the read route needs: the write
  // fields of the node in def.fields order, as name, label and type.
  // The document type stays out: a scan shows no stored document ids,
  // the Documents checkbox of the form holds them.
  const fillTargets = def.fields
    .filter(
      (field) =>
        accessOf(field, node, def) === "write" &&
        field.computed === null &&
        field.type !== "document",
    )
    .map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
    }));

  // fillFormValues merges the read values into the local values, one
  // key per rendered input: write access and no computed expression.
  // The other keys of the given record are dropped, and the read-only
  // and computed fields stay untouched (the lot 3.1 rule).
  const fillFormValues = (filled: Record<string, unknown>) => {
    setValues((old) => {
      const next = { ...old };
      for (const field of def.fields) {
        if (field.computed !== null || !(field.name in filled)) {
          continue;
        }
        if (accessOf(field, node, def) !== "write") {
          continue;
        }
        next[field.name] = filled[field.name];
      }
      return next;
    });
  };

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

  // valueOf gives the value an input shows: the local edit, else the
  // stored value. A document field with no value yet starts with every
  // attached scan ticked: the user attached them for this step.
  const valueOf = (field: Field) =>
    values[field.name] ??
    state.data[field.name] ??
    (field.type === "document" && list.length > 0 ? list.map((d) => d.id) : undefined);

  // submitted adds the prefilled scans of a document field that the
  // user did not touch: what the screen shows is what the submit sends.
  const submitted = () => {
    const out = { ...values };
    for (const field of def.fields) {
      if (field.type !== "document" || field.name in out) {
        continue;
      }
      if (accessOf(field, node, def) !== "write" || field.computed !== null) {
        continue;
      }
      const v = valueOf(field);
      if (v !== undefined && state.data[field.name] === undefined) {
        out[field.name] = v;
      }
    }
    return out;
  };

  // The write fields: the inputs of the form, two per row. A document
  // field takes the full row (one checkbox per scan).
  const inputs = def.fields.filter(
    (field) => accessOf(field, node, def) === "write" && field.computed === null,
  );

  return (
    <>
      <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
        {actorLine}
        {showSummary && <CaseSummary def={def} node={node} state={state} />}
        {inputs.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {inputs.map((field) => (
              <label
                key={field.name}
                className={`flex min-w-0 flex-col gap-1 ${field.type === "document" ? "col-span-2" : ""}`}
              >
                <span className="truncate text-[12.5px] font-medium">{field.label}</span>
                <FieldInput
                  field={field}
                  value={valueOf(field)}
                  onChange={(v) => setValues((old) => ({ ...old, [field.name]: v }))}
                  disabled={readOnly}
                  scans={list.map((d) => ({ id: d.id, name: d.name }))}
                />
              </label>
            ))}
          </div>
        )}
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
            onFill={fillFormValues}
            fillTargets={fillTargets}
          />
        )}
        <FailedChecks failedChecks={failedChecks} />
        {checkResult}
      </div>
      {!readOnly && (
        <Footer>
          {blocked && (
            <p className="text-[12.5px] text-destructive">
              {`Missing: ${[
                ...(documents === null ? node.documents : missing),
                ...(node.signature && !signed ? ["signature"] : []),
              ].join(", ")}`}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {node.decisions.length === 0 && (
              <Button
                disabled={blocked}
                onClick={() => onCommand({ type: "submit", values: submitted() })}
              >
                Submit
              </Button>
            )}
            {node.decisions.map((decision) => (
              <Button
                key={decision}
                className="capitalize"
                disabled={!sendsBack(def, node.id, decision, events) && blocked}
                onClick={() => setAsked(decision)}
              >
                {decision}
              </Button>
            ))}
            {node.decisions.length > 0 && (
              <Hint label="How to decide">
                A decision sends the values of the form, then moves the case, after a confirmation. A decision that sends the case back to an earlier step is always open.
              </Hint>
            )}
          </div>
          <Dialog open={asked !== null} onOpenChange={(open) => { if (!open) setAsked(null); }}>
            <DialogContent
              aria-label={asked === null ? undefined : `${decisionLabel(asked)} this case?`}
              showCloseButton={false}
              className="sm:max-w-[420px]"
            >
              {asked !== null && (
                <DecisionConfirmBody
                  decision={asked}
                  text={nextStepText(def, node.id, asked)}
                  onCancel={() => setAsked(null)}
                  onConfirm={() => {
                    // A send-back decision sends no values (the form may be incomplete).
                    onDecide(decisionCommands(asked, sendsBack(def, node.id, asked, events) || inputs.length === 0 ? null : submitted()));
                    setAsked(null);
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
        </Footer>
      )}
    </>
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
    <div role="alert" className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
      {failedChecks.map((check) => (
        <p key={check.id} className="text-destructive text-[13px]">
          {`Check ${check.id}: ${check.message}`}
        </p>
      ))}
    </div>
  );
}
