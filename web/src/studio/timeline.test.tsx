// The test rows of lot 3.2, in the order of the brief. The
// environment is node: renderToString for the components, no jsdom
// (the patterns of the approved lots). The fixtures are the lot 3.1
// ones, with the changes of the brief: the four entry documents, the
// step_assigned and signature_added events, the two inspector
// variants and the checks variant.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { eventLabel } from "./Timeline";
import { milestonesOf, TimelineBar, upcomingOf } from "./TimelineBar";
import { Inspector } from "./Inspector";
import { ChecksTab } from "./ChecksTab";
import { StepScreen } from "./StepScreen";
import { TestScreen } from "./TestScreen";
import { useStudioStore, type StudioMode } from "./store";
import type { CaseEvent, CaseState, UserDTO } from "./case-api";
import type { ProcessDefinition, VersionSummary } from "./types";

// The base fixture is the lot 3.1 test fixture, with the change of
// the brief: the four documents of the entry task.
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
      deadline_hours: 24,
      documents: ["ID", "Payslips", "Bank statements", "Title deed"],
      signature: false,
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
      decisions: [], end_result: "approved", scope_overrides: [], source_ids: [], citations: [] },
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

// The base events: the lot 3.1 pair, plus the two events the brief
// fixes with all nine fields.
const eventsBase: CaseEvent[] = [
  {
    case_id: "c1",
    seq: 3,
    type: "data_submitted",
    at: "2026-10-27T12:00:01Z",
    actor: "u-advisor",
    payload: { node_id: "entry", values: { amount: 120000 } },
    prev_hash: "x",
    hash: "y",
  },
  {
    case_id: "c1",
    seq: 4,
    type: "check_evaluated",
    at: "2026-10-27T12:00:02Z",
    actor: "u-advisor",
    payload: { node_id: "entry", check_id: "c1", result: false, error: null },
    prev_hash: "x",
    hash: "y",
  },
  {
    case_id: "c1",
    seq: 5,
    type: "step_assigned",
    at: "2026-10-27T12:00:03Z",
    actor: "u-advisor",
    payload: { node_id: "entry", user_id: "u-advisor" },
    prev_hash: "x",
    hash: "y",
  },
  {
    case_id: "c1",
    seq: 6,
    type: "signature_added",
    at: "2026-10-27T12:00:04Z",
    actor: "u-advisor",
    payload: { node_id: "entry", user_id: "u-advisor", document_hash: "abc" },
    prev_hash: "x",
    hash: "y",
  },
];

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

// ev builds one event with the fixed fields; the type and the payload
// come from the row.
function ev(seq: number, type: string, payload: Record<string, unknown>): CaseEvent {
  return {
    case_id: "c1",
    seq,
    type,
    at: `2026-10-27T12:00:0${seq}Z`,
    actor: "u-advisor",
    payload,
    prev_hash: "x",
    hash: "y",
  };
}

// The row 15 variant: the computed field after amount, with before
// and after values exact under amount / 12.
const definition15: ProcessDefinition = {
  ...testDefinition,
  fields: [
    testDefinition.fields[0]!,
    { name: "monthly_payment", label: "Monthly payment", type: "money", options: [], computed: "amount / 12" },
    ...testDefinition.fields.slice(1),
  ],
};

// The row 17 variant: a second check on entry and its passing event.
const definition17: ProcessDefinition = {
  ...testDefinition,
  nodes: testDefinition.nodes.map((n) =>
    n.id === "entry"
      ? {
          ...n,
          checks: [
            ...n.checks,
            { id: "c9", expression: "duration_months <= 300",
              message: "The duration is too long.",
              plain_text: null, citations: [] },
          ],
        }
      : n,
  ),
};
const events17: CaseEvent[] = [
  ...eventsBase,
  {
    case_id: "c1",
    seq: 7,
    type: "check_evaluated",
    at: "2026-10-27T12:00:05Z",
    actor: "u-advisor",
    payload: { node_id: "entry", check_id: "c1", result: true, error: null },
    prev_hash: "x",
    hash: "y",
  },
];

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

// unquote decodes the &quot; entities of the render output, so the
// rows assert on the text the browser shows.
function unquote(html: string): string {
  return html.replace(/&quot;/g, '"');
}

function renderTimeline(events: CaseEvent[], at: number | null): string {
  return renderToString(
    createElement(TimelineBar, {
      def: testDefinition,
      events,
      state: { ...TIMELINE_STATE },
      at,
      onSelect: () => {},
      userName: (id: string) => usersFixture.find((u) => u.id === id)?.name ?? id,
    }),
  );
}

// The present state of the timeline rows: open, at the entry task.
const TIMELINE_STATE: CaseState = {
  case_id: "c1",
  version_id: "v1",
  status: "open",
  result: "",
  node_id: "entry",
  data: {},
  assignee: "",
  seq: 3,
  prev_hash: "",
};

function renderInspector(def: ProcessDefinition, props: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  initialView?: "list" | "json";
  initialOnlyChanges?: boolean;
}): string {
  return renderToString(
    createElement(Inspector, { def, nodeId: "entry", ...props }),
  );
}

function renderChecks(def: ProcessDefinition, state: CaseState, events: CaseEvent[], nodeId = "entry"): string {
  return renderToString(
    createElement(ChecksTab, { def, state, events, nodeId }),
  );
}

// renderStep renders StepScreen directly, with every prop named.
function renderStep(state: CaseState, props?: { readOnly?: boolean }): string {
  return renderToString(
    createElement(StepScreen, {
      def: testDefinition,
      state,
      users: usersFixture,
      actor: "u-advisor",
      onActorChange: () => {},
      onCommand: () => {},
      failedChecks: [],
      decisionEnabled: false,
      onValueChange: () => {},
      readOnly: props?.readOnly,
      documents: [],
      documentsError: null,
      events: [],
      uploading: false,
      onUpload: () => {},
    }),
  );
}

// renderTestScreen renders TestScreen with the queries pre-seeded and
// the store set to the test mode with case c1. The earlier query
// fires at ["caseAt", "c1", 3] (4 events, earlier = 3), so its cache
// entry is seeded too; its content never renders.
function renderTestScreen(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["users"], usersFixture);
  client.setQueryData(["case", "c1"], { case: caseFixture, state: stateFixture });
  client.setQueryData(["events", "c1"], eventsBase);
  client.setQueryData(["caseAt", "c1", 3], {
    case: caseFixture,
    state: { ...stateFixture, seq: 3, data: {} },
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

describe("event labels", () => {
  test("3.2 row 1: a case_created gives Case created", () => {
    expect(
      eventLabel(testDefinition, ev(1, "case_created", { version_id: "v1", data: {} })),
    ).toBe("Case created");
  });

  test("3.2 row 2: a step_entered names the node", () => {
    expect(
      eventLabel(testDefinition, ev(2, "step_entered", { node_id: "entry" })),
    ).toBe("Entered Application entry");
  });

  test("3.2 row 3: an edge_taken names both endpoints", () => {
    expect(
      eventLabel(testDefinition, ev(3, "edge_taken", { edge_id: "e2" })),
    ).toBe("Link Application entry to Review");
  });

  test("3.2 row 4: a failed check gives its position and message", () => {
    expect(
      eventLabel(testDefinition, ev(4, "check_evaluated", {
        node_id: "entry", check_id: "c1", result: false, error: null,
      })),
    ).toBe("Check 1 failed: The amount must be positive.");
  });

  const entryNode = testDefinition.nodes.find((nd) => nd.id === "entry")!;
  const c1 = entryNode.checks[0]!;
  const withChecks = (checks: typeof entryNode.checks): ProcessDefinition => ({
    ...testDefinition,
    nodes: testDefinition.nodes.map((nd) =>
      nd.id === "entry" ? { ...nd, checks } : nd,
    ),
  });
  const twoChecks = withChecks([
    c1,
    { ...c1, id: "c2", message: "The term is too long." },
  ]);
  const checkLabel = (
    def: ProcessDefinition,
    nodeId: string,
    checkId: string,
    result: boolean,
  ) =>
    eventLabel(def, ev(4, "check_evaluated", {
      node_id: nodeId, check_id: checkId, result, error: null,
    }));

  test("P1: a passed check gives its position", () => {
    expect(checkLabel(testDefinition, "entry", "c1", true)).toBe("Check 1 passed");
  });

  test("P2: an unknown check gives the raw id", () => {
    expect(checkLabel(testDefinition, "entry", "c9", false)).toBe("Check c9 failed");
  });

  test("P3: an unknown node gives the raw check id", () => {
    expect(checkLabel(testDefinition, "ghost", "c1", true)).toBe("Check c1 passed");
  });

  test("P4: a failed check with an empty message gives no colon", () => {
    expect(
      checkLabel(withChecks([{ ...c1, message: "" }]), "entry", "c1", false),
    ).toBe("Check 1 failed");
  });

  test("P5: the second check of a step gives Check 2", () => {
    expect(checkLabel(twoChecks, "entry", "c2", false)).toBe(
      "Check 2 failed: The term is too long.",
    );
  });

  test("3.2 row 5: a step_assigned names the user", () => {
    expect(eventLabel(testDefinition, eventsBase[2]!)).toBe(
      "Assigned to u-advisor",
    );
  });

  test("3.2 row 6: an unknown edge gives the raw id twice", () => {
    expect(
      eventLabel(testDefinition, ev(3, "edge_taken", { edge_id: "e99" })),
    ).toBe("Link e99 to e99");
  });

  test("3.2 row 7: an unknown node gives the raw id", () => {
    expect(
      eventLabel(testDefinition, ev(3, "data_submitted", { node_id: "ghost", values: {} })),
    ).toBe("Data submitted on ghost");
  });

  test("3.2 row 8: decision, signature, close and unknown type", () => {
    expect(
      eventLabel(testDefinition, ev(3, "decision_made", { node_id: "analysis", decision: "favorable" })),
    ).toBe("Decision favorable");
    expect(eventLabel(testDefinition, eventsBase[3]!)).toBe(
      "Signature added on Application entry",
    );
    expect(
      eventLabel(testDefinition, ev(3, "case_closed", { node_id: "released", result: "approved" })),
    ).toBe("Case closed: approved");
    expect(eventLabel(testDefinition, ev(3, "weird", {}))).toBe("weird");
  });

  const sourceDef: ProcessDefinition = {
    ...testDefinition,
    sources: [
      {
        id: "blacklist",
        name: "Credit blacklist",
        url: "http://127.0.0.1:8097/blacklist",
        test_values: { listed: false },
      },
    ],
  };

  test("pol-3 row D8: a fetched source gives its name", () => {
    expect(
      eventLabel(sourceDef, ev(3, "source_fetched", {
        node_id: "analysis",
        source_id: "blacklist",
        values: { listed: false },
      })),
    ).toBe("Fetched Credit blacklist");
  });

  test("pol-3 row D9: an unknown or missing source gives the raw id", () => {
    expect(
      eventLabel(sourceDef, ev(3, "source_fetched", {
        node_id: "analysis",
        source_id: "ghost",
        values: { listed: false },
      })),
    ).toBe("Fetched ghost");
    expect(eventLabel(sourceDef, ev(3, "source_fetched", {}))).toBe("Fetched ");
  });
});

describe("timeline", () => {
  const threeEvents = [
    ev(1, "case_created", { version_id: "v1", data: {} }),
    ev(2, "step_entered", { node_id: "entry" }),
    ev(3, "edge_taken", { edge_id: "e1" }),
  ];

  test("3.2 row 9: no events gives no point and the empty text", () => {
    const html = renderTimeline([], null);
    expect(html).toContain("No events yet.");
    expect(html).not.toContain('aria-current="true"');
  });

  test("3.2 row 10: the events group into one point per step, the last is current", () => {
    const points = milestonesOf(testDefinition, threeEvents, (id) => id);
    expect(points.map((m) => m.label)).toEqual([
      "Application received",
      "Application entry",
    ]);
    expect(points[0]!.detail).toBe("by u-advisor");
    expect(points[1]!.events.map((e) => e.seq)).toEqual([2, 3]);
    const html = renderTimeline(threeEvents, null);
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/aria-current="true" aria-label="Application entry/);
  });

  test("3.2 row 11: a replay at seq 1 makes the first point current", () => {
    const html = renderTimeline(threeEvents, 1);
    expect(html).toMatch(/aria-current="true" aria-label="Application received/);
    expect(html).not.toMatch(/aria-current="true" aria-label="Application entry/);
  });

  test("3.2 row 11b: the upcoming steps follow the shortest path to approval", () => {
    expect(upcomingOf(testDefinition, TIMELINE_STATE)).toEqual([
      "Review",
      "Credit analysis",
      "File complete?",
      "Loan released",
    ]);
    expect(upcomingOf(testDefinition, { ...TIMELINE_STATE, status: "closed" })).toEqual([]);
  });

  test("3.2 row 11c: a failed check without a later pass marks the point", () => {
    const points = milestonesOf(
      testDefinition,
      [
        ...threeEvents,
        ev(4, "check_evaluated", { node_id: "entry", check_id: "c1", result: false }),
      ],
      (id) => id,
    );
    expect(points[1]!.failed).toBe(true);
    const passed = milestonesOf(
      testDefinition,
      [
        ...threeEvents,
        ev(4, "check_evaluated", { node_id: "entry", check_id: "c1", result: false }),
        ev(5, "check_evaluated", { node_id: "entry", check_id: "c1", result: true }),
      ],
      (id) => id,
    );
    expect(passed[1]!.failed).toBe(false);
  });
});

describe("inspector", () => {
  test("3.2 row 12: the list view shows added rows and the scope column", () => {
    const html = unquote(
      renderInspector(testDefinition, {
        before: {},
        after: { amount: 120000, client_name: "Demo Client" },
      }),
    );
    expect(html).toContain(">€120,000.00<");
    expect(html).toContain(">Demo Client<");
    expect((html.match(/<li class="[^"]*bg-\[#dcfce7\]"/g) ?? []).length).toBe(2);
    expect((html.match(/title="Write"/g) ?? []).length).toBe(2);
    expect((html.match(/>W</g) ?? []).length).toBe(2);
  });

  test("3.2 row 13: the JSON view holds the added lines", () => {
    const html = unquote(
      renderInspector(testDefinition, {
        before: {},
        after: { amount: 120000, client_name: "Demo Client" },
        initialView: "json",
      }),
    );
    expect(html).toContain('"amount": 120000,');
    expect(html).toContain(" // added");
    expect(html).toContain('"client_name": "Demo Client"');
  });

  test("3.2 row 14: Only changes keeps the changed row only", () => {
    const html = renderInspector(testDefinition, {
      before: { amount: 100, client_name: "Demo Client" },
      after: { amount: 120000, client_name: "Demo Client" },
      initialOnlyChanges: true,
    });
    expect(html).toContain(">Amount<");
    expect(html).not.toContain(">Client<");
  });

  test("3.2 row 15: a changed computed field carries the tag and the amber row", () => {
    const html = renderInspector(definition15, {
      before: { amount: 96, monthly_payment: 8 },
      after: { amount: 120000, monthly_payment: 10000 },
    });
    expect(html).toContain(">Monthly payment<");
    expect(html).toContain(">computed<");
    expect((html.match(/<li class="[^"]*bg-\[#fef3c7\]"/g) ?? []).length).toBe(2);
  });

  const docsRow = (html: string) => html.match(/<li class="[^"]*"><span[^>]*title="Documents"[\s\S]*?<\/li>/)?.[0] ?? "";

  test("pol-4 row I1: equal arrays in other objects are not a change", () => {
    const html = renderInspector(testDefinition, {
      before: { docs: [{ name: "ID", read: true }] },
      after: { docs: [{ name: "ID", read: true }] },
    });
    const row = docsRow(html);
    expect(row).toContain(">Documents<");
    expect(row).not.toContain("bg-[#fef3c7]");
    expect(row).not.toContain("line-through");
  });

  test("pol-4 row I2: a list with one more item is a change", () => {
    const row = docsRow(renderInspector(testDefinition, {
      before: { docs: [{ name: "ID" }] },
      after: { docs: [{ name: "ID" }, { name: "Payslips" }] },
    }));
    expect(row).toContain("bg-[#fef3c7]");
    expect(row).toContain("line-through");
  });

  test("pol-4 row I3: a field only in after is added", () => {
    const row = docsRow(renderInspector(testDefinition, {
      before: {},
      after: { docs: [{ name: "ID" }] },
    }));
    expect(row).toContain("bg-[#dcfce7]");
  });

  test("pol-4 row I4: the label wraps and is not cut", () => {
    const html = renderInspector(testDefinition, {
      before: { amount: 1 },
      after: { amount: 1 },
    });
    expect(html).toMatch(/<span class="[^"]*break-words[^"]*" title="Amount">/);
    expect(html).not.toContain("truncate");
  });
});

describe("checks tab", () => {
  test("3.2 row 16: a failed check shows its badge and message", () => {
    const html = renderChecks(testDefinition, { ...stateFixture, seq: 4 }, eventsBase);
    expect(html).toContain("Check c1");
    expect(html).toContain("Failed");
    expect(html).toContain("The amount must be positive.");
    expect(html).not.toContain("Not run");
  });

  test("3.2 row 17: a passed check and a not-run check", () => {
    const html = renderChecks(definition17, { ...stateFixture, seq: 7 }, events17);
    expect(html).toContain("Passed");
    expect(html).toContain("Not run");
    expect(html).not.toContain("Failed");
  });

  test("3.2 row 18: a gateway has no checks", () => {
    const html = renderChecks(testDefinition, stateFixture, eventsBase, "complete");
    expect(html).toContain("Only tasks have checks.");
  });

  test("3.2 row 19: a task without checks shows the empty text", () => {
    const html = renderChecks(testDefinition, stateFixture, eventsBase, "review");
    expect(html).toContain("No check on this step.");
  });

  test("3.2 row 20: the documents card counts the uploaded documents", () => {
    const html = renderChecks(
      testDefinition,
      { ...stateFixture, data: { documents: ["a", "b", "c", "d"] } },
      eventsBase,
    );
    expect(html).toContain("Required documents");
    expect(html).toContain("4 of 4");
    expect((html.match(/data-covered="true"/g) ?? []).length).toBe(4);
  });

  test("3.2 row 21: one document covers one row", () => {
    const html = renderChecks(
      testDefinition,
      { ...stateFixture, data: { documents: ["a"] } },
      eventsBase,
    );
    expect(html).toContain("1 of 4");
    expect((html.match(/data-covered="true"/g) ?? []).length).toBe(1);
    expect((html.match(/data-covered="false"/g) ?? []).length).toBe(3);
  });
});

describe("step screen read only", () => {
  test("3.2 row 22: a replay shows the note and no Submit button", () => {
    const html = renderStep({ ...stateFixture, assignee: "u-advisor" }, { readOnly: true });
    expect(html).toContain("Replay: the commands wait for the present.");
    expect(html).not.toContain("Submit");
  });
});

describe("test screen", () => {
  test("3.2 row 23: the present view shows the tabs and no banner", () => {
    const html = renderTestScreen();
    expect(html).not.toContain("Replay at event");
    expect(html).toContain("Screen");
    expect(html).toContain("Inspector");
    expect(html).toContain("Checks");
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
  });
});
