// The pure functions of the process library page: one row for each
// process, the search, the status filter, the sort, and the shapes of
// the diagram thumbnail.

import type { layoutProcess } from "./layout";
import type { ProcessSummary, Version } from "./types";

// The studio home is the library; a query (process, new, intro) opens the studio.
export function isLibraryPage(pathname: string, search: string): boolean {
  return pathname === "/processes" || ((pathname === "/" || pathname === "/studio") && search === "");
}

export type LibraryStatus = "published" | "frozen" | "draft" | "empty";
export type LibraryFilter = LibraryStatus | "all" | "archived";

export interface LibraryRow {
  id: string;
  name: string;
  createdAt: string;
  archived: boolean;
  // null: the versions are not loaded.
  status: LibraryStatus | null;
  // true: the versions query failed.
  failed: boolean;
  published: Version | null;
  latest: Version | null;
  steps: number;
  roles: number;
}

function highest(versions: Version[]): Version | null {
  return versions.reduce<Version | null>(
    (best, v) => (best === null || v.number > best.number ? v : best),
    null,
  );
}

export function libraryRow(
  p: ProcessSummary,
  versions: Version[] | undefined,
  failed: boolean,
): LibraryRow {
  const row: LibraryRow = {
    id: p.id,
    name: p.name,
    createdAt: p.created_at,
    archived: p.archived_at != null,
    status: null,
    failed,
    published: null,
    latest: null,
    steps: 0,
    roles: 0,
  };
  if (versions === undefined) {
    return row;
  }
  const latest = highest(versions);
  if (latest === null) {
    return { ...row, status: "empty" };
  }
  const published = highest(versions.filter((v) => v.status === "published"));
  return {
    ...row,
    status: published === null ? latest.status : "published",
    published,
    latest,
    steps: latest.definition.nodes.length,
    roles: latest.definition.roles.length,
  };
}

// The "archived" filter keeps only the archived rows. Every other
// filter drops them first.
export function filterRows(
  rows: LibraryRow[],
  query: string,
  filter: LibraryFilter,
): LibraryRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(q) &&
      (filter === "archived"
        ? row.archived
        : !row.archived && (filter === "all" || row.status === filter)),
  );
}

export type LibrarySort = "latest" | "name" | "created";

function compareKey(a: LibraryRow, b: LibraryRow, sort: LibrarySort): number {
  if (sort === "name") {
    return a.name.localeCompare(b.name);
  }
  if (sort === "created") {
    return b.createdAt.localeCompare(a.createdAt);
  }
  if (a.latest === null || b.latest === null) {
    return (a.latest === null ? 1 : 0) - (b.latest === null ? 1 : 0);
  }
  return b.latest.created_at.localeCompare(a.latest.created_at);
}

export function sortRows(rows: LibraryRow[], sort: LibrarySort): LibraryRow[] {
  return [...rows].sort(
    (a, b) => compareKey(a, b, sort) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export interface ThumbnailNode {
  id: string;
  kind: "rect" | "diamond" | "circle";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export interface ThumbnailShapes {
  width: number;
  height: number;
  edges: string[];
  nodes: ThumbnailNode[];
}

export function thumbnailShapes(
  layout: Awaited<ReturnType<typeof layoutProcess>>,
): ThumbnailShapes {
  return {
    width: layout.width,
    height: layout.height,
    edges: layout.edges.map((e) => (e.data?.points ?? []).map((p) => `${p.x},${p.y}`).join(" ")),
    nodes: layout.nodes.map((n) => ({
      id: n.id,
      kind: n.type === "task" ? "rect" : n.type === "gateway" ? "diamond" : "circle",
      x: n.position.x,
      y: n.position.y,
      w: n.width ?? 0,
      h: n.height ?? 0,
      fill: n.data.color ?? "#e4e4e7",
    })),
  };
}
