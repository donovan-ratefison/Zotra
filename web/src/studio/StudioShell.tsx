// The studio shell: it loads the process, the versions and the
// version, in this order, then renders the top bar, the diagram and
// the node panel, plus the import dialog.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Upload } from "lucide-react";
import { getVersion, listProcesses, listVersions, ApiError } from "./api";
import { Button } from "@/ui/button";
import { ProcessDiagram } from "./diagram";
import { ImportDialog } from "./ImportDialog";
import { NodePanel } from "./NodePanel";
import type { Paragraph } from "./policy";
import { useStudioStore, type PanelTab } from "./store";
import type {
  ProcessDefinition,
  ProcessSummary,
  VersionSummary,
} from "./types";

// lastImport carries the import result for lot 2.5: the PDF panel
// and the citation highlight read it.
interface LastImport {
  processId: string;
  versionId: string;
  paragraphs: Paragraph[];
  file: File;
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
  // Lot 2.5 reads lastImport for the PDF panel and the highlight.
  void lastImport;

  // URL parameters, read once at mount. The tab parameter applies
  // only when it names a known tab; anything else is ignored.
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    if (TAB_VALUES.includes(value as PanelTab)) {
      setTab(value as PanelTab);
    }
    // setTab is a stable zustand setter, so this runs once, at mount.
  }, [setTab]);

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
  const version = useMemo(() => {
    const rows = q2.data;
    if (rows && rows.length > 0 && typeof window !== "undefined") {
      const id = new URLSearchParams(window.location.search).get("version");
      const match = id ? rows.find((row) => row.id === id) : undefined;
      if (match) {
        return match;
      }
    }
    return pickVersion(rows);
  }, [q2.data]);
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

  // onImported keeps the import for lot 2.5, writes the new URL, and
  // refetches the queries. The picks then read the new ids and the
  // shell opens the new draft.
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
    void queryClient.invalidateQueries({ queryKey: ["processes"] });
    void queryClient.invalidateQueries({ queryKey: ["versions", processId] });
    void queryClient.invalidateQueries({ queryKey: ["version", versionId] });
  }

  // Every state renders inside one layout, with the import dialog
  // mounted once above the branches. The dialog stays mounted while
  // the queries fetch, and new=1 opens it in every state.
  let content: ReactNode;
  // Stage 1: processes.
  if (q1.isError) {
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
        />
        <main className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <ProcessDiagram
              def={loaded.definition}
              selectedNodeId={selectedNodeId}
              onNodeSelect={select}
            />
          </div>
          <aside
            aria-label="Step detail"
            className="flex w-[380px] shrink-0 flex-col border-l"
          >
            {selectedNodeId === null ? (
              <div className="flex flex-col gap-1.5 px-4 pt-3.5">
                <h2 className="text-[17px] font-semibold leading-tight">
                  No step selected
                </h2>
                <p className="text-xs text-muted-foreground">
                  Select a step on the diagram to edit it.
                </p>
              </div>
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
        onImported={onImported}
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
}: {
  def: ProcessDefinition;
  version: VersionSummary;
  onNewFromPolicy?: () => void;
}) {
  const statusText = STATUS_TEXT[version.status] ?? version.status;
  const dotColor = STATUS_DOT[version.status] ?? "#71717a";
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
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px]">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: dotColor }}
          aria-hidden="true"
        />
        {`v${version.number} · ${statusText}`}
      </span>
      <span className="flex-1" />
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
          aria-pressed="true"
          className="rounded px-2.5 py-1 text-[12.5px] font-medium"
          style={{ background: "var(--secondary)" }}
        >
          Design
        </button>
        <button
          type="button"
          disabled
          title="The test screen is not built yet"
          className="px-2.5 py-1 text-[12.5px] text-muted-foreground"
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
    </header>
  );
}
