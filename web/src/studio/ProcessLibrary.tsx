// The process library page (/processes): every process of the studio,
// as a table or as cards with a diagram thumbnail. The user searches,
// filters, sorts and opens a process in the studio.

import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronRight, LayoutGrid, List, Search, Upload } from "lucide-react";
import { listProcesses, listVersions } from "./api";
import { layoutProcess } from "./layout";
import {
  filterRows,
  libraryRow,
  sortRows,
  thumbnailShapes,
  type LibraryRow,
  type LibrarySort,
  type LibraryStatus,
} from "./library";
import { STATUS_BADGE, dateText } from "./version-actions";
import type { Version } from "./types";
import { Button, buttonVariants } from "@/ui/button";
import { Hint } from "@/ui/hint";
import { Input } from "@/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import { cn } from "@/lib/utils";

type LibraryViewMode = "table" | "cards";

const STATUS_OPTIONS: [LibraryStatus | "all", string][] = [
  ["all", "All statuses"],
  ["published", "Published"],
  ["frozen", "Frozen"],
  ["draft", "Draft"],
  ["empty", "No version"],
];

const SORT_OPTIONS: [LibrarySort, string][] = [
  ["latest", "Latest version"],
  ["name", "Name"],
  ["created", "Created"],
];

const TABLE_COLUMNS = "grid-cols-[2fr_1fr_1.3fr_1.4fr_1fr_16px]";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : word.endsWith("s") ? "es" : "s"}`;
}

function processUrl(id: string): string {
  return `/?process=${encodeURIComponent(id)}`;
}

function NewFromPolicyLink() {
  return (
    <a href="/?new=1" className={buttonVariants()}>
      <Upload />
      New from policy
    </a>
  );
}

function StatusCell({ row }: { row: LibraryRow }) {
  if (row.status === null) {
    return (
      <span className="text-muted-foreground">{row.failed ? "Not loaded" : "Loading"}</span>
    );
  }
  if (row.status === "empty") {
    return <span className="text-muted-foreground">No version</span>;
  }
  const [text, cls] = STATUS_BADGE[row.status];
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[12px] font-medium", cls)}>
      {text}
    </span>
  );
}

function countsText(row: LibraryRow): string {
  return `${plural(row.steps, "step")}, ${plural(row.roles, "role")}`;
}

function TableRows({ rows }: { rows: LibraryRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card text-[13px]">
      <div className={cn("grid gap-3 border-b px-4 py-2.5 text-muted-foreground", TABLE_COLUMNS)}>
        <span>Process</span>
        <span>Status</span>
        <span>Published</span>
        <span>Latest version</span>
        <span>Created</span>
        <span />
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.id} className="border-b last:border-b-0">
            <a
              href={processUrl(row.id)}
              className={cn("grid items-center gap-3 px-4 py-3 hover:bg-muted/50", TABLE_COLUMNS)}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{row.name}</span>
                {row.latest !== null && (
                  <span className="block text-muted-foreground">{countsText(row)}</span>
                )}
              </span>
              <span>
                <StatusCell row={row} />
              </span>
              <span className="truncate">
                {row.status === null
                  ? ""
                  : row.published === null
                    ? <span className="text-muted-foreground">None</span>
                    : `v${row.published.number} ${row.published.label}`}
              </span>
              <span>
                {row.status === null
                  ? ""
                  : row.latest === null
                    ? <span className="text-muted-foreground">None</span>
                    : `v${row.latest.number}, ${dateText(row.latest.created_at)}`}
              </span>
              <span>{dateText(row.createdAt)}</span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardRows({ rows }: { rows: LibraryRow[] }) {
  return (
    <ul className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
      {rows.map((row) => (
        <li key={row.id}>
          <a
            href={processUrl(row.id)}
            className="flex h-full flex-col gap-2 rounded-lg border bg-card p-3 text-[13px] hover:border-muted-foreground/40"
          >
            <span className="block h-32">
              {row.latest === null ? (
                <span className="block h-full rounded-md bg-muted" />
              ) : (
                <ProcessThumbnail version={row.latest} />
              )}
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{row.name}</span>
              <StatusCell row={row} />
            </span>
            {row.latest !== null && (
              <>
                <span className="text-muted-foreground">{countsText(row)}</span>
                <span className="text-muted-foreground">
                  {`Latest v${row.latest.number}, ${dateText(row.latest.created_at)}`}
                </span>
              </>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ProcessThumbnail({ version }: { version: Version }) {
  const q = useQuery({
    queryKey: ["thumbnail", version.id, version.definition],
    queryFn: () => layoutProcess(version.definition),
    staleTime: Infinity,
  });
  if (q.data === undefined) {
    return <span className="block h-full rounded-md bg-muted" />;
  }
  const shapes = thumbnailShapes(q.data);
  return (
    <svg
      role="img"
      aria-label={`Diagram of ${version.definition.name}`}
      viewBox={`0 0 ${shapes.width} ${shapes.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full rounded-md bg-muted/40"
    >
      {shapes.edges.map((points, i) => (
        <polyline
          key={i}
          points={points}
          fill="none"
          stroke="#a1a1aa"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {shapes.nodes.map((n) =>
        n.kind === "rect" ? (
          <rect key={n.id} x={n.x} y={n.y} width={n.w} height={n.h} rx={6} fill={n.fill} />
        ) : n.kind === "diamond" ? (
          <polygon
            key={n.id}
            points={`${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h / 2} ${n.x + n.w / 2},${n.y + n.h} ${n.x},${n.y + n.h / 2}`}
            fill={n.fill}
          />
        ) : (
          <ellipse key={n.id} cx={n.x + n.w / 2} cy={n.y + n.h / 2} rx={n.w / 2} ry={n.h / 2} fill={n.fill} />
        ),
      )}
    </svg>
  );
}

export function LibraryView({
  rows,
  query,
  status,
  sort,
  view,
  onQuery,
  onStatus,
  onSort,
  onView,
}: {
  rows: LibraryRow[];
  query: string;
  status: LibraryStatus | "all";
  sort: LibrarySort;
  view: LibraryViewMode;
  onQuery: (query: string) => void;
  onStatus: (status: LibraryStatus | "all") => void;
  onSort: (sort: LibrarySort) => void;
  onView: (view: LibraryViewMode) => void;
}) {
  const shown = sortRows(filterRows(rows, query, status), sort);
  return (
    <div className="mx-auto flex w-full max-w-[1152px] flex-col gap-4 px-6 py-8">
      <div className="flex items-center gap-2">
        <h1 className="text-[22px] font-semibold">Processes</h1>
        <Hint label="About processes">
          Each process of the bank, with its versions. A click opens the process in the studio.
        </Hint>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative w-80">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          {query === "" && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-8 -translate-y-1/2 text-sm text-muted-foreground"
            >
              Search processes
            </span>
          )}
          <Input
            aria-label="Search processes"
            title="Search by name"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            className="pl-8"
          />
        </span>
        <Select value={status} onValueChange={(v) => onStatus(v as LibraryStatus | "all")}>
          <SelectTrigger aria-label="Status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(([value, text]) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => onSort(v as LibrarySort)}>
          <SelectTrigger aria-label="Sort" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(([value, text]) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Table view"
            aria-pressed={view === "table"}
            onClick={() => onView("table")}
          >
            <List />
          </Button>
          <Button
            variant={view === "cards" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Card view"
            aria-pressed={view === "cards"}
            onClick={() => onView("cards")}
          >
            <LayoutGrid />
          </Button>
        </div>
        <span className="ml-auto text-[13px] text-muted-foreground">
          {plural(shown.length, "process")}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 text-[13px]">
          <span>No process yet.</span>
          <NewFromPolicyLink />
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-[13px] text-muted-foreground">
          No process matches the search.
        </p>
      ) : view === "table" ? (
        <TableRows rows={shown} />
      ) : (
        <CardRows rows={shown} />
      )}
    </div>
  );
}

export function ProcessLibrary() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LibraryStatus | "all">("all");
  const [sort, setSort] = useState<LibrarySort>("latest");
  const [view, setView] = useState<LibraryViewMode>("table");
  const processes = useQuery({ queryKey: ["processes"], queryFn: listProcesses });
  const versions = useQueries({
    queries: (processes.data ?? []).map((p) => ({
      queryKey: ["versions", p.id],
      queryFn: () => listVersions(p.id),
    })),
  });
  const rows = (processes.data ?? []).map((p, i) =>
    libraryRow(p, versions[i]?.data, versions[i]?.isError ?? false),
  );
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header
        className="flex h-12 w-full shrink-0 items-center gap-3 border-b px-4"
        style={{ background: "var(--card)" }}
      >
        <a href="/" aria-label="Open the studio" className="shrink-0">
          <img src="/zotra-wordmark.svg" alt="Zotra" width={76} height={22} />
        </a>
        <span className="ml-auto">
          <NewFromPolicyLink />
        </span>
      </header>
      <main className="flex-1">
        {processes.isPending ? (
          <p className="p-8 text-center text-[13px] text-muted-foreground">Loading the processes</p>
        ) : processes.isError ? (
          <div className="p-8 text-center text-[13px]">
            <p>The processes did not load.</p>
            <p className="text-muted-foreground">{processes.error.message}</p>
          </div>
        ) : (
          <LibraryView
            rows={rows}
            query={query}
            status={status}
            sort={sort}
            view={view}
            onQuery={setQuery}
            onStatus={setStatus}
            onSort={setSort}
            onView={setView}
          />
        )}
      </main>
    </div>
  );
}
