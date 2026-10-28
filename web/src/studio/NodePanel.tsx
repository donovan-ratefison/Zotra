// The right panel: the selected node on three tabs. A draft is
// editable; any other status renders every control disabled. All
// three panes stay mounted, the inactive ones carry the hidden
// attribute (the mockup pattern, and cross-pane tests rely on it).

import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Clock } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import { Switch } from "@/ui/switch";
import { Textarea } from "@/ui/textarea";
import { updateDraft } from "./api";
import { edgePillText, roleColor } from "./layout";
import {
  addCheck,
  removeCheck,
  saveErrorText,
  withCheckExpression,
  withCheckMessage,
  withNodeDeadline,
  withNodeDocuments,
  withNodeName,
  withNodeRole,
  withNodeSignature,
} from "./node-edit";
import { useStudioStore, type PanelTab } from "./store";
import type {
  NodeType,
  ProcessDefinition,
  ProcessNode,
  VersionSummary,
} from "./types";
import { ScopeMatrix } from "./ScopeMatrix";

const TYPE_TEXT: Record<NodeType, string> = {
  start: "Start",
  task: "Task",
  gateway: "Gateway",
  end: "End",
};

const TABS: { id: PanelTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "requirements", label: "Requirements" },
  { id: "scope", label: "Data and scope" },
];

// Radix forbids an empty value on a select item, so the "no role"
// option carries this sentinel and maps to null on change.
const NO_ROLE = "__none__";

export function NodePanel({
  def,
  version,
  onSaved,
}: {
  def: ProcessDefinition;
  version: VersionSummary;
  onSaved: () => void;
}) {
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const tab = useStudioStore((s) => s.tab);
  const setTab = useStudioStore((s) => s.setTab);

  const [working, setWorking] = useState(def);
  const [prevDef, setPrevDef] = useState(def);
  // Reset the working definition when the server sends a new object
  // (a refetch after a save), without an extra paint.
  if (prevDef !== def) {
    setPrevDef(def);
    setWorking(def);
  }

  const [docName, setDocName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const node = selectedNodeId
    ? working.nodes.find((n) => n.id === selectedNodeId)
    : undefined;
  if (!node) {
    return null;
  }

  const editable = version.status === "draft";
  const dirty = working !== def;
  const isTask = node.type === "task";
  const stepIndex = def.nodes.indexOf(node);

  const apply = (next: ProcessDefinition) => setWorking(next);

  async function save() {
    try {
      const saved = await updateDraft(version.id, working);
      toast.success("Draft saved");
      onSaved();
      setWorking(saved.definition);
      setSaveError(null);
    } catch (err) {
      setSaveError(saveErrorText(err));
    }
  }

  function addDocument() {
    const name = docName.trim();
    if (name === "") {
      return;
    }
    if (!node!.documents.includes(name)) {
      apply(withNodeDocuments(working, node!.id, [...node!.documents, name]));
    }
    setDocName("");
  }

  const header = (
    <div className="flex flex-col gap-1.5 border-b px-4 pb-3 pt-3.5">
      <span className="text-[11.5px] font-medium text-muted-foreground">
        {`${TYPE_TEXT[node.type]} · Step ${stepIndex + 1}`}
      </span>
      <h2 className="text-[17px] font-semibold leading-tight">{node.name}</h2>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <RoleChip def={def} node={node} />
        {node.deadline_hours !== null && (
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {`${node.deadline_hours} h`}
          </span>
        )}
      </div>
      {!editable && (
        <p className="text-xs text-muted-foreground">
          {`This version is ${version.status}. Only a draft can be edited.`}
        </p>
      )}
    </div>
  );

  const tabStrip = (
    <div
      role="tablist"
      aria-label="Step settings"
      className="m-3 mt-3 grid grid-cols-3 gap-0.5 rounded-lg bg-secondary p-0.5"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          disabled={!editable}
          onClick={() => setTab(t.id)}
          className={`rounded-md px-1 py-1.5 text-[12.5px] font-medium whitespace-nowrap disabled:opacity-60${
            tab === t.id
              ? " bg-card text-foreground shadow-sm"
              : " text-muted-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const generalPane = (
    <div role="tabpanel" hidden={tab !== "general"} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="np-name">Step name</Label>
        <Input
          id="np-name"
          value={node.name}
          disabled={!editable}
          onChange={(e) => apply(withNodeName(working, node.id, e.target.value))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="np-type">Type</Label>
        <Input id="np-type" value={TYPE_TEXT[node.type]} readOnly />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="np-deadline">Deadline</Label>
        <div className="relative">
          <Input
            id="np-deadline"
            type="number"
            value={node.deadline_hours ?? ""}
            disabled={!editable || !isTask}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                apply(withNodeDeadline(working, node.id, null));
                return;
              }
              if (/^-?\d+$/.test(raw)) {
                apply(withNodeDeadline(working, node.id, Number(raw)));
              }
              // Anything else does not parse: no change.
            }}
          />
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
            h
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="np-role">Role</Label>
        <Select
          value={
            node.role !== null && def.roles.some((r) => r.id === node.role)
              ? node.role
              : NO_ROLE
          }
          disabled={!editable || !isTask}
          onValueChange={(v) =>
            apply(withNodeRole(working, node.id, v === NO_ROLE ? null : v))
          }
        >
          <SelectTrigger id="np-role" className="w-full">
            {/* A closed Radix select renders no selected label on the
                server, so the label goes in as children. */}
            <SelectValue>
              {node.role !== null && def.roles.some((r) => r.id === node.role)
                ? def.roles.find((r) => r.id === node.role)!.name
                : "No role (automatic step)"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_ROLE}>No role (automatic step)</SelectItem>
            {def.roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium">Outgoing links</span>
        <OutgoingLinks def={def} node={node} />
      </div>
    </div>
  );

  const requirementsPane = (
    <div
      role="tabpanel"
      hidden={tab !== "requirements"}
      className="flex flex-col gap-3.5"
    >
      {!isTask ? (
        <>
          <p>Only tasks have requirements.</p>
          <p className="text-xs text-muted-foreground">
            Documents, signature and checks apply to tasks.
          </p>
        </>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <span className="text-[12.5px] font-medium">Required documents</span>
            {node.documents.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No document required at this step.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-md border">
                {node.documents.map((name) => (
                  <li
                    key={name}
                    className="flex items-center gap-2 border-b px-2.5 py-1.5 text-[12.5px] last:border-b-0"
                  >
                    {name}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7"
                      disabled={!editable}
                      aria-label={`Remove ${name}`}
                      onClick={() =>
                        apply(
                          withNodeDocuments(
                            working,
                            node.id,
                            node.documents.filter((d) => d !== name),
                          ),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={docName}
                title="Document name"
                disabled={!editable}
                className="flex-1"
                onChange={(e) => setDocName(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!editable || docName.trim() === ""}
                onClick={addDocument}
              >
                Add document
              </Button>
            </div>
          </section>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[12.5px] font-medium">Signature</span>
              <span className="text-xs text-muted-foreground">
                {node.signature
                  ? "Required: name, date and time, document hash go to the audit log."
                  : "Not required at this step."}
              </span>
            </div>
            <Switch
              aria-label="Signature required"
              checked={node.signature}
              disabled={!editable}
              onCheckedChange={(v) =>
                apply(withNodeSignature(working, node.id, v))
              }
            />
          </div>
          <section className="flex flex-col gap-2">
            <span className="text-[12.5px] font-medium">Checks</span>
            {node.checks.map((check) => (
              <div key={check.id} className="flex flex-col gap-2 rounded-md border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium">
                    {`Check ${check.id}`}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    disabled={!editable}
                    aria-label={`Remove check ${check.id}`}
                    onClick={() => apply(removeCheck(working, node.id, check.id))}
                  >
                    Remove
                  </Button>
                </div>
                {check.plain_text !== null && (
                  <p className="text-xs text-muted-foreground">
                    {`Plain language: ${check.plain_text}`}
                  </p>
                )}
                <Textarea
                  aria-label={`Expression of check ${check.id}`}
                  rows={2}
                  disabled={!editable}
                  className="font-mono text-xs"
                  value={check.expression}
                  onChange={(e) =>
                    apply(
                      withCheckExpression(working, node.id, check.id, e.target.value),
                    )
                  }
                />
                <Textarea
                  aria-label={`Message of check ${check.id}`}
                  rows={2}
                  disabled={!editable}
                  value={check.message}
                  onChange={(e) =>
                    apply(withCheckMessage(working, node.id, check.id, e.target.value))
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={!editable}
              onClick={() => apply(addCheck(working, node.id))}
            >
              Add check
            </Button>
          </section>
        </>
      )}
    </div>
  );

  const scopePane = (
    <div role="tabpanel" hidden={tab !== "scope"} className="flex flex-col gap-3">
      {!isTask ? (
        <>
          <p>Only tasks have a screen and a role.</p>
          <p className="text-xs text-muted-foreground">
            The process scope applies to this step.
          </p>
        </>
      ) : (
        <>
          <p className="text-[12.5px] font-medium">
            {node.scope_overrides.length > 0
              ? `${node.scope_overrides.length} fields have a different scope here.`
              : "No override. The process scope applies."}
          </p>
          <ScopeMatrix
            def={def}
            node={node}
            editable={version.status === "draft"}
            onChange={apply}
          />
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>R Read · W Write · H Hidden</span>
            <span>A dot marks an override.</span>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {tabStrip}
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-5">
        {generalPane}
        {requirementsPane}
        {scopePane}
      </div>
      <footer className="flex items-center gap-3 border-t px-4 py-2.5">
        {dirty && editable && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={!dirty || !editable}
          onClick={() => void save()}
        >
          Save draft
        </Button>
      </footer>
      {saveError !== null && (
        <p className="px-4 pb-2.5 text-xs text-destructive">{saveError}</p>
      )}
    </div>
  );
}

function RoleChip({ def, node }: { def: ProcessDefinition; node: ProcessNode }) {
  const role = node.role
    ? def.roles.find((r) => r.id === node.role)
    : undefined;
  const color = roleColor(def, node.role);
  if (role === undefined || color === null) {
    return (
      <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-500">
        Automatic
      </span>
    );
  }
  return (
    <span
      className="flex min-w-0 max-w-[220px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
      style={{ color, backgroundColor: `${color}1a` }}
    >
      <span
        className="size-[5px] shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{role.name}</span>
    </span>
  );
}

function OutgoingLinks({ def, node }: { def: ProcessDefinition; node: ProcessNode }) {
  const outgoing = def.edges.filter((e) => e.from === node.id);
  if (outgoing.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {node.type === "end"
          ? "No outgoing link: end of the process."
          : "No outgoing link."}
      </p>
    );
  }
  return (
    <ul className="overflow-hidden rounded-md border">
      {outgoing.map((edge) => {
        const target = def.nodes.find((n) => n.id === edge.to);
        const pill = edgePillText(edge);
        return (
          <li
            key={edge.id}
            className="flex items-center gap-2 border-b px-2.5 py-1.5 text-[12.5px] last:border-b-0"
          >
            {pill !== null && (
              <>
                <span className="rounded-full border bg-secondary px-1.5 py-0.5 text-[10.5px]">
                  {pill}
                </span>
                <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
              </>
            )}
            <span className="truncate">{target?.name ?? edge.to}</span>
          </li>
        );
      })}
    </ul>
  );
}
