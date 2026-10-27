// The studio shell: it loads the process, the versions and the
// version, in this order, then renders the top bar and the diagram.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { getVersion, listProcesses, listVersions, ApiError } from "./api";
import { ProcessDiagram } from "./diagram";
import type {
  ProcessDefinition,
  ProcessSummary,
  VersionSummary,
} from "./types";

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

export function StudioShell() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const q1 = useQuery({ queryKey: ["processes"], queryFn: listProcesses });
  const process = useMemo(() => pickProcess(q1.data), [q1.data]);
  const processId = process ? process.id : null;
  const q2 = useQuery({
    queryKey: ["versions", processId],
    queryFn: () => listVersions(processId!),
    enabled: processId !== null,
  });
  const version = useMemo(() => pickVersion(q2.data), [q2.data]);
  const versionId = version ? version.id : null;
  const q3 = useQuery({
    queryKey: ["version", versionId],
    queryFn: () => getVersion(versionId!),
    enabled: versionId !== null,
  });

  // Stage 1: processes.
  if (q1.isError) {
    return <ErrorScreen error={q1.error} />;
  }
  if (q1.isPending) {
    return <Loading />;
  }
  if (process === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">No process yet.</h1>
        <p className="text-muted-foreground">
          Import a credit policy to create one.
        </p>
      </div>
    );
  }

  // Stage 2: versions of the picked process. A disabled query is not
  // pending, so the empty states below are reachable.
  if (q2.isError) {
    return <ErrorScreen error={q2.error} />;
  }
  if (q2.isPending) {
    return <Loading />;
  }
  if (version === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">No version yet.</h1>
        <p className="text-muted-foreground">Create a draft to start.</p>
      </div>
    );
  }

  // Stage 3: the picked version.
  if (q3.isError) {
    return <ErrorScreen error={q3.error} />;
  }
  if (q3.isPending) {
    return <Loading />;
  }

  const loaded = q3.data;
  return (
    <div className="flex h-screen flex-col">
      <TopBar def={loaded.definition} version={version} />
      <main className="min-h-0 flex-1">
        <ProcessDiagram
          def={loaded.definition}
          selectedNodeId={selectedNodeId}
          onNodeSelect={setSelectedNodeId}
        />
      </main>
    </div>
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
}: {
  def: ProcessDefinition;
  version: VersionSummary;
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
