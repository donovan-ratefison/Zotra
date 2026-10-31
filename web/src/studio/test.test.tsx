// The test rows of lot 3.1, in the order of the brief. The
// environment is node: renderToString for the components, no jsdom
// (the patterns of the approved lots). Radix portals render nothing
// on the server: the rows render bodies and pre-seeded caches, and
// the closed selects show their label through SelectValue children.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { toast } from "sonner";
import { ApiError } from "./api";
import { FieldInput, fieldInput, parseFieldValue } from "./field-inputs";
import { listUsers, runCommand } from "./case-api";
import { NewCaseDialogBody } from "./NewCaseDialog";
import { StepScreen } from "./StepScreen";
import { runGenerateTests, TestScreen } from "./TestScreen";
import { useStudioStore, type StudioMode } from "./store";
import type { CaseState, UserDTO } from "./case-api";
import type { ProcessDefinition, VersionSummary } from "./types";

// The toast calls of the generate action become vi.fn(): the rows
// below read the calls (the render of the tests has no window).
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// The base fixture is the miniDefinition of lot 2.2 (one advisor
// role, one amount field, one scope row, empty entry checks, the
// nodes start, entry, review, complete, released, refused, the edges
// e1 to e6), with the changes of the brief: six fields after amount,
// the analyst role, the scope rows, the entry check c1, the analysis
// task and its two decision edges (e3 rewired to analysis).
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

const fieldByName = (name: string) =>
  testDefinition.fields.find((f) => f.name === name)!;

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

const takenState: CaseState = { ...stateFixture, assignee: "u-advisor" };
const analysisState: CaseState = {
  ...stateFixture,
  node_id: "analysis",
  assignee: "u-analyst",
};
const closedState: CaseState = {
  ...stateFixture,
  status: "closed",
  result: "approved",
};
const closedFinal: CaseState = {
  ...closedState,
  data: { amount: 120000, client_name: "Hery", kind: "", docs: ["d1"] },
};

const scanRow = {
  id: "d1",
  case_id: "c1",
  name: "ID.png",
  mime: "image/png",
  sha256: "a".repeat(64),
  created_at: "2026-10-27T12:00:00Z",
};

const eventsFixture = [
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
    headers?: Record<string, string>;
    body: unknown;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    (
      path: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
      calls.push({
        path,
        method: init?.method,
        headers: init?.headers,
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

// renderStep renders StepScreen directly, with every prop named.
// The scan of the fixture provides the required name ID of entry, so
// the document gate stays open.
function renderStep(state: CaseState, props?: {
  actor?: string;
  failedChecks?: { id: string; message: string }[];
  actorLocked?: boolean;
  finalData?: boolean;
}): string {
  return renderToString(
    createElement(StepScreen, {
      def: testDefinition,
      state,
      users: usersFixture,
      actor: props?.actor ?? "u-advisor",
      onActorChange: () => {},
      onCommand: () => {},
      failedChecks: props?.failedChecks ?? [],
      onDecide: () => {},
      actorLocked: props?.actorLocked ?? false,
      finalData: props?.finalData ?? false,
      documents: [scanRow],
      documentsError: null,
      events: [],
      uploading: false,
      onUpload: () => {},
    }),
  );
}

// renderTestScreen renders TestScreen with both queries pre-seeded
// and the store set to the test mode with case c1.
function renderTestScreen(state: CaseState = stateFixture, isTest = true): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["users"], usersFixture);
  client.setQueryData(["case", "c1"], { case: { ...caseFixture, is_test: isTest }, state });
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
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  setStudioStore({
    selectedNodeId: null,
    tab: "general",
    mode: "design",
    testCaseId: null,
  });
});

describe("field value forms", () => {
  test("3.1 row 1: a money value gives its string form", () => {
    expect(fieldInput(fieldByName("amount"), 120000)).toBe("120000");
  });

  test("3.1 row 2: documents join, null gives empty", () => {
    expect(fieldInput(fieldByName("docs"), ["a", "b"])).toBe("a, b");
    expect(fieldInput(fieldByName("client_name"), null)).toBe("");
  });

  test("3.1 row 21: an untouched value gives empty", () => {
    expect(fieldInput(fieldByName("client_name"), undefined)).toBe("");
  });

  test("3.1 row 3: numbers refuse empty and non numeric input", () => {
    expect(parseFieldValue(fieldByName("amount"), "")).toBeNull();
    expect(parseFieldValue(fieldByName("amount"), "x")).toBeNull();
    expect(parseFieldValue(fieldByName("duration_months"), "")).toBeNull();
    expect(parseFieldValue(fieldByName("duration_months"), "x")).toBeNull();
  });

  test("3.1 row 4: number, boolean and integer parse", () => {
    expect(parseFieldValue(fieldByName("amount"), "120.5")).toBe(120.5);
    expect(parseFieldValue(fieldByName("ok"), "true")).toBe(true);
    expect(parseFieldValue(fieldByName("duration_months"), "240")).toBe(240);
  });

  test("3.1 row 5: documents split, trim and drop empties", () => {
    expect(parseFieldValue(fieldByName("docs"), " a , b ,")).toEqual(["a", "b"]);
  });

  test("3.1 row 6: an empty string stays empty, a date parses", () => {
    expect(parseFieldValue(fieldByName("client_name"), "")).toBe("");
    expect(parseFieldValue(fieldByName("signed_on"), "2026-11-01")).toBe(
      "2026-11-01",
    );
  });
});

describe("field input render", () => {
  test("3.1 row 7: the money input is a number input with cents", () => {
    const html = renderToString(
      createElement(FieldInput, {
        field: fieldByName("amount"),
        value: 120000,
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(html).toContain('aria-label="Amount"');
    expect(html).toContain('type="number"');
    expect(html).toContain('step="0.01"');
  });

  test("3.1 row 8: the enum input renders a labeled combobox", () => {
    const html = renderToString(
      createElement(FieldInput, {
        field: fieldByName("kind"),
        value: "fast",
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Kind"');
  });
});

describe("case api", () => {
  test("3.1 row 9: listUsers unwraps the users envelope", async () => {
    stubFetch(200, {
      users: [
        {
          id: "u-advisor",
          name: "Demo Advisor",
          role_ids: ["advisor"],
        },
      ],
    });
    const users = await listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("Demo Advisor");
  });

  test("3.1 row 10: runCommand sends the five fields and the user header", async () => {
    const calls = stubFetch(200, { events: eventsFixture, state: takenState });
    const answer = await runCommand("c1", "u-advisor", {
      type: "submit",
      values: { amount: 1 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/cases/c1/commands");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers?.["X-Zotra-User"]).toBe("u-advisor");
    expect(calls[0]!.body).toEqual({
      type: "submit",
      data: {},
      values: { amount: 1 },
      decision: "",
      document_hash: "",
    });
    expect(JSON.stringify(calls[0]!.body)).toBe(
      '{"type":"submit","data":{},"values":{"amount":1},"decision":"","document_hash":""}',
    );
    expect(answer.events).toEqual(eventsFixture);
    expect(answer.state).toEqual(takenState);
  });

  test("3.1 row 11: a conflict answer rejects as ApiError", async () => {
    stubFetch(409, {
      error: {
        code: "conflict",
        message: "step already assigned to u-advisor",
        details: [],
      },
    });
    const error = await runCommand("c1", "u-advisor", {
      type: "take",
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe("conflict");
    expect(apiError.message).toBe("step already assigned to u-advisor");
  });
});

describe("new case dialog", () => {
  test("3.1 row 12: the dialog holds one field per non-computed field", () => {
    const html = renderToString(
      createElement(NewCaseDialogBody, {
        def: testDefinition,
        busy: false,
        error: null,
        onCreate: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("New test case");
    expect(html).toContain("Client");
    expect(html).toContain("Amount");
    expect(html).toContain("Duration (months)");
    expect(html).toContain("Ready");
    expect(html).toContain("Kind");
    expect(html).toContain("Signed on");
    expect(html).toContain("Documents");
    expect(html).toContain("No scans yet.");
    expect(html).toContain("Create and start");
  });

  test("3.1 row 13: the lot 2.2 fields only gives Amount and no Client", () => {
    const html = renderToString(
      createElement(NewCaseDialogBody, {
        def: { ...testDefinition, fields: [fieldByName("amount")] },
        busy: false,
        error: null,
        onCreate: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("Amount");
    expect(html).not.toContain("Client");
  });
});

describe("step screen", () => {
  test("3.1 row 14: a fresh step shows the act-as pick and the take button", () => {
    const html = renderStep(stateFixture);
    expect(html).toContain("Application entry");
    expect(html).toContain("Act as");
    expect(html).toContain("Demo Advisor");
    expect(html).toContain("Take the step");
    expect(html).not.toContain("Submit");
  });

  test("3.1 row 15: a taken step shows the form and no take button", () => {
    const html = renderStep(takenState);
    expect(html).toContain("Submit");
    expect(html).toContain("Client");
    expect(html).toContain("Amount");
    expect(html).toContain("Duration (months)");
    expect(html).toContain("Ready");
    expect(html).toContain("Kind");
    expect(html).toContain("Signed on");
    expect(html).toContain("Documents");
    expect(html).toContain('aria-label="ID.png"');
    expect(html).not.toContain("No scans yet.");
    expect(html).not.toContain("Take the step");
  });

  test("3.1 row 16: a task with decisions has open decisions and no Submit", () => {
    const html = renderStep(analysisState);
    expect(html).toMatch(/<button(?![^>]*\bdisabled=)[^>]*>[^<]*favorable/);
    expect(html).toMatch(/<button(?![^>]*\bdisabled=)[^>]*>[^<]*unfavorable/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*Submit</);
  });

  test("3.1 row 18: a closed case shows the result, the final data and no act-as pick", () => {
    const html = renderStep(closedFinal, { finalData: true });
    expect(html).toContain("Case closed");
    expect(html).toContain("Result: approved.");
    expect(html).toContain('aria-label="Final data"');
    for (const text of [">Amount<", ">€120,000.00<", ">Client<", ">Hery<", ">Documents<", ">1 scan<"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain(">Kind<");
    expect(html).not.toContain("Act as");
  });

  test("pol-10 row C1: a closed case with no data shows no final data", () => {
    const html = renderStep({ ...closedState, data: {} }, { finalData: true });
    expect(html).toContain("Case closed");
    expect(html).not.toContain("Final data");
  });

  test("pol-10 row C2: an empty document list is not final data", () => {
    const html = renderStep({ ...closedState, data: { docs: [] } }, { finalData: true });
    expect(html).not.toContain("Final data");
  });

  test("pol-10 row C3: without finalData the closed view stays the same", () => {
    const html = renderStep(closedFinal);
    expect(html).toContain("Result: approved.");
    expect(html).not.toContain("Final data");
    expect(html).not.toContain("€120,000.00");
  });

  test("3.1 row 19: the failed checks list their check id and message", () => {
    const html = renderStep(stateFixture, {
      failedChecks: [
        { id: "c1", message: "The amount must be positive." },
      ],
    });
    expect(html).toContain("Check c1: The amount must be positive.");
  });

  test("6.2 row 18: actorLocked renders the acting-as line and keeps the form", () => {
    const html = renderStep(takenState, { actorLocked: true });
    expect(html).toContain("Acting as Demo Advisor");
    expect(html).toContain("Submit");
    expect(html).not.toContain("Act as");
  });
});

describe("test screen", () => {
  test("3.1 row 20: the opened case shows the header, the button and the actor", () => {
    const html = renderTestScreen();
    expect(html).toContain(">Test case<");
    expect(html).toContain(">CASE-2026-0001<");
    expect(html).toContain("New test case");
    expect(html).toContain("Demo Advisor");
    expect(html).toMatch(/<button(?![^>]*\bdisabled=)[^>]*aria-label="Act as"/);
  });

  test("fix-monitor row M8: a real case reads Case, a test case reads Test case", () => {
    expect(renderTestScreen(stateFixture, false)).toContain(">Case<");
    expect(renderTestScreen(stateFixture, false)).not.toContain(">Test case<");
    expect(renderTestScreen(stateFixture, true)).toContain(">Test case<");
  });

  test("pol-10 row T1: a closed case keeps a disabled act-as pick and shows the final data", () => {
    const html = renderTestScreen({ ...closedState, node_id: "released" });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Act as"/);
    expect(html).toContain("Demo Advisor");
    expect(html).toContain('aria-label="Final data"');
  });
});

describe("generate tests toast", () => {
  test("fb-008 row 1: no created case and one error gives the error toast with the first error", async () => {
    const calls = stubFetch(200, {
      version_id: "v1",
      red_edges: ["e04"],
      created: [],
      errors: ["case 1: edge e04 not reached"],
    });
    await runGenerateTests(new QueryClient(), "v1");
    expect(toast.error).toHaveBeenCalledWith(
      "The generation created no case: case 1: edge e04 not reached",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/ai/generate-tests");
    expect(calls[0]!.method).toBe("POST");
  });

  test("fb-008 row 2: one created case keeps the success toast with the count", async () => {
    stubFetch(200, {
      version_id: "v1",
      red_edges: [],
      created: [
        { case_id: "c9", reference: "CASE-2026-0009", target_edge: "e04" },
      ],
      errors: [],
    });
    await runGenerateTests(new QueryClient(), "v1");
    expect(toast.success).toHaveBeenCalledWith("1 test cases created.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("fb-008 row 3: no created case and no error gives the bare error toast", async () => {
    stubFetch(200, {
      version_id: "v1",
      red_edges: [],
      created: [],
      errors: [],
    });
    await runGenerateTests(new QueryClient(), "v1");
    expect(toast.error).toHaveBeenCalledWith(
      "The generation created no case.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
