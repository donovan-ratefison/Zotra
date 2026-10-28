// The test rows of lot 4.3, in the order of the brief. The
// environment is node: renderToString for the components, no jsdom
// (the patterns of the approved lots). The fixtures are the lot 3.1
// family, plus the coverage report of the brief.

import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { ApiError } from "./api";
import { generateTests } from "./ai-api";
import { getCoverage, type CaseState, type CoverageReport, type UserDTO } from "./case-api";
import { CoverageLegendRow, ElkEdge } from "./diagram";
import { TestScreen } from "./TestScreen";
import { useStudioStore, type StudioMode } from "./store";
import type { ProcessDefinition, VersionSummary } from "./types";

// The base fixture is the lot 3.1 test fixture: two roles, seven
// fields, the scope rows, the entry check c1, the analysis task and
// its two decision edges.
const testDefinition: ProcessDefinition = {
  schema_version: "1",
  name: "Mini loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
  roles: [
    { id: "advisor", name: "Advisor", department: "Branch" },
    { id: "analyst", name: "Analyst", department: "Risk" },
  ],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
    { name: "client_name", label: "Client", type: "string", options: [], computed: null },
    { name: "duration_months", label: "Duration (months)", type: "integer", options: [], computed: null },
    { name: "ok", label: "Ready", type: "boolean", options: [], computed: null },
    { name: "kind", label: "Kind", type: "enum", options: ["fast", "slow"], computed: null },
    { name: "signed_on", label: "Signed on", type: "date", options: [], computed: null },
    { name: "docs", label: "Documents", type: "document", options: [], computed: null },
  ],
  scope: [
    { field: "amount", role: "advisor", access: "write" },
    { field: "client_name", role: "advisor", access: "write" },
    { field: "duration_months", role: "advisor", access: "write" },
    { field: "ok", role: "advisor", access: "write" },
    { field: "kind", role: "advisor", access: "write" },
    { field: "signed_on", role: "advisor", access: "write" },
    { field: "docs", role: "advisor", access: "write" },
    { field: "amount", role: "analyst", access: "read" },
  ],
  nodes: [
    { id: "start", type: "start", name: "Application received", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "entry", type: "task", name: "Application entry", role: "advisor",
      deadline_hours: 24, documents: ["ID"], signature: false,
      checks: [{ id: "c1", expression: "amount > 10.0",
                 message: "The amount must be positive.",
                 plain_text: null, citations: [] }],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "review", type: "task", name: "Review", role: "ghost",
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "analysis", type: "task", name: "Credit analysis", role: "analyst",
      deadline_hours: 48, documents: [], signature: false, checks: [],
      decisions: ["favorable", "unfavorable"], end_result: null,
      scope_overrides: [], source_ids: [], citations: [] },
    { id: "complete", type: "gateway", name: "File complete?", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "released", type: "end", name: "Loan released", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "refused", type: "end", name: "Loan refused", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "refused", scope_overrides: [], source_ids: [], citations: [] },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
    { id: "e2", from: "entry", to: "review", label: null, decision: null, condition: null, is_default: false },
    { id: "e3", from: "review", to: "analysis", label: null, decision: null, condition: null, is_default: false },
    { id: "e4", from: "complete", to: "released", label: null, decision: null, condition: "size(documents) >= 4", is_default: false },
    { id: "e5", from: "complete", to: "refused", label: null, decision: null, condition: "amount < 0.0", is_default: false },
    { id: "e6", from: "complete", to: "entry", label: "Send back", decision: null, condition: null, is_default: true },
    { id: "e7", from: "analysis", to: "complete", label: null, decision: "favorable", condition: null, is_default: false },
    { id: "e8", from: "analysis", to: "refused", label: null, decision: "unfavorable", condition: null, is_default: false },
  ],
  sources: [],
};

const usersFixture: UserDTO[] = [
  { id: "u-advisor", name: "Demo Advisor", role_ids: ["advisor"] },
  { id: "u-analyst", name: "Demo Analyst", role_ids: ["analyst"] },
  { id: "u-backoffice", name: "Demo Back-office", role_ids: ["backoffice"] },
  { id: "u-director", name: "Demo Director", role_ids: ["director"] },
  { id: "u-legal", name: "Demo Legal Officer", role_ids: ["legal"] },
];

const caseFixture = {
  id: "c1",
  version_id: "v1",
  reference: "CASE-2026-0001",
  is_test: true,
  created_at: "2026-10-27T12:00:00Z",
};

const stateFixture: CaseState = {
  case_id: "c1",
  version_id: "v1",
  status: "open",
  result: "",
  node_id: "entry",
  data: { amount: 120000 },
  assignee: "",
  seq: 2,
  prev_hash: "x",
};

const versionFixture: VersionSummary = {
  id: "v1",
  process_id: "p1",
  parent_id: null,
  number: 1,
  label: "Initial",
  status: "published",
  created_at: "2026-10-27T12:00:00Z",
  frozen_at: null,
};

// The coverage report fixture of the brief: one taken edge of 14,
// in definition order. It mirrors the recomputed Go row 1 (a start
// takes e01 only).
const reportFixture: CoverageReport = {
  version_id: "v1",
  taken: 1,
  total: 14,
  edges: [
    { edge_id: "e01", count: 1 },
    { edge_id: "e02", count: 0 },
    { edge_id: "e03", count: 0 },
    { edge_id: "e04", count: 0 },
    { edge_id: "e05", count: 0 },
    { edge_id: "e06", count: 0 },
    { edge_id: "e07", count: 0 },
    { edge_id: "e08", count: 0 },
    { edge_id: "e09", count: 0 },
    { edge_id: "e10", count: 0 },
    { edge_id: "e11", count: 0 },
    { edge_id: "e12", count: 0 },
    { edge_id: "e13", count: 0 },
    { edge_id: "e14", count: 0 },
  ],
};

// The server snapshot of zustand 5 is getInitialState(), so a plain
// setState before renderToString is invisible to the render (the
// panel test pattern).
function setStudioStore(state: {
  selectedNodeId: string | null;
  tab: "general" | "requirements" | "scope";
  mode: StudioMode;
  testCaseId: string | null;
}) {
  Object.assign(useStudioStore.getInitialState(), state);
  useStudioStore.setState(state);
}

function stubFetch(status: number, body: unknown) {
  const calls: {
    path: string;
    method?: string;
    body: unknown;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    (path: string, init?: { method?: string; body?: string }) => {
      calls.push({
        path,
        method: init?.method,
        body: init?.body ? JSON.parse(init.body) : null,
      });
      return Promise.resolve({
        ok: status < 400,
        status,
        json: async () => body,
      });
    },
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setStudioStore({
    selectedNodeId: null,
    tab: "general",
    mode: "design",
    testCaseId: null,
  });
});

describe("coverage api", () => {
  test("4.3 row 4: getCoverage reads the version coverage route", async () => {
    const calls = stubFetch(200, reportFixture);
    const report = await getCoverage("v1");
    expect(report.taken).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/versions/v1/coverage");
  });

  test("4.3 row 5: generateTests sends the version and returns the created list", async () => {
    const calls = stubFetch(200, {
      version_id: "v1",
      red_edges: ["e03"],
      created: [
        { case_id: "c9", reference: "CASE-2026-0009", target_edge: "e03" },
      ],
      errors: [],
    });
    const answer = await generateTests("v1");
    expect(answer.created).toHaveLength(1);
    expect(answer.created[0]!.reference).toBe("CASE-2026-0009");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/ai/generate-tests");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ version_id: "v1" });
  });

  test("4.3 row 6: an AI error rejects as ApiError with the body code", async () => {
    stubFetch(503, {
      error: {
        code: "ai_unavailable",
        message: "The AI layer is off.",
        details: [],
      },
    });
    const error = await generateTests("v1").then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiErr = error as ApiError;
    expect(apiErr.status).toBe(503);
    expect(apiErr.code).toBe("ai_unavailable");
  });
});

// renderEdge renders ElkEdge with a plain data bag (the cast of the
// 3.3 rows: EdgeProps data is Record<string, unknown>).
function renderEdge(data: Record<string, unknown>): string {
  return renderToString(
    createElement(ElkEdge, { data } as unknown as ComponentProps<typeof ElkEdge>),
  );
}

const edgeData: Record<string, unknown> = {
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ],
  pill: null,
  anchor: null,
  ghost: false,
};

describe("edge coverage colors", () => {
  test("4.3 row 7: a taken edge paints green", () => {
    const html = renderEdge({ ...edgeData, traversed: false, coverage: "green" });
    expect(html).toContain("stroke:#16a34a");
    expect(html).toContain("stroke-width:2");
  });

  test("4.3 row 8: coverage wins over traversed", () => {
    const html = renderEdge({ ...edgeData, traversed: true, coverage: "red" });
    expect(html).toContain("stroke:#dc2626");
    expect(html).toContain("stroke-width:2");
  });

  test("4.3 row 9: no coverage keeps the traversed blue", () => {
    const html = renderEdge({ ...edgeData, traversed: true, coverage: null });
    expect(html).toContain("stroke:#2563eb");
    expect(html).toContain("stroke-width:2");
  });
});

// renderTestScreen renders TestScreen with the users, case and
// coverage queries pre-seeded and the store set to the test mode
// with case c1 (the copy of the 3.1 harness, plus the coverage
// seed).
function renderTestScreen(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["users"], usersFixture);
  client.setQueryData(["case", "c1"], { case: caseFixture, state: stateFixture });
  client.setQueryData(["coverage", "v1"], reportFixture);
  setStudioStore({
    selectedNodeId: null,
    tab: "general",
    mode: "test",
    testCaseId: "c1",
  });
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        ReactFlowProvider,
        null,
        createElement(TestScreen, { def: testDefinition, version: versionFixture }),
      ),
    ),
  );
}

describe("test screen coverage", () => {
  test("4.3 row 10: coverage=1 shows the counter and the generate button", () => {
    // The lazy initializer reads window during render; the legend
    // row lives inside ProcessDiagram, which shows its loading
    // branch under renderToString (row 11 covers the row).
    vi.stubGlobal("window", { location: { search: "?coverage=1" } });
    const html = renderTestScreen();
    expect(html).toContain("1 / 14 branches");
    expect(html).toContain("Generate tests");
  });
});

describe("coverage legend row", () => {
  test("4.3 row 11: the row names both colors with their meaning", () => {
    const html = renderToString(createElement(CoverageLegendRow));
    // The two svg swatches sit between the text parts, so the three
    // text parts are checked one by one (plan Q1, option A).
    expect(html).toContain("Coverage:");
    expect(html).toContain("green taken,");
    expect(html).toContain("red never taken");
    expect(html).toContain("#16a34a");
    expect(html).toContain("#dc2626");
  });
});
