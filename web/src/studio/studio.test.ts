// The 27 test rows of the studio brief, in order.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { getVersion, listProcesses, listVersions, ApiError } from "./api";
import { edgePillText, layoutProcess, roleColor, toElkGraph } from "./layout";
import { EventShape, TaskCard } from "./diagram";
import { StudioShell, TopBar } from "./StudioShell";
import type {
  NodeType,
  ProcessDefinition,
  ProcessEdge,
  VersionStatus,
  VersionSummary,
} from "./types";

const miniDefinition: ProcessDefinition = {
  schema_version: "1",
  name: "Mini loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
  roles: [{ id: "advisor", name: "Advisor", department: "Branch" }],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
  ],
  scope: [{ field: "amount", role: "advisor", access: "write" }],
  nodes: [
    {
      id: "start", type: "start", name: "Application received", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "entry", type: "task", name: "Application entry", role: "advisor",
      deadline_hours: 24, documents: ["ID"], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "review", type: "task", name: "Review", role: "ghost",
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "complete", type: "gateway", name: "File complete?", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "released", type: "end", name: "Loan released", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "approved", scope_overrides: [],
      source_ids: [], citations: [],
    },
    {
      id: "refused", type: "end", name: "Loan refused", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "refused", scope_overrides: [],
      source_ids: [], citations: [],
    },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
    { id: "e2", from: "entry", to: "review", label: null, decision: null, condition: null, is_default: false },
    { id: "e3", from: "review", to: "complete", label: null, decision: null, condition: null, is_default: false },
    { id: "e4", from: "complete", to: "released", label: null, decision: null, condition: "size(documents) >= 4", is_default: false },
    { id: "e5", from: "complete", to: "refused", label: null, decision: null, condition: "amount < 0.0", is_default: false },
    { id: "e6", from: "complete", to: "entry", label: "Send back", decision: null, condition: null, is_default: true },
  ],
  sources: [],
};

const edgeById = (id: string): ProcessEdge =>
  miniDefinition.edges.find((e) => e.id === id)!;

// The error-path stubs need only ok, status and json, the surface
// that getJson reads.
function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    () => Promise.resolve({ ok: status < 400, status, json: async () => body }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// A full version row with exact values; status accepts any raw value,
// so the unknown-status row can use "archived".
function versionRow(number: number, status: string): VersionSummary {
  return {
    id: `v${number}`,
    process_id: "p1",
    parent_id: null,
    number,
    label: "Initial",
    status: status as VersionStatus,
    created_at: "2026-10-27T09:00:00Z",
    frozen_at: status === "published" ? "2026-10-27T09:30:00Z" : null,
  };
}

describe("layout helpers", () => {
  test("1: roleColor of a known role", () => {
    expect(roleColor(miniDefinition, "advisor")).toBe("#0891b2");
  });

  test("2: roleColor of an unknown role and of null", () => {
    expect(roleColor(miniDefinition, "nobody")).toBeNull();
    expect(roleColor(miniDefinition, null)).toBeNull();
  });

  test("3: edgePillText of a labeled edge", () => {
    expect(edgePillText(edgeById("e6"))).toBe("Send back");
  });

  test("4: edgePillText of a condition edge", () => {
    expect(edgePillText(edgeById("e4"))).toBe("size(documents) >= 4");
  });

  test("5: edgePillText of a decision edge", () => {
    expect(
      edgePillText({
        id: "x", from: "a", to: "b", label: null, decision: "approve",
        condition: null, is_default: false,
      }),
    ).toBe("approve");
  });

  test("6: edgePillText of a default edge", () => {
    expect(
      edgePillText({
        id: "x", from: "a", to: "b", label: null, decision: null,
        condition: null, is_default: true,
      }),
    ).toBe("Default");
  });

  test("7: edgePillText of a plain edge", () => {
    expect(edgePillText(edgeById("e1"))).toBeNull();
  });

  test("8: layoutProcess lays out the mini definition", async () => {
    const { nodes, edges } = await layoutProcess(miniDefinition);
    expect(nodes).toHaveLength(6);
    expect(edges).toHaveLength(6);
    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }
    for (const edge of edges) {
      expect(edge.data!.points.length).toBeGreaterThanOrEqual(2);
      for (const point of edge.data!.points) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }
    const e2 = edges.find((edge) => edge.id === "e2")!;
    expect(e2.data!.points.length).toBe(4);
    // The sizes live on the ELK graph itself, so this check fails
    // when toElkGraph forgets to apply a size.
    const graph = toElkGraph(miniDefinition);
    for (const child of graph.children!) {
      if (child.id === "entry" || child.id === "review") {
        expect(child.width).toBe(128);
        expect(child.height).toBe(72);
      }
      if (child.id === "complete") {
        expect(child.width).toBe(52);
        expect(child.height).toBe(52);
      }
    }
  });

  test("9: layoutProcess refuses an unknown node type", async () => {
    const badType: ProcessDefinition = {
      ...miniDefinition,
      nodes: miniDefinition.nodes.map((node) =>
        node.id === "entry"
          ? { ...node, type: "service" as unknown as NodeType }
          : node,
      ),
    };
    await expect(layoutProcess(badType)).rejects.toThrow(
      "unknown node type: service (node entry)",
    );
  });

  test("10: layoutProcess refuses an unknown edge endpoint", async () => {
    const badFrom: ProcessDefinition = {
      ...miniDefinition,
      edges: miniDefinition.edges.map((edge) =>
        edge.id === "e1" ? { ...edge, from: "nowhere" } : edge,
      ),
    };
    await expect(layoutProcess(badFrom)).rejects.toThrow(
      "unknown node id: nowhere (edge e1)",
    );
  });
});

describe("api client", () => {
  test("11: listProcesses maps the API error body", async () => {
    stubFetch(500, { error: { code: "internal", message: "boom", details: [] } });
    const error: unknown = await listProcesses().then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(500);
    expect(apiError.code).toBe("internal");
    expect(apiError.message).toBe("boom");
  });

  test("12: listProcesses falls back on a non-JSON error body", async () => {
    stubFetch(500, "not json");
    const error: unknown = await listProcesses().then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(500);
    expect(apiError.code).toBe("http");
    expect(apiError.message).toBe("HTTP 500");
  });

  test("13: listVersions unwraps the versions envelope", async () => {
    stubFetch(200, {
      versions: [
        {
          id: "v2", process_id: "p1", parent_id: null, number: 2,
          label: "Draft 2", status: "draft",
          created_at: "2026-10-27T10:00:00Z", frozen_at: null,
        },
        {
          id: "v1", process_id: "p1", parent_id: null, number: 1,
          label: "Initial", status: "published",
          created_at: "2026-10-27T09:00:00Z",
          frozen_at: "2026-10-27T09:30:00Z",
        },
      ],
    });
    const rows = await listVersions("p1");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe("v2");
  });

  test("14: getVersion unwraps the version envelope", async () => {
    stubFetch(200, {
      version: {
        id: "v1", process_id: "p1", parent_id: null, number: 1,
        label: "Initial", status: "published",
        created_at: "2026-10-27T09:00:00Z",
        frozen_at: "2026-10-27T09:30:00Z",
        definition: miniDefinition,
      },
    });
    const version = await getVersion("v1");
    expect(version.definition.name).toBe("Mini loan");
  });
});

describe("top bar", () => {
  test("15: the top bar renders brand, process and version", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(1, "published"),
      }),
    );
    expect(html).toContain("Mini Bank");
    expect(html).toContain("Mini loan");
    expect(html).toContain("v1 · Published");
    expect(html).toContain("Design");
    expect(html).toContain("Test");
    expect(html).toContain("Monitor");
  });

  test("16: a draft version reads v2 · Draft", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(2, "draft"),
      }),
    );
    expect(html).toContain("v2 · Draft");
  });

  test("17: a frozen version reads v4 · Frozen", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(4, "frozen"),
      }),
    );
    expect(html).toContain("v4 · Frozen");
  });

  test("18: an unknown status shows its raw value", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(3, "archived"),
      }),
    );
    expect(html).toContain("v3 · archived");
  });
});

describe("node shapes", () => {
  test("19: the task card shows role, deadline and document count", () => {
    const entry = miniDefinition.nodes.find((node) => node.id === "entry")!;
    const html = renderToString(
      createElement(TaskCard, {
        node: entry,
        color: roleColor(miniDefinition, "advisor"),
        roleName: "Advisor",
        selected: false,
      }),
    );
    expect(html).toContain("Advisor");
    expect(html).toContain("24 h");
    expect(html).toContain("1");
  });

  test("20: unknown role shows Automatic, null deadline shows nothing", () => {
    const review = miniDefinition.nodes.find((node) => node.id === "review")!;
    const html = renderToString(
      createElement(TaskCard, {
        node: review,
        color: null,
        roleName: null,
        selected: false,
      }),
    );
    expect(html).toContain("Automatic");
    expect(html).not.toMatch(/\d+ h/);
  });

  test("21: the selected task card carries the selection blue", () => {
    const entry = miniDefinition.nodes.find((node) => node.id === "entry")!;
    const html = renderToString(
      createElement(TaskCard, {
        node: entry,
        color: roleColor(miniDefinition, "advisor"),
        roleName: "Advisor",
        selected: true,
      }),
    );
    expect(html).toContain("#2563eb");
  });

  test("22: the approved end circle is green", () => {
    const released = miniDefinition.nodes.find((node) => node.id === "released")!;
    const html = renderToString(
      createElement(EventShape, { node: released, selected: false }),
    );
    expect(html).toContain("#16a34a");
  });

  test("23: the refused end circle is red", () => {
    const refused = miniDefinition.nodes.find((node) => node.id === "refused")!;
    const html = renderToString(
      createElement(EventShape, { node: refused, selected: false }),
    );
    expect(html).toContain("#dc2626");
  });

  test("24: the selected end circle carries the selection blue", () => {
    const released = miniDefinition.nodes.find((node) => node.id === "released")!;
    const html = renderToString(
      createElement(EventShape, { node: released, selected: true }),
    );
    expect(html).toContain("#2563eb");
  });
});

describe("shell states", () => {
  function renderShell(client: QueryClient): string {
    return renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ReactFlowProvider, null, createElement(StudioShell)),
      ),
    );
  }

  test("25: an empty process list shows the empty process state", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["processes"], []);
    const html = renderShell(client);
    expect(html).toContain("No process yet.");
    expect(html).toContain("Import a credit policy to create one.");
  });

  test("26: an empty version list shows the empty version state", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["processes"], [
      { id: "p1", name: "Mini loan", created_at: "2026-10-27T09:00:00Z" },
    ]);
    client.setQueryData(["versions", "p1"], []);
    const html = renderShell(client);
    expect(html).toContain("No version yet.");
    expect(html).toContain("Create a draft to start.");
  });
});
