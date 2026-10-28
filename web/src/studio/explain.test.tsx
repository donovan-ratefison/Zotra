// The web rows of lot 3.5, in the order of the brief. The
// environment is node: renderToString for the components, no jsdom
// (the patterns of the approved lots). The fixtures are the base of
// lot 3.1 (the testDefinition, the case, the state and the events)
// with the state at seq 4, so the false check_evaluated sits at or
// before the state seq.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "./api";
import { explainCheck, type ExplainAnswer } from "./ai-api";
import { ChecksTab, ExplainCard } from "./ChecksTab";
import {
  withCheckExpression,
  withCheckMessage,
  withCheckPlainText,
} from "./node-edit";
import type { CaseEvent, CaseState } from "./case-api";
import type { ProcessDefinition } from "./types";

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

// The state rests on entry at seq 4, so the false check of seq 4 is
// the last evaluation of c1.
const stateFixture: CaseState = {
  case_id: "c1",
  version_id: "v1",
  status: "open",
  result: "",
  node_id: "entry",
  data: { amount: 120000 },
  assignee: "",
  seq: 4,
  prev_hash: "x",
};

const eventsFixture: CaseEvent[] = [
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

// The answer fixture of the brief.
const answerFixture: ExplainAnswer = {
  explanation: "The duration of 400 months passes the ceiling of 300 months.",
  proposal: {
    expression: "duration_months <= 360",
    message: "The duration must stay at or under 360 months.",
    plain_text: "The loan duration stays at or under 360 months.",
  },
};

function stubFetch(status: number, body: unknown) {
  const calls: { path: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    (
      path: string,
      init?: { method?: string; body?: string },
    ) => {
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
});

// renderCard renders ExplainCard directly, with every prop named (the
// direct-render pattern of the approved lots).
function renderCard(versionStatus: "draft" | "frozen" | "published" | null): string {
  return renderToString(
    createElement(ExplainCard, {
      answer: answerFixture,
      versionStatus,
      busyApply: false,
      onApply: () => {},
      onReject: () => {},
    }),
  );
}

// renderChecks renders ChecksTab on the failed c1 card, with every
// prop named.
function renderChecks(props: {
  caseId?: string | null;
  replaying?: boolean;
}): string {
  return renderToString(
    createElement(ChecksTab, {
      def: testDefinition,
      state: stateFixture,
      events: eventsFixture,
      nodeId: "entry",
      caseId: props.caseId ?? null,
      replaying: props.replaying ?? false,
    }),
  );
}

describe("explainCheck", () => {
  test("3.5 row 13: a 200 answer resolves with both fields", async () => {
    const calls = stubFetch(200, answerFixture);
    const answer = await explainCheck("c1", "entry", "c1");
    expect(answer).toEqual(answerFixture);
    expect(calls[0]).toEqual({
      path: "/api/ai/explain-check",
      method: "POST",
      body: { case_id: "c1", node_id: "entry", check_id: "c1" },
    });
  });

  test("3.5 row 14: a 503 error body rejects as ApiError", async () => {
    stubFetch(503, {
      error: {
        code: "ai_unavailable",
        message: "The AI layer is off.",
        details: [],
      },
    });
    const error = await explainCheck("c1", "entry", "c1").then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiErr = error as ApiError;
    expect(apiErr.status).toBe(503);
    expect(apiErr.code).toBe("ai_unavailable");
  });
});

describe("withCheckPlainText", () => {
  test("3.5 row 15: the plain text changes, the expression stays", () => {
    const next = withCheckPlainText(
      testDefinition,
      "entry",
      "c1",
      "Keep the ratio low.",
    );
    const check = next.nodes
      .find((n) => n.id === "entry")!
      .checks.find((c) => c.id === "c1")!;
    expect(check.plain_text).toBe("Keep the ratio low.");
    expect(check.expression).toBe("amount > 10.0");
    expect(check.message).toBe("The amount must be positive.");
  });
});

describe("ExplainCard", () => {
  test("3.5 row 16: the draft card renders the proposal, apply enabled", () => {
    const html = renderCard("draft");
    expect(html).toContain(
      "The duration of 400 months passes the ceiling of 300 months.",
    );
    expect(html).toContain("Proposed rule:");
    expect(html).toContain("duration_months &lt;= 360");
    expect(html).toContain(
      "New message: The duration must stay at or under 360 months.",
    );
    expect(html).toContain(
      "Plain language: The loan duration stays at or under 360 months.",
    );
    expect(html).toContain("Reject");
    expect(html).toContain("Apply to draft");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("Only a draft can be edited.");
  });

  test.each(["published", "frozen"] as const)(
    "3.5 row 18: the %s card disables the apply button and notes the fork",
    (versionStatus) => {
      const html = renderCard(versionStatus);
      expect(html).toContain("Apply to draft");
      expect(html).toContain('disabled=""');
      expect(html).toContain(
        "Only a draft can be edited. Fork the version first.",
      );
    },
  );
});

describe("ChecksTab", () => {
  test("3.5 row 17: the failed card carries the explain button", () => {
    const html = renderChecks({ caseId: "c1", replaying: false });
    expect(html).toContain("Failed");
    expect(html).toContain("Explain this check");
  });

  test("3.5 row 19: no explain button without a case or in a replay", () => {
    expect(renderChecks({ caseId: null })).not.toContain(
      "Explain this check",
    );
    expect(renderChecks({ caseId: "c1", replaying: true })).not.toContain(
      "Explain this check",
    );
  });
});

describe("the apply chain", () => {
  test("3.5 row 20: the three fields change, the rest stays", () => {
    const next = withCheckPlainText(
      withCheckMessage(
        withCheckExpression(testDefinition, "entry", "c1", "amount > 5.0"),
        "entry",
        "c1",
        "New message.",
      ),
      "entry",
      "c1",
      "New rule text.",
    );
    const check = next.nodes
      .find((n) => n.id === "entry")!
      .checks.find((c) => c.id === "c1")!;
    expect(check).toEqual({
      id: "c1",
      expression: "amount > 5.0",
      message: "New message.",
      plain_text: "New rule text.",
      citations: [],
    });
    // The other nodes keep their identity.
    expect(next.nodes.find((n) => n.id === "review")).toBe(
      testDefinition.nodes.find((n) => n.id === "review"),
    );
  });
});
