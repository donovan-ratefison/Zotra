// The test rows of lot 3.3, in the order of the brief. The
// environment is node: renderToString for the components, no jsdom
// (the patterns of the approved lots). The fixtures are the lot 3.1
// ones, with the event list and the state variants of the brief.

import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { caseViewOf, initials } from "./case-view";
import { ElkEdge, EventShape, TaskCard, TokenBadge } from "./diagram";
import { TestScreen } from "./TestScreen";
import { useStudioStore, type StudioMode } from "./store";
import type { CaseEvent, CaseState, UserDTO } from "./case-api";
import type { ProcessDefinition, VersionSummary } from "./types";

// The base fixture is the lot 3.1 test fixture (its brief, section
// 4.9): two roles, seven fields, the scope rows, the entry check c1,
// the analysis task and its two decision edges.
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
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
    { id: "e2", from: "entry", to: "review", label: null, decision: null, condition: null, is_default: false },
    { id: "e3", from: "review", to: "analysis", label: null, decision: null, condition: null, is_default: false },
    { id: "e4", from: "complete", to: "released", label: null, decision: null, condition: "size(documents) >= 4", is_default: false },
    { id: "e5", from: "complete", to: "refused", label: null, decision: null, condition: "amount < 0.0", is_default: false },
    { id: "e6", from: "complete", to: "entry", label: "Send back", decision: null, condition: null, is_default: true },
    { id: "e7", from: "analysis", to: "complete", label: null, decision: "favorable", condition: null, is_default: false },
    { id: "e8", from: "analysis", to: "refused", label: null, decision: null, condition: null, is_default: false },
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

const userName = (id: string) =>
  usersFixture.find((u) => u.id === id)?.name ?? null;

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

// ev builds one event with every field fixed; the type, the actor and
// the payload come from the row. The at values sit one second apart
// from 2026-10-27T12:00:00Z.
function ev(
  seq: number,
  type: string,
  actor: string,
  payload: Record<string, unknown>,
): CaseEvent {
  return {
    case_id: "c1",
    seq,
    type,
    at: `2026-10-27T12:00:0${seq}Z`,
    actor,
    payload,
    prev_hash: "x",
    hash: "y",
  };
}

// The event list of the brief, section 4.4. The signature_added event
// of the 3.2 base is not part of it; the rows filter by state.seq.
const events33: CaseEvent[] = [
  ev(1, "case_created", "system", { version_id: "v1", data: {} }),
  ev(2, "step_entered", "system", { node_id: "entry" }),
  ev(3, "data_submitted", "u-advisor", {
    node_id: "entry",
    values: { amount: 120000 },
  }),
  ev(4, "check_evaluated", "u-advisor", {
    node_id: "entry",
    check_id: "c1",
    result: false,
    error: null,
  }),
  ev(5, "step_assigned", "u-advisor", {
    node_id: "entry",
    user_id: "u-advisor",
  }),
  ev(8, "step_entered", "u-analyst", { node_id: "analysis" }),
  ev(9, "edge_taken", "u-analyst", { edge_id: "e7" }),
];

// The state variants of the brief, section 4.4, on the 3.1 base.
const row2State: CaseState = {
  ...stateFixture,
  node_id: "entry",
  seq: 4,
  assignee: "",
  status: "open",
};
const row3State: CaseState = { ...row2State, node_id: "analysis", seq: 9 };
const row4State: CaseState = {
  ...row2State,
  status: "closed",
  seq: 9,
  result: "approved",
};
const row5State: CaseState = { ...row2State, assignee: "u-analyst" };

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

// renderTestScreen renders TestScreen with the queries pre-seeded and
// the store set to the test mode with case c1. The state rests on
// entry at seq 4 with the failed check; the earlier query fires at
// ["caseAt", "c1", 6] (7 events, earlier = 6), so its cache entry is
// seeded too; its content never renders. The layout effect does not
// run under renderToString, so the diagram shows its loading branch
// and no node renders: the row asserts the style element only.
function renderTestScreen(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["users"], usersFixture);
  client.setQueryData(["case", "c1"], {
    case: caseFixture,
    state: { ...stateFixture, seq: 4 },
  });
  client.setQueryData(["events", "c1"], events33);
  client.setQueryData(["caseAt", "c1", 6], {
    case: caseFixture,
    state: { ...stateFixture, seq: 6, data: {} },
  });
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

afterEach(() => {
  setStudioStore({
    selectedNodeId: null,
    tab: "general",
    mode: "design",
    testCaseId: null,
  });
});

// renderCard renders the entry task card directly, with every prop
// named (the direct-render pattern of the approved lots).
function renderCard(nodeState: "done" | "current" | "failed"): string {
  return renderToString(
    createElement(TaskCard, {
      node: testDefinition.nodes.find((n) => n.id === "entry")!,
      color: null,
      roleName: null,
      selected: false,
      ghost: false,
      nodeState,
    }),
  );
}

describe("case view pure rows", () => {
  test("3.3 row 1: initials takes the first letters, at most two", () => {
    expect(initials("Demo Advisor")).toBe("DA");
    expect(initials("analyst")).toBe("A");
    expect(initials("")).toBe("");
  });

  test("3.3 row 2: the failed check state at seq 4", () => {
    expect(caseViewOf(events33, row2State, userName)).toEqual({
      currentNodeId: "entry",
      traversedEdgeIds: [],
      traversedNodeIds: ["entry"],
      failedCheck: true,
      actorName: "Demo Advisor",
    });
  });

  test("3.3 row 3: the analysis state at seq 9", () => {
    expect(caseViewOf(events33, row3State, userName)).toEqual({
      currentNodeId: "analysis",
      traversedEdgeIds: ["e7"],
      traversedNodeIds: ["entry", "analysis"],
      failedCheck: false,
      actorName: "Demo Analyst",
    });
  });

  test("3.3 row 4: a closed case has no current node", () => {
    const view = caseViewOf(events33, row4State, userName);
    expect(view.currentNodeId).toBeNull();
    expect(view.failedCheck).toBe(false);
    expect(view.actorName).toBe("Demo Analyst");
  });

  test("3.3 row 5: the assignee maps to the user name", () => {
    expect(caseViewOf(events33, row5State, userName).actorName).toBe(
      "Demo Analyst",
    );
  });

  test("3.3 row 6: the system actor gives no name", () => {
    expect(
      caseViewOf(events33.slice(0, 2), row2State, userName).actorName,
    ).toBeNull();
  });

  test("3.3 row 7: unknown payload ids are collected, no error", () => {
    const ghostEvents = events33.map((e) => {
      if (e.seq === 8) {
        return { ...e, payload: { node_id: "ghost" } };
      }
      if (e.seq === 9) {
        return { ...e, payload: { edge_id: "e99" } };
      }
      return e;
    });
    const view = caseViewOf(ghostEvents, row3State, userName);
    expect(view.traversedEdgeIds.at(-1)).toBe("e99");
    expect(view.traversedNodeIds.at(-1)).toBe("ghost");
  });
});

describe("node and edge states", () => {
  test("3.3 row 8: a done task card recolors its border, no pulse", () => {
    const html = renderCard("done");
    expect(html).toContain("1px solid #2563eb");
    expect(html).not.toContain("zpulse");
  });

  test("3.3 row 9: a current task card carries the pulse ring", () => {
    expect(renderCard("current")).toContain("zpulse");
  });

  test("3.3 row 10: a failed task card shakes, turns red and shows the badge", () => {
    const html = renderCard("failed");
    expect(html).toContain("zshake");
    expect(html).toContain("1px solid #dc2626");
    expect(html).toContain('aria-label="Check failed"');
  });

  test("3.3 row 11: a current event shape carries the pulse ring", () => {
    const html = renderToString(
      createElement(EventShape, {
        node: testDefinition.nodes.find((n) => n.id === "start")!,
        selected: false,
        ghost: false,
        nodeState: "current",
      }),
    );
    expect(html).toContain("zpulse");
  });

  test("3.3 row 12: a traversed edge paints the blue inline style", () => {
    const html = renderToString(
      createElement(ElkEdge, {
        data: {
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
          ],
          pill: null,
          ghost: false,
          traversed: true,
        },
      } as unknown as ComponentProps<typeof ElkEdge>),
    );
    // The inline style wins over the React Flow stylesheet, which
    // beats every SVG attribute (the ghost row precedent).
    expect(html).toContain("stroke:#2563eb");
    expect(html).toContain("stroke-width:2");
  });

  test("3.3 row 13: the token badge shows the initials and its label", () => {
    const html = renderToString(
      createElement(TokenBadge, {
        data: { label: "DA", name: "Demo Advisor" },
      }),
    );
    expect(html).toContain(">DA<");
    expect(html).toContain('aria-label="Token Demo Advisor"');
  });
});

describe("test screen", () => {
  test("3.3 row 14: the diagram carries the animation styles", () => {
    const html = renderTestScreen();
    expect(html).toContain("@keyframes zpulse");
    expect(html).toContain("@keyframes zshake");
  });
});
