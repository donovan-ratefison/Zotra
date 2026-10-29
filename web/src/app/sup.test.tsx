// The test rows of lot 6.3, in the order of the brief. The
// environment repeats lot 6.2: renderToString, one local QueryClient
// with retry false, pre-seeded caches, and the recording fetch stub
// for the api rows. React SSR inserts comment markers between
// adjacent text nodes, so every string that a row must find whole
// renders from one template literal.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "../studio/api";
import { fetchSupervision, fetchAudit, fetchAuditVerify } from "./sup-api";
import type { AuditEvent, AuditVerify, Supervision } from "./sup-api";
import { heatColor, SupervisionScreen } from "./SupervisionScreen";
import { AuditScreen } from "./AuditScreen";
import { AppShell } from "./AppShell";
import type { InboxCase } from "./app-api";
import type { UserDTO } from "../studio/case-api";
import type {
  ProcessDefinition,
  VersionStatus,
  VersionSummary,
} from "../studio/types";

// The fixtures of lot 6.2, copied: the base definition, the users and
// the version rows.
const defFixture: ProcessDefinition = {
  schema_version: "1",
  name: "Home loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Banque Ravina", primary_color: "#0f4c45", logo_url: null },
  roles: [{ id: "advisor", name: "Advisor", department: "Branch" }],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
    { name: "client_name", label: "Client", type: "string", options: [], computed: null },
    { name: "kind", label: "Kind", type: "enum", options: ["fast", "slow"], computed: null },
  ],
  scope: [
    { field: "amount", role: "advisor", access: "write" },
    { field: "client_name", role: "advisor", access: "write" },
    { field: "kind", role: "advisor", access: "write" },
  ],
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

const usersFixture: UserDTO[] = [
  { id: "u-advisor", name: "Demo Advisor", role_ids: ["advisor"] },
  { id: "u-analyst", name: "Demo Analyst", role_ids: ["analyst"] },
  { id: "u-backoffice", name: "Demo Back-office", role_ids: ["backoffice"] },
  { id: "u-director", name: "Demo Director", role_ids: ["director"] },
  { id: "u-legal", name: "Demo Legal Officer", role_ids: ["legal"] },
];

const inboxCase: InboxCase = {
  id: "c1",
  version_id: "v1",
  reference: "CASE-2026-0001",
  is_test: false,
  created_at: "2026-10-27T12:00:00Z",
  node_id: "entry",
  status: "open",
};

const inboxUser = { id: "u-advisor", name: "Demo Advisor", role_ids: ["advisor"] };

const processesSeed = [
  { id: "p1", name: "Home loan", created_at: "2026-10-27T09:00:00Z" },
];

// A full version row with exact values (the lot 6.1 helper).
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

const versionSeed = {
  ...versionRow(1, "published"),
  definition: defFixture,
};

// The fixtures of lot 6.3: the supervision answer, the audit answer
// and the verify answer, every value exact.
const supCase = {
  case_id: "c1",
  reference: "CASE-2026-0001",
  node_id: "entry",
  assignee: "u-advisor",
  age_hours: 25,
  late: true,
  data: { amount: 240000, client_name: "Hanta Rakotobe" },
};

const supCase2 = {
  ...supCase,
  case_id: "c2",
  reference: "CASE-2026-0002",
  assignee: "",
  age_hours: 26,
};

const supAnswer: Supervision = {
  version_id: "v1",
  total_open: 2,
  total_late: 2,
  nodes: [
    { node_id: "entry", open: 2, late: 2, median_hours: 25 },
    { node_id: "review", open: 0, late: 0, median_hours: 0 },
    { node_id: "complete", open: 0, late: 0, median_hours: 0 },
    { node_id: "released", open: 0, late: 0, median_hours: 0 },
    { node_id: "refused", open: 0, late: 0, median_hours: 0 },
  ],
  people: [{ user_id: "u-advisor", open: 1, late: 1 }],
  cases: [supCase, supCase2],
};

const auditEvent: AuditEvent = {
  case_id: "c1",
  seq: 3,
  type: "data_submitted",
  at: "2026-10-27T12:00:01Z",
  actor: "u-advisor",
  payload: { node_id: "entry", values: { amount: 240000 } },
  prev_hash: "x",
  hash: "y",
  reference: "CASE-2026-0001",
};

const auditAnswer = { events: [auditEvent], total: 1284 };

const verifyAnswer: AuditVerify = { cases: 12, events: 1284, broken: [] };

const seen: { url: string; init: RequestInit }[] = [];

// stubFetch answers one status with one body, and records the call.
function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve({
      ok: status < 400,
      status,
      json: async () => body,
    });
  });
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderApp(client: QueryClient): string {
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AppShell),
    ),
  );
}

// seedShell fills the stage caches, the users and the inbox, the row
// 12 set of lot 6.2.
function seedShell(client: QueryClient) {
  client.setQueryData(["processes"], processesSeed);
  client.setQueryData(["versions", "p1"], [versionRow(1, "published")]);
  client.setQueryData(["version", "v1"], versionSeed);
  client.setQueryData(["users"], usersFixture);
  client.setQueryData(["inbox", "u-advisor"], { user: inboxUser, cases: [inboxCase] });
}

// renderSupervision renders the screen with the fixture props.
function renderSupervision(
  sup: Supervision,
  selectedNodeId?: string | null,
): string {
  return renderToString(
    createElement(SupervisionScreen, {
      def: defFixture,
      version: versionRow(1, "published"),
      users: usersFixture,
      supervision: sup,
      selectedNodeId,
    }),
  );
}

// renderAudit renders the screen with the fixture props.
function renderAudit(
  audit = auditAnswer,
  verify: AuditVerify | null = null,
): string {
  return renderToString(
    createElement(AuditScreen, {
      def: defFixture,
      users: usersFixture,
      audit,
      verify,
      busy: false,
      onVerify: () => {},
      onExport: () => {},
    }),
  );
}

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

describe("heat color", () => {
  test("6.3 row W1: heatColor maps the ratio bands and the null deadline", () => {
    expect(heatColor(10, 24)).toBe("#16a34a");
    expect(heatColor(20, 24)).toBe("#d97706");
    expect(heatColor(25, 24)).toBe("#dc2626");
    expect(heatColor(10, null)).toBe("#71717a");
  });
});

describe("supervision screen", () => {
  test("6.3 row W2: the head, the tiles, the flow and the load card render", () => {
    const html = renderSupervision(supAnswer);
    expect(html).toContain("Supervision");
    expect(html).toContain("Read only view of the open cases of v1.");
    expect(html).toContain("Open cases");
    // The tile value, as one whole span text (the Open cases tile; the
    // class names the tile value span, the chips carry their own).
    expect(html).toContain('class="text-2xl font-semibold">2</span>');
    expect(html).toContain("across 1 steps");
    expect(html).toContain("Late");
    expect(html).toContain("past the step deadline");
    expect(html).toContain("Steps and indicators");
    expect(html).toContain("Application entry");
    expect(html).toContain("File complete?");
    expect(html).toContain("Select a step to see its cases.");
    expect(html).toContain("Load per participant");
    expect(html).toContain("Demo Advisor");
    expect(html).toContain("→");
    expect(html).toContain("aria-hidden");
  });

  test("6.3 row W2b: the selected step shows its case rows", () => {
    const html = renderSupervision(supAnswer, "entry");
    expect(html).toContain("Application entry");
    expect(html).toContain("2 open, 2 late");
    expect(html).not.toContain("Select a step to see its cases.");
    expect(html).toContain("CASE-2026-0001");
    expect(html).toContain("Hanta Rakotobe");
    expect(html).toContain("€240,000.00");
    expect(html).toContain("Demo Advisor");
    expect(html).toContain("25 h");
    expect(html).toContain("Yes");
    expect(html).toContain("CASE-2026-0002");
    expect(html).toContain("26 h");
  });
});

describe("supervision and audit api", () => {
  test("6.3 row W3: fetchSupervision reads the version supervision", async () => {
    stubFetch(200, supAnswer);
    await expect(fetchSupervision("v1")).resolves.toEqual(supAnswer);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/versions/v1/supervision");
  });

  test("6.3 row W4: fetchAudit reads the audit with the limit", async () => {
    stubFetch(200, auditAnswer);
    await expect(fetchAudit(50)).resolves.toEqual(auditAnswer);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/audit?limit=50");
  });

  test("6.3 row W5: fetchAuditVerify reads the chain check", async () => {
    stubFetch(200, verifyAnswer);
    await expect(fetchAuditVerify()).resolves.toEqual(verifyAnswer);
  });

  test("6.3 row W6: a bad limit rejects as ApiError with the body code", async () => {
    stubFetch(400, {
      error: {
        code: "invalid_limit",
        message: "the limit must be between 1 and 500",
        details: [],
      },
    });
    const err = await fetchAudit(50).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("invalid_limit");
    expect(err.message).toBe("the limit must be between 1 and 500");
  });
});

describe("audit screen", () => {
  test("6.3 row W7: the head, the buttons, the row and the footer render", () => {
    const html = renderAudit();
    expect(html).toContain("Audit log");
    expect(html).toContain("Every event carries the hash of the previous one.");
    expect(html).toContain("Verify chain");
    expect(html).toContain("Export");
    expect(html).toContain("CASE-2026-0001");
    expect(html).toContain("Demo Advisor");
    expect(html).toContain("Data submitted on Application entry");
    expect(html).toContain("27/10/2026, 12:00:01");
    expect(html).toContain(">y</td>");
    expect(html).toContain(">x</td>");
    expect(html).toContain("1 of 1284 events.");
    expect(html).not.toContain("Chain verified");
    expect(html).not.toContain("Chain broken");
  });

  test("6.3 row W7b: an actor outside the users list renders raw", () => {
    const html = renderAudit(
      { events: [{ ...auditEvent, actor: "system" }], total: 1284 },
    );
    expect(html).toContain(">system</td>");
  });

  test("6.3 row W8: the verify banner shows the ok text or the break", () => {
    const ok = renderAudit(auditAnswer, verifyAnswer);
    expect(ok).toContain(
      "Chain verified: 1284 events across 12 cases, no break.",
    );
    const bad = renderAudit(auditAnswer, {
      cases: 12,
      events: 1284,
      broken: [{ case_id: "c9", seq: 4 }],
    });
    expect(bad).toContain("Chain broken: case c9 at event 4.");
  });
});

describe("app shell views", () => {
  test("6.3 row W9: the view parameter shows the audit or the supervision", () => {
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=audit",
    });
    const client = newClient();
    seedShell(client);
    client.setQueryData(["supervision", "v1"], supAnswer);
    client.setQueryData(["audit"], auditAnswer);
    const html = renderApp(client);
    expect(html).toContain("Audit log");
    expect(html).toContain("Verify chain");
    expect(html).toContain("1 of 1284 events.");
    expect(html).not.toContain("Cases that wait");
    expect(html).not.toContain("Take the case");

    const other = newClient();
    seedShell(other);
    other.setQueryData(["supervision", "v1"], supAnswer);
    other.setQueryData(["audit"], auditAnswer);
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=supervision",
    });
    const sup = renderApp(other);
    expect(sup).toContain("Open cases");
    expect(sup).not.toContain("Cases that wait");
  });

  test("6.3 row W9b: a pending supervision query loads in the main area", () => {
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=supervision",
    });
    const client = newClient();
    seedShell(client);
    const html = renderApp(client);
    expect(html).toContain("Loading");
    expect(html).not.toContain("Open cases");
    expect(html).not.toContain("Cases that wait");
  });

  test("6.3 row W9c: a pending audit query loads in the main area", () => {
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=audit",
    });
    const client = newClient();
    seedShell(client);
    const html = renderApp(client);
    expect(html).toContain("Loading");
    expect(html).not.toContain("Every event carries the hash");
    expect(html).not.toContain("Cases that wait");
  });
});
