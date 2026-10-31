// The test rows 53a to 53r, L1 to L6 and P1 to P10 of the process library. The environment is
// node: direct calls of the pure functions, and renderToString of the
// stateless view (one query client for the thumbnail query).

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import seedJson from "../../../examples/home-loan/process.json";
import { layoutProcess } from "./layout";
import {
  filterRows,
  isLibraryPage,
  libraryRow,
  sortRows,
  thumbnailShapes,
  type LibraryRow,
  type LibraryFilter,
  type LibrarySort,
  type LibraryStatus,
} from "./library";
import { LibraryView, STATUS_OPTIONS } from "./ProcessLibrary";
import type { ProcessDefinition, ProcessSummary, Version, VersionStatus } from "./types";

const seed = seedJson as ProcessDefinition;

const p: ProcessSummary = { id: "p1", name: "Home loan", created_at: "2026-10-01T08:00:00Z" };

function version(n: number, status: VersionStatus, createdAt = `2026-10-0${n}T09:00:00Z`): Version {
  return {
    id: `v${n}`,
    process_id: "p1",
    parent_id: null,
    number: n,
    label: `Label ${n}`,
    status,
    created_at: createdAt,
    frozen_at: null,
    definition: seed,
  };
}

function row(over: Partial<LibraryRow>): LibraryRow {
  return {
    id: "r",
    name: "Row",
    createdAt: "2026-10-01T00:00:00Z",
    archived: false,
    status: "draft",
    failed: false,
    published: null,
    latest: null,
    steps: 0,
    roles: 0,
    ...over,
  };
}

describe("libraryRow", () => {
  test("53a: versions not loaded, then failed", () => {
    const a = libraryRow(p, undefined, false);
    expect(a).toMatchObject({ status: null, latest: null, published: null, steps: 0, roles: 0, failed: false });
    expect(libraryRow(p, undefined, true).failed).toBe(true);
  });

  test("53b: no version gives empty", () => {
    expect(libraryRow(p, [], false).status).toBe("empty");
  });

  test("53c: v1 published, v2 draft", () => {
    const r = libraryRow(p, [version(1, "published"), version(2, "draft")], false);
    expect(r.published?.id).toBe("v1");
    expect(r.latest?.id).toBe("v2");
    expect(r.status).toBe("published");
    expect(r.steps).toBe(11);
    expect(r.roles).toBe(5);
  });

  test("53d: v1 frozen, v2 draft", () => {
    const r = libraryRow(p, [version(2, "draft"), version(1, "frozen")], false);
    expect(r.status).toBe("draft");
    expect(r.published).toBeNull();
  });

  test("53r: nodes that are not tasks count", () => {
    const definition = { ...seed, nodes: seed.nodes.filter((n) => n.type !== "task" && n.type !== "gateway") };
    const r = libraryRow(p, [{ ...version(1, "draft"), definition }], false);
    expect(r.steps).toBe(3);
  });
});

const rows: LibraryRow[] = [
  row({ id: "a", name: "Home loan", status: "published" }),
  row({ id: "b", name: "Consumer credit", status: "draft" }),
  row({ id: "c", name: "Loan review", status: null }),
];

describe("filterRows", () => {
  test("53e: the query is trimmed and case-insensitive", () => {
    expect(filterRows(rows, "  LOAN ", "all").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterRows(rows, "", "all")).toHaveLength(3);
  });

  test("53f: the status filter; a null status passes only all", () => {
    expect(filterRows(rows, "", "published").map((r) => r.id)).toEqual(["a"]);
    for (const s of ["published", "frozen", "draft", "empty"] as LibraryStatus[]) {
      expect(filterRows(rows, "", s).some((r) => r.id === "c")).toBe(false);
    }
    expect(filterRows(rows, "", "all").some((r) => r.id === "c")).toBe(true);
  });
});

describe("sortRows", () => {
  const sortable = [
    row({ id: "x", name: "Beta", createdAt: "2026-10-02T00:00:00Z", latest: version(1, "draft", "2026-10-05T00:00:00Z") }),
    row({ id: "y", name: "Alpha", createdAt: "2026-10-03T00:00:00Z", latest: null }),
    row({ id: "z", name: "Gamma", createdAt: "2026-10-01T00:00:00Z", latest: version(2, "draft", "2026-10-09T00:00:00Z") }),
  ];
  const ids = (s: LibrarySort) => sortRows(sortable, s).map((r) => r.id);

  test("53g: latest version, newest first, no latest last", () => {
    expect(ids("latest")).toEqual(["z", "x", "y"]);
    expect(sortable.map((r) => r.id)).toEqual(["x", "y", "z"]);
  });

  test("53h: name order; newest created first", () => {
    expect(ids("name")).toEqual(["y", "x", "z"]);
    expect(ids("created")).toEqual(["y", "x", "z"]);
  });

  test("53i: ties sort by id ascending", () => {
    const tied = [row({ id: "b", name: "Same" }), row({ id: "a", name: "Same" })];
    for (const s of ["latest", "name", "created"] as LibrarySort[]) {
      expect(sortRows(tied, s).map((r) => r.id)).toEqual(["a", "b"]);
    }
  });
});

describe("thumbnailShapes", () => {
  test("53j: one shape per node, kinds by type, one edge text per edge", async () => {
    const shapes = thumbnailShapes(await layoutProcess(seed));
    expect(shapes.nodes).toHaveLength(seed.nodes.length);
    expect(shapes.edges).toHaveLength(seed.edges.length);
    const kind = { task: "rect", gateway: "diamond", start: "circle", end: "circle" };
    for (const node of seed.nodes) {
      expect(shapes.nodes.find((n) => n.id === node.id)?.kind).toBe(kind[node.type]);
    }
    for (const e of shapes.edges) {
      expect(e).toMatch(/^-?[\d.]+,-?[\d.]+( -?[\d.]+,-?[\d.]+)+$/);
    }
    expect(shapes.width).toBeGreaterThan(0);
  });

  test("53k: a null color gives the grey fill", async () => {
    const layout = await layoutProcess(seed);
    const start = layout.nodes.find((n) => n.type === "start")!;
    expect(start.data.color).toBeNull();
    const shapes = thumbnailShapes(layout);
    expect(shapes.nodes.find((n) => n.id === start.id)?.fill).toBe("#e4e4e7");
  });
});

function view(viewRows: LibraryRow[], over: { query?: string; status?: LibraryFilter; view?: "table" | "cards" } = {}) {
  const noop = () => {};
  return renderToString(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(LibraryView, {
        rows: viewRows,
        query: over.query ?? "",
        status: over.status ?? "all",
        sort: "latest",
        view: over.view ?? "table",
        onQuery: noop,
        onStatus: noop,
        onSort: noop,
        onView: noop,
        onArchive: noop,
      }),
    ),
  );
}

const loaded = libraryRow(p, [version(1, "published"), version(2, "draft")], false);
const other = libraryRow({ id: "p2", name: "Consumer credit", created_at: "2026-10-02T08:00:00Z" }, [version(1, "draft")], false);

describe("LibraryView", () => {
  test("53l: table with 2 rows", () => {
    const html = view([loaded, other]);
    expect(html).toContain("Processes");
    expect(html).toContain('aria-label="About processes"');
    expect(html).toContain("2 processes");
    expect(html.match(/href="\/\?process=/g)).toHaveLength(2);
    expect(html).toContain("11 steps, 5 roles");
    expect(html).not.toContain("6 steps");
    expect(html).toContain("v1 Label 1");
    expect(html).toContain(">Search processes</span>");
    expect(html).toContain("lucide-search");
  });

  test("53m: 1 row", () => {
    expect(view([loaded])).toContain("1 process<");
  });

  test("53n: card view", () => {
    const html = view([loaded], { view: "cards" });
    expect(html).toMatch(/aria-label="Card view" aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Card view"/);
    expect(html).toContain("bg-muted");
    expect(html).toContain("Latest v2,");
  });

  test("53o: no match", () => {
    const html = view([loaded], { query: "zzz" });
    expect(html).toContain("No process matches the search.");
    expect(html).not.toContain(">Search processes</span>");
  });

  test("53p: zero processes", () => {
    const html = view([]);
    expect(html).toContain("No process yet.");
    expect(html).toContain('href="/?new=1"');
  });

  test("53q: status texts", () => {
    expect(view([libraryRow(p, undefined, false)])).toContain("Loading");
    expect(view([libraryRow(p, undefined, true)])).toContain("Not loaded");
    expect(view([libraryRow(p, [], false)])).toContain("No version");
  });
});

describe("archive", () => {
  test("L1: archived_at gives archived", () => {
    expect(libraryRow({ ...p, archived_at: "2026-10-30T10:00:00Z" }, undefined, false).archived).toBe(true);
    expect(libraryRow({ ...p, archived_at: null }, undefined, false).archived).toBe(false);
    expect(libraryRow(p, undefined, false).archived).toBe(false);
  });

  const pair = [
    row({ id: "old", name: "Old loan", status: "draft", archived: true }),
    row({ id: "new", name: "New loan", status: "draft" }),
  ];

  test("L2: all drops the archived row", () => {
    expect(filterRows(pair, "", "all").map((r) => r.id)).toEqual(["new"]);
  });

  test("L3: archived keeps only the archived row", () => {
    expect(filterRows(pair, "", "archived").map((r) => r.id)).toEqual(["old"]);
  });

  test("L4: draft drops the archived row", () => {
    expect(filterRows(pair, "", "draft").map((r) => r.id)).toEqual(["new"]);
  });

  test("L5: the archived filter shows Restore", () => {
    const html = view(pair, { status: "archived" });
    expect(html).toContain('aria-label="Restore Old loan"');
    expect(html).not.toContain("Archive Old loan");
    expect(html).not.toContain("New loan");
    expect(html).toContain("1 process<");
  });

  test("L6: all shows Archive; the filter list has Archived", () => {
    const html = view(pair, { status: "all" });
    expect(html).toContain('aria-label="Archive New loan"');
    expect(html).toContain('title="Archive"');
    expect(html).not.toContain("Old loan");
    expect(STATUS_OPTIONS.at(-1)).toEqual(["archived", "Archived"]);
  });
});

describe("library page", () => {
  test.each([
    ["P1", "/processes", "", true],
    ["P2", "/processes", "?status=draft", true],
    ["P3", "/", "", true],
    ["P4", "/studio", "", true],
    ["P5", "/", "?process=p1", false],
    ["P6", "/studio", "?process=p1&version=v1", false],
    ["P7", "/", "?new=1", false],
    ["P8", "/", "?intro=1", false],
    ["P9", "/app", "", false],
    ["P10", "/other", "", false],
  ])("%s: %s%s", (_row, pathname, search, expected) => {
    expect(isLibraryPage(pathname, search)).toBe(expected);
  });
});
