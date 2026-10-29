// The studio shell: it loads the process, the versions and the
// version, in this order, then renders the top bar, the diagram and
// the node panel, plus the import dialog.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  createProcess,
  createVersion,
  getVersion,
  listProcesses,
  listVersions,
} from "./api";
import { Button } from "@/ui/button";
import { diffDefinitions } from "./diff";
import { PolicyPanel } from "./PolicyPanel";
import { ProcessDiagram } from "./diagram";
import { ImportDialog } from "./ImportDialog";
import { NodePanel, UnsavedBadge } from "./NodePanel";
import { ProcessPanel } from "./ProcessPanel";
import { ProposalBar } from "./ProposalBar";
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

// The diff base of a proposal with no opened version: every element
// of the proposal is then an addition.
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

  // onSelectVersion opens the version of the selector click and
  // writes the id into the URL, so a reload reopens the same
  // version. processId is non-null when the bar renders a version:
  // the version query needs it.
  function onSelectVersion(id: string) {
    setVersionOverride(id);
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
  }

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
    const diffBase = loadedDef ?? EMPTY_DEFINITION;
    content = (
      <div className="flex h-screen flex-col">
        <TopBar
          def={loadedDef ?? proposal.definition}
          version={version ?? undefined}
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
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <ProcessDiagram
                def={proposal.definition}
                selectedNodeId={selectedNodeId}
                onNodeSelect={select}
                ghost
                onCitationClick={onCitationClick}
              />
            </div>
            {policyOpen && (
              <div className="h-[40%] shrink-0 overflow-hidden border-t">
                <PolicyPanel file={panelFile} highlight={highlight} />
              </div>
            )}
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
        />
        <main className="flex min-h-0 flex-1">
          {mode === "test" ? (
            <TestScreen def={loaded.definition} version={version} />
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="min-h-0 flex-1">
                  <ProcessDiagram
                    def={loaded.definition}
                    selectedNodeId={selectedNodeId}
                    onNodeSelect={select}
                    ghost={false}
                    onCitationClick={onCitationClick}
                    highlightNodeIds={selectedNodeId === null ? canvasFocus : null}
                  />
                </div>
                {policyOpen && (
                  <div className="h-[40%] shrink-0 overflow-hidden border-t">
                    <PolicyPanel file={panelFile} highlight={highlight} />
                  </div>
                )}
              </div>
              <aside
                aria-label="Step detail"
                className="flex w-[380px] shrink-0 flex-col border-l"
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
                    onSaved={() =>
                      queryClient.invalidateQueries({
                        queryKey: ["version", versionId],
                      })
                    }
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
  onNewFromPolicy,
  policyOpen = false,
  onTogglePolicy,
  versions = [],
  versionsPending = false,
  onVersionsChanged = () => {},
  onSelectVersion,
}: {
  def: ProcessDefinition;
  version?: VersionSummary;
  onNewFromPolicy?: () => void;
  policyOpen?: boolean;
  onTogglePolicy?: () => void;
  versions?: VersionSummary[];
  versionsPending?: boolean;
  onVersionsChanged?: () => void;
  onSelectVersion?: (id: string) => void;
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
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#18181b" />
        <path
          d="M7 7.5h10L7 16.5h10"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="17" cy="7.5" r="1.6" fill="#fff" />
      </svg>
      <span className="font-semibold">Zotra</span>
      <span className="h-5 w-px shrink-0" style={{ background: "var(--border)" }} />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
        <span className="truncate">{def.theme.brand_name}</span>
        <ChevronRight size={14} className="shrink-0" />
        <span className="truncate font-semibold">{def.name}</span>
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
          />
        </div>
      )}
    </header>
  );
}
