// The studio shell: it loads the process, the versions and the
// version, in this order, then renders the top bar, the diagram and
// the node panel, plus the import dialog.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileText, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  createProcess,
  createVersion,
  getVersion,
  listProcesses,
  listVersions,
  updateDraft,
} from "./api";
import { readCase, type CaseDTO, type CaseState } from "./case-api";
import { Button } from "@/ui/button";
import { cn } from "@/lib/utils";
import { changedIds, diffDefinitions } from "./diff";
import { PolicyPanel } from "./PolicyPanel";
import { ProcessDiagram } from "./diagram";
import { AssistantChat } from "./AssistantChat";
import { ImportDialog } from "./ImportDialog";
import { addNode, connect, type AddType } from "./edit";
import { NodePanel, UnsavedBadge } from "./NodePanel";
import { ProcessPanel } from "./ProcessPanel";
import { ProposalBar } from "./ProposalBar";
import { ResizeHandle } from "./resize";
import { VersionActions } from "./version-actions";
import type { Paragraph } from "./policy";
import { useStudioStore, type PanelTab } from "./store";
import { TestScreen } from "./TestScreen";
import type {
  ProcessDefinition,
  ProcessNode,
  ProcessSummary,
  VersionSummary,
} from "./types";

// lastImport carries the last import; the PDF panel and the citation
// highlight read it.
interface LastImport {
  processId: string;
  versionId: string;
  paragraphs: Paragraph[];
  file: File;
}

// The diff base of a policy proposal: every element of the proposal
// is an addition.
const EMPTY_DEFINITION: ProcessDefinition = {
  schema_version: "1",
  name: "",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "", primary_color: "#0f4c45", logo_url: null },
  roles: [],
  fields: [],
  scope: [],
  nodes: [],
  edges: [],
  sources: [],
};

// The default highlight: the citations of the selected node, in
// order (node citations, then check citations), resolved to
// paragraphs. Ids without a paragraph are skipped.
function resolveCitations(
  node: ProcessNode | null,
  paragraphs: Paragraph[],
): Paragraph[] {
  if (node === null) {
    return [];
  }
  const ids = [
    ...node.citations,
    ...node.checks.flatMap((check) => check.citations),
  ];
  return ids
    .map((id) => paragraphs.find((p) => p.id === id))
    .filter((p): p is Paragraph => p !== undefined);
}

function pickProcess(rows: ProcessSummary[] | undefined): ProcessSummary | null {
  if (!rows || rows.length === 0) {
    return null;
  }
  return [...rows].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )[0]!;
}

function pickVersion(rows: VersionSummary[] | undefined): VersionSummary | null {
  if (!rows || rows.length === 0) {
    return null;
  }
  return rows.reduce((best, row) => (row.number > best.number ? row : best));
}

function Loading() {
  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      Loading the studio
    </div>
  );
}

function ErrorScreen({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? error.message : String(error);
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-semibold">The studio did not load.</h1>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

const TAB_VALUES: PanelTab[] = ["general", "requirements", "scope"];

// caseVersionUrl builds the studio URL that pins a test case on its
// own version: a reload reopens the same case on the same version.
export function caseVersionUrl(
  processId: string,
  versionId: string,
  caseId: string,
): string {
  return (
    `/?process=${encodeURIComponent(processId)}` +
    `&version=${encodeURIComponent(versionId)}` +
    `&mode=test&case=${encodeURIComponent(caseId)}`
  );
}

export function StudioShell() {
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const select = useStudioStore((s) => s.select);
  const setTab = useStudioStore((s) => s.setTab);
  const setMode = useStudioStore((s) => s.setMode);
  const setTestCaseId = useStudioStore((s) => s.setTestCaseId);
  const mode = useStudioStore((s) => s.mode);
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(() => {
    // new=1 in the URL opens the dialog once, at mount. The render
    // tests have no window: no dialog there.
    return (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("new") === "1"
    );
  });
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const [proposal, setProposal] = useState<{
    name: string;
    definition: ProcessDefinition;
    paragraphs: Paragraph[];
    file: File;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // The steps that the process panel lights on the diagram.
  const [canvasFocus, setCanvasFocus] = useState<string[] | null>(null);
  const [policyOpen, setPolicyOpen] = useState(() => {
    // policy=1 opens the drawer once, at mount. The render tests
    // have no window: closed there.
    return (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("policy") === "1"
    );
  });
  // The panel sizes. They are not stored: a reload gives the
  // defaults.
  const [policyShare, setPolicyShare] = useState(0.4);
  const [policyMax, setPolicyMax] = useState(false);
  const [asideWidth, setAsideWidth] = useState(380);
  const [chatHeight, setChatHeight] = useState(220);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const policyRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  // The highlight override. null means: derive the highlight from
  // the selected node (the state before any chip click).
  const [policyHighlight, setPolicyHighlight] = useState<
    Paragraph[] | null
  >(null);
  // The version override. null means: pick the version by the
  // automatic rule (the highest number). Read once at mount from the
  // URL; a selector click rewrites it. The render tests run with no
  // location: null there.
  const [versionOverride, setVersionOverride] = useState<
    string | null
  >((): string | null =>
    typeof location === "undefined"
      ? null
      : new URLSearchParams(location.search).get("version"),
  );

  // URL parameters, read once at mount. The tab parameter applies
  // only when it names a known tab; anything else is ignored. The
  // mode and case parameters open the test view (mode=test) with the
  // case of the URL; an unknown case id is kept, the case query then
  // fails into the error state. The mount is the guard: a re-applied
  // parameter would pull the mode back after a tab click.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (TAB_VALUES.includes(tab as PanelTab)) {
      setTab(tab as PanelTab);
    }
    if (params.get("mode") === "test") {
      setMode("test");
    }
    const caseId = params.get("case");
    if (caseId !== null) {
      setTestCaseId(caseId);
    }
    // The setters are stable zustand setters, so this runs once, at
    // mount.
  }, [setTab, setMode, setTestCaseId]);

  const q1 = useQuery({ queryKey: ["processes"], queryFn: listProcesses });
  // A process or version id in the URL overrides the automatic pick.
  // A value that matches no row falls back to the automatic rule. The
  // render tests have no window: the automatic rule applies there.
  const process = useMemo(() => {
    const rows = q1.data;
    if (rows && rows.length > 0 && typeof window !== "undefined") {
      const id = new URLSearchParams(window.location.search).get("process");
      const match = id ? rows.find((row) => row.id === id) : undefined;
      if (match) {
        return match;
      }
    }
    return pickProcess(rows);
  }, [q1.data]);
  const processId = process ? process.id : null;
  const q2 = useQuery({
    queryKey: ["versions", processId],
    queryFn: () => listVersions(processId!),
    enabled: processId !== null,
  });
  // The version override (the URL at mount, or a selector click)
  // wins over the automatic pick. An id that matches no row falls
  // back to the automatic rule.
  const version = useMemo(() => {
    const rows = q2.data;
    if (rows && rows.length > 0 && versionOverride !== null) {
      const match = rows.find((row) => row.id === versionOverride);
      if (match) {
        return match;
      }
    }
    return pickVersion(rows);
  }, [q2.data, versionOverride]);
  const versionId = version ? version.id : null;

  // The open test case pins its own version: the engine runs a case
  // on the version it was created on, so the diagram, the forms, the
  // badge and the coverage must come from that version, not from the
  // opened one. The query shares the cache entry of the test screen
  // (same key, same reader).
  const testCaseId = useStudioStore((s) => s.testCaseId);
  const caseVersion = useQuery({
    queryKey: ["case", testCaseId],
    queryFn: () => readCase(testCaseId!),
    enabled: testCaseId !== null,
    select: (answer: { case: CaseDTO; state: CaseState }) =>
      answer.case.version_id,
  });
  // The pin is the render-phase state adjustment of the undo stack
  // below: the override follows the version of the open case.
  if (
    caseVersion.data !== undefined &&
    caseVersion.data !== versionOverride
  ) {
    setVersionOverride(caseVersion.data);
  }
  // A reload reopens the same case on the same version: the URL
  // holds process, version, mode and case. It runs when the pin is
  // in force (the case version is the rendered one).
  useEffect(() => {
    const caseVersionId = caseVersion.data;
    if (
      caseVersionId === undefined ||
      testCaseId === null ||
      processId === null ||
      versionId === null ||
      caseVersionId !== versionId
    ) {
      return;
    }
    window.history.replaceState(
      null,
      "",
      caseVersionUrl(processId, caseVersionId, testCaseId),
    );
  }, [caseVersion.data, testCaseId, processId, versionId]);

  // Undo: the stack holds the definition as it was before each save
  // of the open draft, at most 20 entries. A version switch clears
  // it: each version undoes only its own saves. The reset compares
  // the version of the stack during render, the pattern that the
  // react-hooks lint asks for a state change on a value change.
  const [undoStack, setUndoStack] = useState<ProcessDefinition[]>([]);
  const [undoBusy, setUndoBusy] = useState(false);
  const [stackVersionId, setStackVersionId] = useState(versionId);
  if (stackVersionId !== versionId) {
    setStackVersionId(versionId);
    setUndoStack([]);
  }

  // The proposal of the assistant chat. A version switch clears it:
  // the proposal belongs to the draft it was asked on. The reset
  // compares the version during render, the pattern of the undo
  // stack above.
  const [chatProposal, setChatProposal] = useState<ProcessDefinition | null>(null);
  const [chatVersionId, setChatVersionId] = useState(versionId);
  if (chatVersionId !== versionId) {
    setChatVersionId(versionId);
    setChatProposal(null);
  }

  const q3 = useQuery({
    queryKey: ["version", versionId],
    queryFn: () => getVersion(versionId!),
    enabled: versionId !== null,
  });
  const def = q3.data?.definition;

  // The node URL parameter applies only when the definition holds it
  // and no node is selected yet. The guard keeps a refetch after a
  // save from pulling the selection back to the stale parameter.
  useEffect(() => {
    if (!def || useStudioStore.getState().selectedNodeId !== null) {
      return;
    }
    const nodeId = new URLSearchParams(window.location.search).get("node");
    if (nodeId !== null && def.nodes.some((n) => n.id === nodeId)) {
      select(nodeId);
    }
  }, [def, select]);

  // onImported stores the import, writes the new URL, and refetches
  // the three queries. The picks then read the new ids and the shell
  // opens the new draft.
  function onImported(
    processId: string,
    versionId: string,
    paragraphs: Paragraph[],
    file: File,
  ) {
    setLastImport({ processId, versionId, paragraphs, file });
    window.history.replaceState(
      null,
      "",
      `/?process=${encodeURIComponent(processId)}&version=${encodeURIComponent(versionId)}`,
    );
    // The import must win over a stale version override.
    setVersionOverride(versionId);
    void queryClient.invalidateQueries({ queryKey: ["processes"] });
    void queryClient.invalidateQueries({ queryKey: ["versions", processId] });
    void queryClient.invalidateQueries({ queryKey: ["version", versionId] });
  }

  // onSavedDraft pushes the pre-save definition onto the undo stack,
  // then refetches the version. loadedDef is still the cached
  // pre-save definition at this moment (the invalidation runs
  // after).
  function onSavedDraft() {
    if (loadedDef === undefined) {
      return;
    }
    setUndoStack((stack) => pushUndo(stack, loadedDef));
    void queryClient.invalidateQueries({ queryKey: ["version", versionId] });
  }

  // saveStructure saves one structure edit (add, link, delete) at
  // once, so the undo reverts it. Unsaved edits of the step panel
  // would be lost, so it refuses them. It returns true on a save.
  async function saveStructure(next: ProcessDefinition): Promise<boolean> {
    if (version === null) {
      return false;
    }
    if (useStudioStore.getState().dirty) {
      toast.error("Save the step changes first.");
      return false;
    }
    try {
      await updateDraft(version.id, next);
      onSavedDraft();
      return true;
    } catch {
      toast.error("The change did not save.");
      return false;
    }
  }

  // onAdd appends a new step, then opens it in the panel.
  async function onAdd(type: AddType) {
    if (loadedDef === undefined) {
      return;
    }
    const r = addNode(loadedDef, type);
    if (await saveStructure(r.def)) {
      select(r.id);
    }
  }

  function onConnect(from: string, to: string) {
    if (loadedDef === undefined) {
      return;
    }
    const next = connect(loadedDef, from, to);
    if (next === null) {
      toast.error("This link is not allowed.");
      return;
    }
    void saveStructure(next);
  }

  // undo writes the previous definition back as a normal draft
  // save. Unsaved edits of the step panel are dropped with it.
  const undo = useCallback(async () => {
    if (undoBusy || undoStack.length === 0) {
      return;
    }
    if (version === null || version.status !== "draft") {
      return;
    }
    const previous = undoStack[undoStack.length - 1]!;
    setUndoBusy(true);
    try {
      await updateDraft(version.id, previous);
      setUndoStack((stack) => stack.slice(0, -1));
      void queryClient.invalidateQueries({
        queryKey: ["version", version.id],
      });
      toast.success("Undone");
    } catch {
      toast.error("The undo did not save.");
    } finally {
      setUndoBusy(false);
    }
  }, [undoBusy, undoStack, version, queryClient]);

  // Ctrl+Z or Cmd+Z undoes the last save. While the focus sits in a
  // field, the browser undo of that field wins: the listener skips
  // inputs, textareas, selects and editable nodes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) {
        return;
      }
      if (e.key.toLowerCase() !== "z") {
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      e.preventDefault();
      void undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // onSelectVersion opens the version of the selector click and
  // writes the id into the URL, so a reload reopens the same
  // version. processId is non-null when the bar renders a version:
  // the version query needs it.
  function onSelectVersion(id: string) {
    setVersionOverride(id);
    // A version switch closes the open test case: the case view
    // always shows the version of its case.
    setTestCaseId(null);
    window.history.replaceState(
      null,
      "",
      `/?process=${encodeURIComponent(processId!)}&version=${encodeURIComponent(id)}`,
    );
  }

  // The proposal, the highlight source and the drawer values.
  const paragraphs =
    proposal !== null ? proposal.paragraphs : lastImport?.paragraphs ?? [];
  const panelFile = proposal !== null ? proposal.file : lastImport?.file ?? null;
  const loadedDef = q3.data?.definition;
  // The diagram and the top bar show the proposal while it is open.
  const shownDef = proposal !== null ? proposal.definition : loadedDef;

  // The selection guard of the chat proposal: while the diagram
  // shows the proposal, a click on an id the loaded definition does
  // not hold changes nothing, so the side panel stays as it is. An
  // id of the loaded definition, or null, passes through.
  function selectOnDiagram(id: string | null) {
    if (
      chatProposal !== null &&
      id !== null &&
      loadedDef !== undefined &&
      !loadedDef.nodes.some((n) => n.id === id)
    ) {
      return;
    }
    select(id);
  }
  const selectedNode =
    selectedNodeId === null
      ? null
      : shownDef?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const highlight = policyHighlight ?? resolveCitations(selectedNode, paragraphs);

  // onProposed receives the reviewed proposal. Nothing is saved yet:
  // the accept handler creates the process and the draft.
  function onProposed(
    name: string,
    definition: ProcessDefinition,
    paragraphs: Paragraph[],
    file: File,
  ) {
    setProposal({ name, definition, paragraphs, file });
  }

  // onCitationClick is the chip click and chip focus path: the
  // highlight becomes the one paragraph of the id, and the drawer
  // opens. An id without a paragraph gives an empty highlight.
  function onCitationClick(id: string) {
    const p = paragraphs.find((x) => x.id === id);
    setPolicyHighlight(p !== undefined ? [p] : []);
    setPolicyOpen(true);
  }

  function onTogglePolicy() {
    setPolicyOpen((v) => !v);
    setPolicyMax(false);
  }

  // The policy panel and its handle, the same in the design view and
  // in the proposal view. The share is a fraction of the column
  // height; the drag measures from the panel bottom, because the chat
  // can sit below the panel.
  const policyBlock = policyOpen && (
    <>
      {!policyMax && (
        <ResizeHandle
          orientation="horizontal"
          label="Resize the policy panel"
          value={policyShare}
          min={0.15}
          max={0.85}
          step={0.05}
          onResize={setPolicyShare}
          measure={(e) => {
            const column = columnRef.current?.getBoundingClientRect();
            const panel = policyRef.current?.getBoundingClientRect();
            if (column === undefined || panel === undefined) {
              return policyShare;
            }
            return (panel.bottom - e.clientY) / column.height;
          }}
        />
      )}
      <div
        ref={policyRef}
        className={cn(
          "overflow-hidden border-t",
          policyMax ? "min-h-0 flex-1" : "shrink-0",
        )}
        style={policyMax ? undefined : { height: `${policyShare * 100}%` }}
      >
        <PolicyPanel
          file={panelFile}
          highlight={highlight}
          maximized={policyMax}
          onToggleMaximize={() => setPolicyMax((v) => !v)}
        />
      </div>
    </>
  );
  const diagramClass = cn("min-h-0 flex-1", policyOpen && policyMax && "hidden");

  // onAccept creates the process and its first draft from the
  // proposal. A failure keeps the proposal, so the designer can
  // retry.
  async function onAccept() {
    if (proposal === null || busy) {
      return;
    }
    setBusy(true);
    try {
      const process = await createProcess(proposal.name);
      const version = await createVersion(
        process.id,
        "From policy",
        proposal.definition,
      );
      onImported(process.id, version.id, proposal.paragraphs, proposal.file);
      setProposal(null);
      toast.success("Draft created.");
    } catch {
      toast.error("The draft did not save.");
    } finally {
      setBusy(false);
    }
  }

  // onReject drops the proposal: nothing was created.
  function onReject() {
    setProposal(null);
    setPolicyHighlight(null);
    toast("Proposal rejected.");
  }

  // Every state renders inside one layout, with the import dialog
  // mounted once above the branches. The dialog stays mounted while
  // the queries fetch, and new=1 opens it in every state.
  let content: ReactNode;
  // A proposal wins over every stage: it can be set in stage 1 (the
  // empty studio), in stage 2 (no version yet) and over stage 3.
  // Nothing is saved, so the stage queries stay as they are.
  if (proposal !== null) {
    // The import always creates a new process: the diff base is the
    // empty process, never the process that is open.
    const diffBase = EMPTY_DEFINITION;
    content = (
      <div className="flex h-screen flex-col">
        <TopBar
          def={proposal.definition}
          version={undefined}
          proposalName={proposal.name}
          onNewFromPolicy={() => setImportOpen(true)}
          policyOpen={policyOpen}
          onTogglePolicy={onTogglePolicy}
          versions={q2.data ?? []}
          versionsPending={q2.isPending}
          onVersionsChanged={() =>
            queryClient.invalidateQueries({ queryKey: ["versions", processId] })
          }
          onSelectVersion={onSelectVersion}
        />
        <ProposalBar
          diff={diffDefinitions(diffBase, proposal.definition)}
          busy={busy}
          onAccept={() => void onAccept()}
          onReject={onReject}
        />
        <main className="flex min-h-0 flex-1">
          <div ref={columnRef} className="flex min-w-0 flex-1 flex-col">
            <div className={diagramClass}>
              <ProcessDiagram
                def={proposal.definition}
                selectedNodeId={selectedNodeId}
                onNodeSelect={select}
                ghost
                onCitationClick={onCitationClick}
              />
            </div>
            {policyBlock}
          </div>
        </main>
      </div>
    );
  } else if (q1.isError) {
    content = <ErrorScreen error={q1.error} />;
  } else if (q1.isPending) {
    content = <Loading />;
  } else if (process === null) {
    content = (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">No process yet.</h1>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          Import a credit policy to create one.
        </Button>
      </div>
    );
  }
  // Stage 2: versions of the picked process. A disabled query is not
  // pending, so the empty states below are reachable.
  else if (q2.isError) {
    content = <ErrorScreen error={q2.error} />;
  } else if (q2.isPending) {
    content = <Loading />;
  } else if (version === null) {
    content = (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">No version yet.</h1>
        <p className="text-muted-foreground">Create a draft to start.</p>
      </div>
    );
  }
  // Stage 3: the picked version.
  else if (q3.isError) {
    content = <ErrorScreen error={q3.error} />;
  } else if (q3.isPending) {
    content = <Loading />;
  } else {
    const loaded = q3.data;
    // The proposal branch renders first, so no proposal is open here.
    const editing =
      mode === "design" && version.status === "draft" && chatProposal === null;
    content = (
      <div className="flex h-screen flex-col">
        <TopBar
          def={loaded.definition}
          version={version}
          onNewFromPolicy={() => setImportOpen(true)}
          policyOpen={policyOpen}
          onTogglePolicy={onTogglePolicy}
          versions={q2.data ?? []}
          versionsPending={q2.isPending}
          onVersionsChanged={() =>
            queryClient.invalidateQueries({ queryKey: ["versions", processId] })
          }
          onSelectVersion={onSelectVersion}
          onUndo={() => void undo()}
          canUndo={undoStack.length > 0 && version.status === "draft"}
        />
        <main ref={mainRef} className="flex min-h-0 flex-1">
          {mode === "test" ? (
            <TestScreen def={loaded.definition} version={version} />
          ) : (
            <>
              <div ref={columnRef} className="flex min-w-0 flex-1 flex-col">
                <div className={diagramClass}>
                  <ProcessDiagram
                    def={chatProposal ?? loaded.definition}
                    selectedNodeId={selectedNodeId}
                    onNodeSelect={selectOnDiagram}
                    ghost={false}
                    ghostIds={
                      chatProposal !== null
                        ? changedIds(loaded.definition, chatProposal)
                        : undefined
                    }
                    onCitationClick={onCitationClick}
                    highlightNodeIds={selectedNodeId === null ? canvasFocus : null}
                    edit={editing ? { onAdd: (t) => void onAdd(t), onConnect } : null}
                  />
                </div>
                {policyBlock}
                <ResizeHandle
                  orientation="horizontal"
                  label="Resize the chat"
                  value={chatHeight}
                  min={120}
                  max={480}
                  step={20}
                  onResize={setChatHeight}
                  measure={(e) => {
                    // The list sits below the chat header: its new
                    // height is the cursor distance to the list
                    // bottom, less the header height.
                    const section = chatRef.current?.firstElementChild;
                    const header = section?.firstElementChild;
                    const list = chatRef.current?.querySelector("#chat-thread");
                    if (header == null || list == null) {
                      return chatHeight;
                    }
                    return (
                      list.getBoundingClientRect().bottom -
                      e.clientY -
                      header.getBoundingClientRect().height
                    );
                  }}
                />
                <div ref={chatRef} className="shrink-0">
                  <AssistantChat
                    version={loaded}
                    def={loaded.definition}
                    onProposal={setChatProposal}
                    onAccepted={onSavedDraft}
                    listHeight={chatHeight}
                  />
                </div>
              </div>
              <ResizeHandle
                orientation="vertical"
                label="Resize the step panel"
                value={asideWidth}
                min={300}
                max={640}
                step={20}
                onResize={setAsideWidth}
                measure={(e) => {
                  const main = mainRef.current?.getBoundingClientRect();
                  return main === undefined ? asideWidth : main.right - e.clientX;
                }}
              />
              <aside
                aria-label="Step detail"
                className="flex shrink-0 flex-col border-l"
                style={{ width: asideWidth }}
              >
                {selectedNodeId === null ? (
                  <ProcessPanel
                    def={loaded.definition}
                    onSelectNode={(id) => {
                      setCanvasFocus(null);
                      select(id);
                    }}
                    onHighlight={setCanvasFocus}
                  />
                ) : (
                  <NodePanel
                    def={loaded.definition}
                    version={version}
                    onSaved={onSavedDraft}
                    onStructure={editing ? (next) => void saveStructure(next) : undefined}
                  />
                )}
              </aside>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <>
      {content}
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onProposed={onProposed}
      />
    </>
  );
}

const STATUS_TEXT: Record<string, string> = {
  draft: "Draft",
  frozen: "Frozen",
  published: "Published",
};
const STATUS_DOT: Record<string, string> = {
  draft: "#d97706",
  frozen: "#2563eb",
  published: "#16a34a",
};

export function TopBar({
  def,
  version,
  proposalName,
  onNewFromPolicy,
  policyOpen = false,
  onTogglePolicy,
  versions = [],
  versionsPending = false,
  onVersionsChanged = () => {},
  onSelectVersion,
  onUndo,
  canUndo = false,
}: {
  def: ProcessDefinition;
  version?: VersionSummary;
  // The name of the reviewed proposal. When set, the breadcrumb names
  // it and carries the Proposal badge, and the version select and the
  // version actions stay out (version is undefined).
  proposalName?: string;
  onNewFromPolicy?: () => void;
  policyOpen?: boolean;
  onTogglePolicy?: () => void;
  versions?: VersionSummary[];
  versionsPending?: boolean;
  onVersionsChanged?: () => void;
  onSelectVersion?: (id: string) => void;
  onUndo?: () => void;
  canUndo?: boolean;
}) {
  const dotColor = version === undefined ? undefined : STATUS_DOT[version.status] ?? "#71717a";
  const mode = useStudioStore((s) => s.mode);
  const setMode = useStudioStore((s) => s.setMode);
  const dirty = useStudioStore((s) => s.dirty);
  return (
    <header
      className="flex h-12 w-full shrink-0 items-center gap-3 border-b px-4"
      style={{ background: "var(--card)" }}
    >
      <img src="/zotra-wordmark.svg" alt="Zotra" width={76} height={22} className="shrink-0" />
      <span className="h-5 w-px shrink-0" style={{ background: "var(--border)" }} />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
        <a
          href="/processes"
          title="All processes"
          className="truncate hover:underline"
          onClick={(e) => {
            if (dirty && !window.confirm("The draft has unsaved changes. Leave the studio?")) {
              e.preventDefault();
            }
          }}
        >
          {def.theme.brand_name}
        </a>
        <ChevronRight size={14} className="shrink-0" />
        <span className="truncate font-semibold">{proposalName ?? def.name}</span>
        {proposalName !== undefined && (
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-[12px]"
            style={{ borderColor: "#7c3aed", color: "#7c3aed" }}
          >
            Proposal
          </span>
        )}
      </nav>
      {version !== undefined && (
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px]">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden="true"
          />
          {/* A native select, not a Radix one: the option list must
              render in plain html for the rows. */}
          <select
            aria-label="Version"
            value={version.id}
            disabled={onSelectVersion === undefined}
            onChange={(e) => onSelectVersion?.(e.target.value)}
            className="cursor-pointer bg-transparent text-[12px] outline-none"
          >
            {(versions.length > 0 ? versions : [version]).map((row) => (
              <option key={row.id} value={row.id}>
                {`v${row.number} · ${STATUS_TEXT[row.status] ?? row.status}`}
              </option>
            ))}
          </select>
        </span>
      )}
      {dirty && (
        <span className="shrink-0">
          <UnsavedBadge className="text-[12px]" />
        </span>
      )}
      {onUndo !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!canUndo}
          title="Undo the last save (Ctrl+Z)"
          onClick={() => onUndo()}
        >
          <Undo2 aria-hidden="true" />
          Undo
        </Button>
      )}
      <span className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-pressed={policyOpen}
        onClick={() => onTogglePolicy?.()}
      >
        <FileText aria-hidden="true" />
        Policy
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => onNewFromPolicy?.()}
      >
        <Upload aria-hidden="true" />
        New from policy
      </Button>
      <div
        role="group"
        aria-label="Mode"
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-[#e4e4e7] p-0.5"
      >
        <button
          type="button"
          aria-pressed={mode === "design"}
          className="rounded px-2.5 py-1 text-[12.5px] font-medium"
          style={mode === "design" ? { background: "var(--secondary)" } : undefined}
          onClick={() => setMode("design")}
        >
          Design
        </button>
        <button
          type="button"
          aria-pressed={mode === "test"}
          className="rounded px-2.5 py-1 text-[12.5px] font-medium"
          style={mode === "test" ? { background: "var(--secondary)" } : undefined}
          onClick={() => setMode("test")}
        >
          Test
        </button>
        <button
          type="button"
          disabled
          title="The monitor screen is not built yet"
          className="px-2.5 py-1 text-[12.5px] text-muted-foreground"
        >
          Monitor
        </button>
      </div>
      {version !== undefined && (
        <div className="shrink-0">
          <VersionActions
            def={def}
            version={version}
            versions={versions}
            versionsPending={versionsPending}
            onVersionsChanged={onVersionsChanged}
            onOpenVersion={onSelectVersion}
          />
        </div>
      )}
    </header>
  );
}

// pushUndo appends the definition that a save replaces. The stack
// keeps at most 20 entries.
export function pushUndo(
  stack: ProcessDefinition[],
  def: ProcessDefinition,
): ProcessDefinition[] {
  return [...stack.slice(-19), def];
}
