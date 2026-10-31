// The test rows of lot 3.4, in the order of the brief. The
// environment is node: renderToString for the component rows, no jsdom
// (the patterns of the approved lots). Radix portals render nothing on
// the server: the rows render the dialog body, and the closed select
// shows its label through SelectValue children.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReplayDialogBody } from "./ReplayDialog";
import { commandsOf, runCopy, submitsOf } from "./replay";
import type { CaseEvent, CaseState } from "./case-api";
import type { ProcessDefinition } from "./types";

// The definition the dialog reads: the amount field and the two nodes
// that the event fixture names (the node names of the lot 3.1
// fixture). The other arrays stay empty.
const def: ProcessDefinition = {
  schema_version: "1",
  name: "Mini loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
  roles: [],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
  ],
  scope: [],
  nodes: [
    { id: "entry", type: "task", name: "Application entry", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [] },
    { id: "analysis", type: "task", name: "Credit analysis", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [] },
  ],
  edges: [],
  sources: [],
};

// The event fixture of the brief, all nine fields, seq 1 to 7.
const replayEvents: CaseEvent[] = [
  { case_id: "c1", seq: 1, type: "case_created", at: "2026-10-27T12:00:00Z",
    actor: "u-advisor",
    payload: { version_id: "v1", data: { amount: 120000 } },
    prev_hash: "0".repeat(64), hash: "a1" },
  { case_id: "c1", seq: 2, type: "edge_taken", at: "2026-10-27T12:00:00Z",
    actor: "system", payload: { edge_id: "e1" }, prev_hash: "a1", hash: "a2" },
  { case_id: "c1", seq: 3, type: "step_entered", at: "2026-10-27T12:00:00Z",
    actor: "system", payload: { node_id: "entry" }, prev_hash: "a2", hash: "a3" },
  { case_id: "c1", seq: 4, type: "step_assigned", at: "2026-10-27T12:00:01Z",
    actor: "u-advisor",
    payload: { node_id: "entry", user_id: "u-advisor" },
    prev_hash: "a3", hash: "a4" },
  { case_id: "c1", seq: 5, type: "data_submitted", at: "2026-10-27T12:00:02Z",
    actor: "u-advisor",
    payload: { node_id: "entry", values: { amount: 120000 } },
    prev_hash: "a4", hash: "a5" },
  { case_id: "c1", seq: 6, type: "decision_made", at: "2026-10-27T12:00:03Z",
    actor: "u-analyst",
    payload: { node_id: "analysis", decision: "favorable" },
    prev_hash: "a5", hash: "a6" },
  { case_id: "c1", seq: 7, type: "signature_added", at: "2026-10-27T12:00:04Z",
    actor: "u-director",
    payload: { node_id: "entry", user_id: "u-director", document_hash: "h1" },
    prev_hash: "a6", hash: "a7" },
];

// The row 2b events: the engine outputs and the lot 7 type.
const engineEvents: CaseEvent[] = [
  { case_id: "c1", seq: 8, type: "check_evaluated", at: "2026-10-27T12:00:05Z",
    actor: "u-advisor",
    payload: { node_id: "entry", check_id: "c1", result: true, error: null },
    prev_hash: "a7", hash: "a8" },
  { case_id: "c1", seq: 9, type: "case_closed", at: "2026-10-27T12:00:06Z",
    actor: "system",
    payload: { node_id: "released", result: "approved" },
    prev_hash: "a8", hash: "a9" },
  { case_id: "c1", seq: 10, type: "source_fetched", at: "2026-10-27T12:00:07Z",
    actor: "system",
    payload: { node_id: "entry", source_id: "s1", values: {} },
    prev_hash: "a9", hash: "a10" },
];

// The 3.1 case fixture with id c9: the create answer of rows 4 to 6.
const caseC9 = {
  id: "c9",
  version_id: "v1",
  reference: "CASE-2026-0001",
  is_test: true,
  created_at: "2026-10-27T12:00:00Z",
};

// The command answer of the happy rows.
const stateC9: CaseState = {
  case_id: "c9",
  version_id: "v1",
  status: "open",
  result: "",
  node_id: "entry",
  data: { amount: 120000 },
  assignee: "",
  seq: 2,
  prev_hash: "x",
};

const createRoute = { status: 201, body: { case: caseC9 } };
const commandRoute = { status: 200, body: { events: [], state: stateC9 } };
const refusedRoute = {
  status: 409,
  body: {
    error: {
      code: "conflict",
      message: "decision favorable is not a decision of node analysis",
      details: [],
    },
  },
};
const notFoundRoute = {
  status: 404,
  body: {
    error: { code: "not_found", message: "no version v1", details: [] },
  },
};

interface Call {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body: unknown;
}

// stubFetch records every call and answers from the router the row
// builds (the test.test.tsx stub pattern, one variant).
function stubFetch(
  route: (calls: Call[], call: Call) => { status: number; body: unknown },
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    (
      path: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
      const call: Call = {
        path,
        method: init?.method,
        headers: init?.headers,
        body: init?.body ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      const answer = route(calls, call);
      return Promise.resolve({
        ok: answer.status < 400,
        status: answer.status,
        json: async () => answer.body,
      });
    },
  );
  return calls;
}

// renderBody renders the dialog body with the brief defaults.
function renderBody(props?: {
  events?: CaseEvent[];
  at?: number;
  busy?: boolean;
  error?: string | null;
}): string {
  return renderToString(
    createElement(ReplayDialogBody, {
      def,
      events: props?.events ?? replayEvents,
      at: props?.at ?? 6,
      busy: props?.busy ?? false,
      error: props?.error ?? null,
      onCreate: () => {},
      onClose: () => {},
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("commandsOf", () => {
  test("3.4 row 1: the command events of the first five give three steps", () => {
    expect(commandsOf(replayEvents.slice(0, 5))).toEqual([
      { seq: 1, actor: "u-advisor", cmd: { type: "start", data: { amount: 120000 } } },
      { seq: 4, actor: "u-advisor", cmd: { type: "take" } },
      { seq: 5, actor: "u-advisor", cmd: { type: "submit", values: { amount: 120000 } } },
    ]);
  });

  test("3.4 row 2: all seven events give the decide and the sign too", () => {
    expect(commandsOf(replayEvents)).toEqual([
      { seq: 1, actor: "u-advisor", cmd: { type: "start", data: { amount: 120000 } } },
      { seq: 4, actor: "u-advisor", cmd: { type: "take" } },
      { seq: 5, actor: "u-advisor", cmd: { type: "submit", values: { amount: 120000 } } },
      { seq: 6, actor: "u-analyst", cmd: { type: "decide", decision: "favorable" } },
      { seq: 7, actor: "u-director", cmd: { type: "sign", document_hash: "h1" } },
    ]);
  });

  test("3.4 row 2b: the engine outputs and the lot 7 type give no step", () => {
    const steps = commandsOf([...replayEvents, ...engineEvents]);
    expect(steps.map((s) => s.seq)).toEqual([1, 4, 5, 6, 7]);
  });
});

describe("submitsOf", () => {
  test("3.4 row 3: the submits before the boundary, the boundary out", () => {
    expect(submitsOf(replayEvents, 6)).toEqual([
      { seq: 5, node_id: "entry", values: { amount: 120000 } },
    ]);
    expect(submitsOf(replayEvents, 5)).toEqual([]);
  });
});

describe("runCopy", () => {
  test("3.4 row 4: three steps run into the new case under the step actors", async () => {
    const calls = stubFetch((_calls, call) =>
      call.path === "/api/cases" ? createRoute : commandRoute,
    );
    const steps = commandsOf(replayEvents.slice(0, 5));
    const answer = await runCopy(steps, "v1", null);
    expect(answer).toEqual({ caseId: "c9", applied: 3, error: null });
    expect(calls).toHaveLength(4);
    expect(calls[0]!.path).toBe("/api/cases");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ version_id: "v1", is_test: true });
    for (const call of calls.slice(1)) {
      expect(call.path).toBe("/api/cases/c9/commands");
      expect(call.method).toBe("POST");
      expect(call.headers?.["X-Zotra-User"]).toBe("u-advisor");
    }
  });

  test("3.4 row 5: the patch replaces the values of its step", async () => {
    const calls = stubFetch((_calls, call) =>
      call.path === "/api/cases" ? createRoute : commandRoute,
    );
    const steps = commandsOf(replayEvents.slice(0, 5));
    await runCopy(steps, "v1", { seq: 5, values: { amount: 999 } });
    expect(calls[3]!.body).toEqual({
      type: "submit",
      data: {},
      values: { amount: 999 },
      decision: "",
      document_hash: "",
    });
    expect(calls[3]!.headers?.["X-Zotra-User"]).toBe("u-advisor");
  });

  test("3.4 row 6: the first refusal stops the copy, the partial copy stays", async () => {
    const calls = stubFetch((seen, call) => {
      if (call.path === "/api/cases") {
        return createRoute;
      }
      return seen.length === 2 ? commandRoute : refusedRoute;
    });
    const steps = commandsOf([replayEvents[0]!, replayEvents[5]!]);
    const answer = await runCopy(steps, "v1", null);
    expect(answer).toEqual({
      caseId: "c9",
      applied: 1,
      error: "decision favorable is not a decision of node analysis",
    });
    expect(calls).toHaveLength(3);
    expect(calls[1]!.path).toBe("/api/cases/c9/commands");
    expect(calls[2]!.path).toBe("/api/cases/c9/commands");
  });

  test("3.4 row 8b: a create refusal gives caseId empty and no command", async () => {
    const calls = stubFetch((_calls, call) =>
      call.path === "/api/cases" ? notFoundRoute : commandRoute,
    );
    const answer = await runCopy(
      commandsOf(replayEvents.slice(0, 5)),
      "v1",
      null,
    );
    expect(answer).toEqual({ caseId: "", applied: 0, error: "no version v1" });
    expect(calls).toHaveLength(1);
  });
});

describe("replay dialog body", () => {
  test("3.4 row 7: the title, the select with the first submit and its fields", () => {
    const html = renderBody();
    expect(html).toContain("Replay from event 6");
    expect(html).toContain('aria-label="About the replay copy"');
    expect(html).not.toContain("The copy runs the same commands");
    expect(html).toContain("Values to change");
    expect(html).toContain("Application entry · event 5");
    expect(html).toContain('aria-label="Amount"');
    expect(html).toContain('value="120000"');
    expect(html).toContain("Cancel");
    expect(html).toContain("Create the copy");
  });

  test("3.4 row 7b: an unknown node id falls back to the raw id", () => {
    const events = replayEvents.map((e) =>
      e.seq === 5
        ? { ...e, payload: { node_id: "unknown_node", values: { amount: 120000 } } }
        : e,
    );
    expect(renderBody({ events })).toContain("unknown_node · event 5");
  });

  test("3.4 row 8: no submit before the point gives the empty line and no select", () => {
    const html = renderBody({ at: 5 });
    expect(html).toContain("No submitted values before event 5.");
    expect(html).not.toContain("Values to change");
  });

  test("3.4 row 9: busy disables the create button, the error text shows", () => {
    expect(renderBody({ busy: true })).toMatch(
      /<button[^>]*disabled[^>]*>[^<]*Create the copy/,
    );
    expect(renderBody({ error: "step already assigned" })).toContain(
      "step already assigned",
    );
  });
});
