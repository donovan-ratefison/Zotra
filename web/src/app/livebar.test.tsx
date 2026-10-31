// The test rows of the live bar: the sentence of each event type, the
// two live queries, and the render of the bar from seeded caches.
// React SSR inserts comment markers between adjacent text nodes, so
// every string that a row must find whole renders as one string.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "../studio/api";
import type { UserDTO } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import { LiveBar, liveQueries, tickerLine } from "./LiveBar";
import type { AuditEvent, AuditVerify } from "./sup-api";

const def = JSON.parse(
  readFileSync("../internal/store/seed/example-process.json", "utf8"),
) as ProcessDefinition;

const users: UserDTO[] = [{ id: "u-analyst", name: "Demo Analyst", role_ids: ["analyst"] }];

function ev(type: string, payload: Record<string, unknown>, actor = "u-analyst"): AuditEvent {
  return {
    case_id: "c1",
    seq: 4,
    type,
    at: "2026-10-31T09:47:12.345678Z",
    actor,
    payload,
    prev_hash: "p",
    hash: "h",
    reference: "CASE-2026-0135",
  };
}

const text = (e: AuditEvent) => tickerLine(def, e, users).text;

describe("ticker sentences", () => {
  test("K1: case_created", () => {
    expect(tickerLine(def, ev("case_created", {}), users)).toEqual({
      time: "09:47",
      actor: "Demo Analyst",
      text: "created CASE-2026-0135",
      system: false,
    });
  });
  test("K2: step_entered by the system", () => {
    expect(tickerLine(def, ev("step_entered", { node_id: "analysis" }, "system"), users)).toEqual({
      time: "09:47",
      actor: "System",
      text: "moved CASE-2026-0135 to Credit analysis",
      system: true,
    });
  });
  test("K3: edge_taken with a rule", () => {
    expect(text(ev("edge_taken", { edge_id: "e07" }, "system"))).toBe(
      "sent CASE-2026-0135 to Credit decision by the rule amount > 100000.0",
    );
  });
  test("K4: edge_taken by the default way", () => {
    expect(text(ev("edge_taken", { edge_id: "e08" }))).toBe(
      "sent CASE-2026-0135 to Loan offer by the default way",
    );
  });
  test("K5: edge_taken from a task, and an unknown edge", () => {
    expect(text(ev("edge_taken", { edge_id: "e05" }))).toBe(
      "sent CASE-2026-0135 to Amount above EUR 100,000?",
    );
    expect(text(ev("edge_taken", { edge_id: "e99" }))).toBe("sent CASE-2026-0135 on the link e99");
  });
  test("K6: step_assigned", () => {
    expect(text(ev("step_assigned", { node_id: "analysis", user_id: "u-analyst" }))).toBe(
      "took CASE-2026-0135 at Credit analysis",
    );
  });
  test("K7: data_submitted", () => {
    expect(text(ev("data_submitted", { node_id: "entry", values: {} }))).toBe(
      "submitted CASE-2026-0135 at Application entry",
    );
  });
  test("K8: check_evaluated, passed and failed", () => {
    const p = { node_id: "analysis", check_id: "analysis-blacklist", error: null };
    expect(text(ev("check_evaluated", { ...p, result: true }))).toBe(
      "passed the check analysis-blacklist on CASE-2026-0135",
    );
    expect(text(ev("check_evaluated", { ...p, result: false }))).toBe(
      "failed the check analysis-blacklist on CASE-2026-0135",
    );
  });
  test("K9: decision_made", () => {
    expect(text(ev("decision_made", { node_id: "analysis", decision: "favorable" }))).toBe(
      "sent the decision Favorable on CASE-2026-0135",
    );
  });
  test("K10: signature_added", () => {
    expect(
      text(ev("signature_added", { node_id: "decision", user_id: "u-analyst", document_hash: "x" })),
    ).toBe("signed CASE-2026-0135 at Credit decision");
  });
  test("K11: case_closed", () => {
    expect(text(ev("case_closed", { node_id: "released", result: "approved" }))).toBe(
      "closed CASE-2026-0135: approved",
    );
  });
  test("K12: source_fetched, known and unknown source", () => {
    const p = { node_id: "analysis", values: {} };
    expect(text(ev("source_fetched", { ...p, source_id: "blacklist" }))).toBe(
      "read Credit blacklist for CASE-2026-0135",
    );
    expect(text(ev("source_fetched", { ...p, source_id: "ghost" }))).toBe(
      "read ghost for CASE-2026-0135",
    );
  });
  test("K13: other type, unknown actor", () => {
    const line = tickerLine(def, ev("other_type", {}, "u-ghost"), users);
    expect(line.text).toBe("wrote other_type on CASE-2026-0135");
    expect(line.actor).toBe("u-ghost");
  });
  test("K14: unknown node", () => {
    expect(text(ev("data_submitted", { node_id: "nowhere", values: {} }))).toBe(
      "submitted CASE-2026-0135 at nowhere",
    );
  });
});

describe("live queries", () => {
  test("Q1: keys and refetch interval", () => {
    const q = liveQueries();
    expect(q.audit.queryKey).toEqual(["audit", "live"]);
    expect(q.verify.queryKey).toEqual(["audit-verify", "live"]);
    expect(q.audit.refetchInterval).toBe(10000);
    expect(q.verify.refetchInterval).toBe(10000);
  });
});

const k9 = ev("decision_made", { node_id: "analysis", decision: "favorable" });
const k7 = ev("data_submitted", { node_id: "entry", values: {} });

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
}

function render(c: QueryClient): string {
  return renderToString(
    createElement(QueryClientProvider, { client: c }, createElement(LiveBar, { def, users })),
  );
}

function seeded(verify: AuditVerify, events: AuditEvent[] = [k9, { ...k7, seq: 3 }]): QueryClient {
  const c = client();
  c.setQueryData(["audit", "live"], { events, total: events.length });
  c.setQueryData(["audit-verify", "live"], verify);
  return c;
}

function failed(c: QueryClient, queryKey: string[], error: Error) {
  c.getQueryCache().build(c, { queryKey }).setState({ status: "error", error, fetchStatus: "idle" });
}

describe("live bar render", () => {
  test("B1: verified chain and the ticker", () => {
    const html = render(seeded({ cases: 1, events: 2, broken: [] }));
    expect(html).toContain("Event log · chain verified");
    expect(html.split(">New<").length - 1).toBe(2);
    expect(html).toContain("sent the decision Favorable on CASE-2026-0135");
    expect(html).toContain("09:47");
    expect(html).toContain('aria-hidden="true"');
  });
  test("B2: broken chain", () => {
    const html = render(seeded({ cases: 1, events: 2, broken: [{ case_id: "c1", seq: 3 }] }));
    expect(html).toContain("Event log · chain broken");
  });
  test("B3: no cache", () => {
    const html = render(client());
    expect(html).toContain("Event log · checking the chain");
    expect(html).toContain("Loading the events.");
  });
  test("B4: both queries in error", () => {
    const c = client();
    failed(c, ["audit", "live"], new ApiError(400, "invalid_limit", "the limit must be between 1 and 500", []));
    failed(c, ["audit-verify", "live"], new ApiError(500, "http", "HTTP 500", []));
    const html = render(c);
    expect(html).toContain("The events did not load: the limit must be between 1 and 500");
    expect(html).toContain("Event log · the check did not load");
  });
  test("B5: no event", () => {
    const html = render(seeded({ cases: 0, events: 0, broken: [] }, []));
    expect(html).toContain("No event yet.");
  });
});
