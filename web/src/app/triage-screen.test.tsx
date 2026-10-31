// The triage screen test rows V1, V2, D1 to D8, CV1, CV2 and T1 to T7, in order. The
// environment is node: renderToString with pre-seeded caches.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import seedJson from "../../../internal/store/seed/example-process.json";
import { ApiError } from "../studio/api";
import type { CaseEvent, CaseState, UserDTO } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import type { CheckResult, InboxCase } from "./app-api";
import { viewOf, viewUrl } from "./AppShell";
import { TriageScreen } from "./TriageScreen";

const def = seedJson as ProcessDefinition;
const version = {
  id: "v1", process_id: "p1", parent_id: null, number: 1, label: "Initial", status: "published",
  created_at: "2026-10-27T09:00:00Z", frozen_at: "2026-10-27T09:30:00Z", definition: def,
};
const users: UserDTO[] = [
  { id: "u-analyst", name: "Demo Analyst", role_ids: ["analyst"] },
  { id: "u-other", name: "Demo Analyst 2", role_ids: ["analyst"] },
];
const now = Date.parse("2026-10-31T17:00:00Z");

const ev = (id: string, seq: number, at: string, node: string): CaseEvent => ({
  case_id: id, seq, type: "step_entered", at, actor: "system", payload: { node_id: node }, prev_hash: "", hash: "",
});
const path = (id: string, entered: string): CaseEvent[] => [
  ev(id, 1, "2026-10-28T10:00:00Z", "entry"),
  ev(id, 2, "2026-10-29T10:00:00Z", "complete"),
  ev(id, 3, entered, "analysis"),
];

const hery = {
  client_name: "Hery Rasolofo", profession: "Civil engineer", amount: 180000, duration_months: 240,
  down_payment: 36000, annual_rate: 0.035, monthly_income: 5200, monthly_payment: 1043.9274923695693,
  debt_ratio: 0.20075528699414794,
};
const sources = { blacklist: { listed: false }, existing_loans: { monthly_total: 420 } };
const state = (id: string, data: Record<string, unknown>, over: Partial<CaseState> = {}): CaseState => ({
  case_id: id, version_id: "v1", status: "open", result: "", node_id: "analysis", assignee: "", data, sources,
  seq: 3, prev_hash: "", ...over,
});
const inbox = (id: string, n: number, created: string, node = "analysis"): InboxCase => ({
  id, version_id: "v1", reference: `CASE-2026-000${n}`, is_test: false, created_at: created, node_id: node, status: "open",
});
const c1 = inbox("c1", 1, "2026-10-28T10:00:00Z");
const c2 = inbox("c2", 2, "2026-10-28T11:00:00Z");
const c3 = inbox("c3", 3, "2026-10-28T12:00:00Z");
const c4 = inbox("c4", 4, "2026-10-28T13:00:00Z", "entry");
const rowOf = (c: InboxCase) => ({
  id: c.id, version_id: c.version_id, reference: c.reference, is_test: false, created_at: c.created_at,
});
const doc = (id: string, name: string) => ({
  id, case_id: "c1", name, mime: "image/png", sha256: "", created_at: "2026-10-28T10:00:00Z",
});
const checks = (failing = ""): CheckResult[] =>
  def.nodes.find((n) => n.id === "analysis")!.checks.map((c) => ({
    id: c.id, message: c.message, expression: c.expression, passed: c.id !== failing, error: null,
  }));

interface Seed {
  c1State?: CaseState;
  c3Entered?: string;
  c1Checks?: CheckResult[] | null;
  noC1Docs?: boolean;
  noC2Events?: boolean;
  c2Error?: boolean;
}

function seed(s: Seed = {}): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  client.setQueryData(["version", "v1"], version);
  const set = (c: InboxCase, st: CaseState, events: CaseEvent[]) => {
    client.setQueryData(["case", c.id], { case: rowOf(c), state: st });
    client.setQueryData(["events", c.id], events);
  };
  set(c1, s.c1State ?? state("c1", hery), path("c1", "2026-10-30T10:00:00Z"));
  set(c2, state("c2", { client_name: "Voahangy Rasoanaivo", amount: 62000 }), path("c2", "2026-10-31T10:00:00Z"));
  set(c3, state("c3", { client_name: "Lalao Randria", amount: 85000 }), path("c3", s.c3Entered ?? "2026-10-31T12:00:00Z"));
  set(c4, state("c4", { client_name: "Fara Rakoto" }, { node_id: "entry" }), [ev("c4", 1, "2026-10-28T13:00:00Z", "entry")]);
  if (s.noC2Events) client.removeQueries({ queryKey: ["events", "c2"] });
  if (s.c2Error) {
    client.removeQueries({ queryKey: ["case", "c2"] });
    client
      .getQueryCache()
      .build(client, { queryKey: ["case", "c2"] })
      .setState({ status: "error", error: new ApiError(404, "not_found", "case not found", []), fetchStatus: "idle" });
  }
  if (!s.noC1Docs) {
    client.setQueryData(["documents", "c1"], [
      doc("d1", "ID card.png"), doc("d2", "Salary slips.png"), doc("d3", "Bank statements.png"), doc("d4", "Property title.png"),
    ]);
  }
  if (s.c1Checks !== null) {
    client.setQueryData(["checks", "c1"], { node_id: "analysis", checks: s.c1Checks ?? checks() });
  }
  return client;
}

function render(client: QueryClient, cases: InboxCase[] = [c1, c2, c3, c4], start: string[] = []): string {
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(TriageScreen, { userId: "u-analyst", users, cases, now, onExit: () => {}, start, onOpenCase: () => {} }),
    ),
  );
}

const F_ENABLED = /<button type="button" aria-keyshortcuts="F"/;
const F_DISABLED = /<button type="button" disabled="" aria-keyshortcuts="F"/;

describe("triage urls", () => {
  test("V1: viewOf", () => {
    expect(viewOf("/app/triage", "?user=u-analyst")).toBe("triage");
    expect(viewOf("/app/triage/", "")).toBe("triage");
    expect(viewOf("/app", "?view=audit")).toBe("audit");
    expect(viewOf("/app", "?view=triage")).toBe("inbox");
    expect(viewOf("/app", "")).toBe("inbox");
  });

  test("V2: viewUrl", () => {
    expect(viewUrl("u-analyst", "triage")).toBe("/app/triage?user=u-analyst");
    expect(viewUrl("u-analyst", "inbox")).toBe("/app?user=u-analyst");
    expect(viewUrl("u-analyst", "audit")).toBe("/app?user=u-analyst&view=audit");
  });
});

describe("triage screen", () => {
  test("D1: the front card of the full deck", () => {
    const html = render(seed());
    for (const text of [
      "Triage: Credit analysis",
      "Rules and humans decide. The AI only checks.",
      "Case 1 of 3",
      "Next: Voahangy Rasoanaivo, €62,000.00",
      "CASE-2026-0001",
      "Received 79 h ago",
      "Hery Rasolofo",
      "Civil engineer · Home loan v1 · Not taken",
      "€180,000.00",
      "240 months at 3.5%",
      "17 h left",
      "€36,000.00",
      "€420.00",
      "28.2%",
      "3 of 3 pass",
      "4 of 4 attached",
      "Attached: ID card.png",
      "Favorable",
      "Unfavorable",
      "No blocker. All rules pass.",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(F_ENABLED);
  });

  test("D2: a failed check locks F and U", () => {
    const html = render(seed({ c1Checks: checks("analysis-blacklist") }));
    expect(html).toContain(
      "F and U are locked. The rule analysis-blacklist fails. The client is on the credit blacklist.",
    );
    expect(html).toContain("2 of 3 pass");
    expect(html).toMatch(F_DISABLED);
  });

  test("D3: pending checks and documents", () => {
    const html = render(seed({ c1Checks: null, noC1Docs: true }));
    expect(html).toContain("Loading the checks.");
    expect(html).toContain("F and U are locked. Loading the checks.");
    expect(html).toContain("Loading the documents.");
    expect(html).toMatch(F_DISABLED);
  });

  test("D4: a case taken by another user", () => {
    const html = render(seed({ c1State: state("c1", hery, { assignee: "u-other" }) }));
    expect(html).toContain("Assigned to Demo Analyst 2");
    expect(html).toContain("F and U are locked. The case is taken by Demo Analyst 2.");
  });

  test("D5: a late case comes first", () => {
    const html = render(seed({ c3Entered: "2026-10-29T16:00:00Z" }));
    expect(html).toContain("Case 1 of 3");
    expect(html).toMatch(/<h2[^>]*>Lalao Randria<\/h2>/);
    expect(html).toContain("Late by 1 h");
  });

  test("D6: pending events give the loading stage", () => {
    const html = render(seed({ noC2Events: true }));
    expect(html).toContain("Loading the triage.");
    expect(html).not.toContain("Case 1 of");
  });

  test("D7: a case error gives the error stage", () => {
    const html = render(seed({ c2Error: true }));
    expect(html).toContain("The triage did not load.");
    expect(html).toContain("case not found");
  });

  test("D8: no case at a decision step", () => {
    const html = render(seed(), [c4]);
    expect(html).toContain("No case waits for a decision.");
    expect(html).toContain("Back to the inbox");
  });

  test("CV1: the front card has the chain strip", () => {
    const html = render(seed());
    expect(html).toContain('aria-label="Case history"');
    expect(html.split("Verify chain").length - 1).toBe(2);
  });

  test("CV2: an empty queue has no chain strip", () => {
    expect(render(seed(), [c4])).not.toContain("Case history");
  });

  test("T1: the document rows open the dialog", () => {
    const html = render(seed());
    for (const i of [0, 1, 2, 3]) expect(html).toContain(`data-doc="${i}"`);
    expect(html).toContain("View");
    expect(html.match(/<kbd[^>]*>D<\/kbd>/g)).toHaveLength(2);
    expect(html).toMatch(/<button type="button" class="[^"]*"><kbd[^>]*>D<\/kbd>Documents<\/button>/);
  });

  test("T2: pending documents disable the Documents key", () => {
    const html = render(seed({ c1Checks: null, noC1Docs: true }));
    expect(html).toMatch(/<button type="button" class="[^"]*" disabled=""><kbd[^>]*>D<\/kbd>Documents<\/button>/);
  });

  test("T3: the dialog is closed at first render", () => {
    expect(render(seed())).not.toContain("Back to the case");
  });

  test("T4: the Open the case key is the last key", () => {
    const html = render(seed());
    expect(html).toContain('aria-keyshortcuts="O"');
    expect(html).toContain(">O</kbd>Open the case</button>");
    expect(html).toContain("Case 1 of 3");
  });

  test("T5: back keeps the card", () => {
    const html = render(seed(), undefined, ["c2", "c3"]);
    expect(html).toContain("Case 2 of 3");
    expect(html).toContain(">Voahangy Rasoanaivo</h2>");
    expect(html).toContain("Next: Lalao Randria");
  });

  test("T6: a send moves to the next card", () => {
    const html = render(seed(), [c2, c3, c4], ["c2", "c3"]);
    expect(html).toContain("Case 1 of 2");
    expect(html).toContain(">Voahangy Rasoanaivo</h2>");
  });

  test("T7: a start id that is not in the queue", () => {
    const html = render(seed(), undefined, ["x", "c3"]);
    expect(html).toContain("Case 3 of 3");
    expect(html).toContain("Last case");
  });
});
