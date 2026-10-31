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
import {
  fetchSupervision,
  fetchSupervisionAll,
  fetchAudit,
  fetchAuditVerify,
  fetchFlow,
  fetchFlowAll,
  mergeFlow,
  mergeSupervision,
} from "./sup-api";
import type { AuditEvent, AuditVerify, Flow, SupCase, Supervision } from "./sup-api";
import {
  blockOf,
  initials,
  leftText,
  listText,
  stepCases,
  SupervisionScreen,
  tileFigures,
  topHolder,
  trackWidth,
  whyText,
} from "./SupervisionScreen";
import { AuditScreen } from "./AuditScreen";
import { AppShell, viewSearch } from "./AppShell";
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
  returned: false,
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

// The flow answer of lot 14.2, every value exact.
const flowFixture: Flow = {
  days: 30,
  closed: 4,
  ends: [
    { node_id: "released", cases: 3, avg_lead_hours: 36 },
    { node_id: "refused", cases: 1, avg_lead_hours: 12 },
  ],
  edges: [
    { edge_id: "e1", passes: 5 },
    { edge_id: "e2", passes: 5 },
    { edge_id: "e3", passes: 4 },
    { edge_id: "e4", passes: 3 },
    { edge_id: "e5", passes: 1 },
    { edge_id: "e6", passes: 1 },
  ],
  returns: 1,
  today: { people: 6, rules: 9 },
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
      users: usersFixture,
      supervision: sup,
      flow: flowFixture,
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

// The supervision of rows T3, B2 and W2c: no late case.
const noLate: Supervision = {
  ...supAnswer,
  total_late: 0,
  nodes: supAnswer.nodes.map((n) => ({ ...n, late: 0 })),
  cases: supAnswer.cases.map((c) => ({ ...c, late: false })),
};

// The supervision of rows T3 and B4: one late case on review (listed
// first) and one on entry.
const twoLate: Supervision = {
  ...supAnswer,
  total_late: 2,
  nodes: [
    { node_id: "review", open: 1, late: 1, median_hours: 30 },
    { node_id: "entry", open: 1, late: 1, median_hours: 25 },
  ],
  cases: [{ ...supCase2, node_id: "review", age_hours: 30 }, supCase],
};

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

describe("supervision screen", () => {
  test("14.2b row W2: the head, the tabs, the tiles, the cards, the live card and the load card render", () => {
    const html = renderSupervision(supAnswer);
    expect(html).toContain("Supervision");
    expect(html).toContain("Live flow");
    expect(html).toContain("Case flow");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Cases in progress");
    // The tile value, as one whole span text (the Cases in progress
    // tile; the class names the tile value span, the chips carry their
    // own).
    expect(html).toContain('class="text-2xl font-semibold">2</span>');
    expect(html).toContain("Where it blocks");
    expect(html).toContain("Who decided today, since 00:00 UTC");
    expect(html).toContain("The AI never decides. It only proposes and checks.");
    expect(html).not.toContain("Open cases");
    expect(html).not.toContain("across 1 steps");
    expect(html).not.toContain("Steps and indicators");
    expect(html).toContain("Home loan, live flow of the open cases");
    // The layout runs in an effect, so the server render shows the wait text.
    expect(html).toContain("Drawing the diagram.");
    expect(html).toContain("Case goes back");
    expect(html).toContain("Application entry");
    expect(html).toContain("Load per participant");
    expect(html).toContain("Demo Advisor");
    expect(html).toContain("aria-hidden");
  });

  test("14.2 row W2c: no late case shows no block card", () => {
    expect(renderSupervision(noLate)).not.toContain("Where it blocks");
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
    expect(html).toContain("27 Oct, 12:00:01");
    expect(html).not.toContain("27/10/2026");
    expect(html).toContain(">y</td>");
    expect(html).toContain(">x</td>");
    expect(html).toContain("1 of 1284 events.");
    expect(html).not.toContain("Chain verified");
    expect(html).not.toContain("Chain broken");
  });

  test("6.3 row W7b, pol-3 row D7: the system actor reads System, another unknown actor stays raw", () => {
    const html = renderAudit(
      { events: [{ ...auditEvent, actor: "system" }], total: 1284 },
    );
    expect(html).toContain(">System</td>");
    expect(html).not.toContain(">system</td>");
    const raw = renderAudit(
      { events: [{ ...auditEvent, actor: "u-ghost" }], total: 1284 },
    );
    expect(raw).toContain(">u-ghost</td>");
  });

  test("pol-3 row D6: the time and case cells stay on one line", () => {
    const html = renderAudit();
    expect(html).toMatch(/<td class="whitespace-nowrap[^"]*">27 Oct, 12:00:01<\/td>/);
    expect(html).toMatch(/<td class="whitespace-nowrap[^"]*">CASE-2026-0001<\/td>/);
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

// The sidebar entries, in the prop order of React: type, aria-pressed,
// then class.
const INBOX_ON = /<button[^>]*aria-pressed="true"[^>]*>Inbox/;
const INBOX_OFF = /<button[^>]*aria-pressed="false"[^>]*>Inbox/;
const SUP_ON = /<button[^>]*aria-pressed="true"[^>]*>Supervision/;

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
    other.setQueryData(["flow", "v1"], flowFixture);
    other.setQueryData(["audit"], auditAnswer);
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=supervision",
    });
    const sup = renderApp(other);
    expect(sup).toContain("Cases in progress");
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

  test("14.2 row W9d: a pending flow query loads in the main area", () => {
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=supervision",
    });
    const client = newClient();
    seedShell(client);
    client.setQueryData(["supervision", "v1"], supAnswer);
    const html = renderApp(client);
    expect(html).toContain("Loading");
    expect(html).not.toContain("Cases in progress");
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

  test("fb-018 row F5: the inbox entry is pressed on the inbox", () => {
    vi.stubGlobal("location", { pathname: "/app", search: "?user=u-advisor" });
    const client = newClient();
    seedShell(client);
    const html = renderApp(client);
    expect(html).toMatch(INBOX_ON);
    expect(html).not.toContain('aria-current="page"');
  });

  test("fb-018 row F6: the inbox entry is not pressed on the supervision", () => {
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=supervision",
    });
    const client = newClient();
    seedShell(client);
    client.setQueryData(["supervision", "v1"], supAnswer);
    client.setQueryData(["flow", "v1"], flowFixture);
    const html = renderApp(client);
    expect(html).toMatch(INBOX_OFF);
    expect(html).toMatch(SUP_ON);
  });

  test("fb-018 row F7: the inbox entry is not pressed on the audit", () => {
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=audit",
    });
    const client = newClient();
    seedShell(client);
    client.setQueryData(["audit"], auditAnswer);
    const html = renderApp(client);
    expect(html).toMatch(INBOX_OFF);
  });
});

describe("view search", () => {
  test("fb-018 row F1: the inbox has no view parameter", () => {
    expect(viewSearch("u-advisor", "inbox")).toBe("?user=u-advisor");
  });

  test("fb-018 row F2: the supervision view", () => {
    expect(viewSearch("u-advisor", "supervision")).toBe(
      "?user=u-advisor&view=supervision",
    );
  });

  test("fb-018 row F3: the audit view", () => {
    expect(viewSearch("u-advisor", "audit")).toBe("?user=u-advisor&view=audit");
  });

  test("fb-018 row F4: no user yet gives an empty user", () => {
    expect(viewSearch("", "inbox")).toBe("?user=");
  });
});

// The fixtures of lot pol-2: two answers of two published versions.
// Node rows are open, late, median.
const mc1 = {
  case_id: "c1",
  reference: "CASE-2026-0001",
  node_id: "entry",
  assignee: "u-advisor",
  age_hours: 30,
  late: true,
  returned: false,
  data: {},
};
const mc2 = { ...mc1, case_id: "c2", reference: "CASE-2026-0002", assignee: "", age_hours: 10, late: false };
const mc3 = { ...mc1, case_id: "c3", reference: "CASE-2026-0003", age_hours: 5, late: false };

const answerA: Supervision = {
  version_id: "v1",
  total_open: 2,
  total_late: 1,
  nodes: [
    { node_id: "entry", open: 2, late: 1, median_hours: 10 },
    { node_id: "review", open: 0, late: 0, median_hours: 0 },
  ],
  people: [{ user_id: "u-advisor", open: 1, late: 1 }],
  cases: [mc1, mc2],
};

const answerB: Supervision = {
  version_id: "v2",
  total_open: 1,
  total_late: 0,
  nodes: [
    { node_id: "entry", open: 1, late: 0, median_hours: 5 },
    { node_id: "review", open: 0, late: 0, median_hours: 0 },
    { node_id: "released", open: 0, late: 0, median_hours: 0 },
  ],
  people: [{ user_id: "u-advisor", open: 1, late: 0 }],
  cases: [mc3],
};

const mergedAB: Supervision = {
  version_id: "v2",
  total_open: 3,
  total_late: 1,
  nodes: [
    { node_id: "entry", open: 3, late: 1, median_hours: 10 },
    { node_id: "review", open: 0, late: 0, median_hours: 0 },
    { node_id: "released", open: 0, late: 0, median_hours: 0 },
  ],
  people: [{ user_id: "u-advisor", open: 2, late: 1 }],
  cases: [mc1, mc2, mc3],
};

// stubFetchByUrl answers each URL with its own status and body, and
// records the call.
function stubFetchByUrl(answers: Record<string, [number, unknown]>) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const [status, body] = answers[url]!;
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  });
}

describe("supervision of every published version", () => {
  test("pol-2 row S1: one answer merges to itself", () => {
    expect(mergeSupervision([answerA])).toEqual(answerA);
  });

  test("pol-2 row S2: two answers add up, the median is the lower one", () => {
    expect(mergeSupervision([answerA, answerB])).toEqual(mergedAB);
  });

  test("pol-2 row S3: no answer gives an empty supervision", () => {
    expect(mergeSupervision([])).toEqual({
      version_id: "",
      total_open: 0,
      total_late: 0,
      nodes: [],
      people: [],
      cases: [],
    });
  });

  test("pol-2 row S4: fetchSupervisionAll reads each version and merges", async () => {
    stubFetchByUrl({
      "/api/versions/v1/supervision": [200, answerA],
      "/api/versions/v2/supervision": [200, answerB],
    });
    await expect(fetchSupervisionAll(["v1", "v2"])).resolves.toEqual(mergedAB);
    expect(seen.map((s) => s.url)).toEqual([
      "/api/versions/v1/supervision",
      "/api/versions/v2/supervision",
    ]);
  });

  test("pol-2 row S5: one failed read rejects with its ApiError", async () => {
    stubFetchByUrl({
      "/api/versions/v1/supervision": [200, answerA],
      "/api/versions/v2/supervision": [
        404,
        { error: { code: "not_found", message: "version not found" } },
      ],
    });
    const err = await fetchSupervisionAll(["v1", "v2"]).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("not_found");
  });

  test("pol-2 row S6: the shell counts the cases of both published versions", () => {
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&view=supervision",
    });
    const client = newClient();
    seedShell(client);
    client.setQueryData(["versions", "p1"], [
      versionRow(1, "published"),
      versionRow(2, "published"),
    ]);
    client.setQueryData(["version", "v2"], {
      ...versionRow(2, "published"),
      definition: defFixture,
    });
    client.setQueryData(["supervision", "v1,v2"], mergedAB);
    client.setQueryData(["flow", "v1,v2"], flowFixture);
    const html = renderApp(client);
    expect(html).toContain("Cases in progress");
    expect(html).toContain('class="text-2xl font-semibold">3</span>');
  });
});

// The flow answers of row F3, every value exact.
const flowA: Flow = {
  days: 30,
  closed: 2,
  ends: [
    { node_id: "released", cases: 1, avg_lead_hours: 30 },
    { node_id: "refused", cases: 1, avg_lead_hours: 20 },
  ],
  edges: [
    { edge_id: "e01", passes: 3 },
    { edge_id: "e04", passes: 1 },
  ],
  returns: 1,
  today: { people: 2, rules: 1 },
};

const flowB: Flow = {
  days: 30,
  closed: 3,
  ends: [
    { node_id: "released", cases: 3, avg_lead_hours: 10 },
    { node_id: "refused", cases: 0, avg_lead_hours: 0 },
  ],
  edges: [
    { edge_id: "e01", passes: 3 },
    { edge_id: "e04", passes: 0 },
  ],
  returns: 0,
  today: { people: 1, rules: 0 },
};

describe("flow api", () => {
  test("14.2 row F1: fetchFlow reads the flow of 30 days", async () => {
    stubFetch(200, flowFixture);
    await expect(fetchFlow("v1")).resolves.toEqual(flowFixture);
    expect(seen.map((s) => s.url)).toEqual(["/api/versions/v1/flow?days=30"]);
  });

  test("14.2 row F2: a bad days value rejects as ApiError", async () => {
    stubFetch(400, {
      error: { code: "invalid_query", message: "days must hold 1 to 90" },
    });
    const err = await fetchFlow("v1", 7).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("invalid_query");
    expect(seen[0]!.url.endsWith("?days=7")).toBe(true);
  });

  test("14.2 row F3: two answers add up, the lead time is weighted", () => {
    expect(mergeFlow([flowA, flowB])).toEqual({
      days: 30,
      closed: 5,
      ends: [
        { node_id: "released", cases: 4, avg_lead_hours: 15 },
        { node_id: "refused", cases: 1, avg_lead_hours: 20 },
      ],
      edges: [
        { edge_id: "e01", passes: 6 },
        { edge_id: "e04", passes: 1 },
      ],
      returns: 1,
      today: { people: 3, rules: 1 },
    });
  });

  test("14.2 row F4: no answer gives an empty flow, one answer merges to itself", () => {
    expect(mergeFlow([])).toEqual({
      days: 30,
      closed: 0,
      ends: [],
      edges: [],
      returns: 0,
      today: { people: 0, rules: 0 },
    });
    expect(mergeFlow([flowA])).toEqual(flowA);
  });

  test("14.2 row F5: one failed read rejects with its ApiError", async () => {
    stubFetchByUrl({
      "/api/versions/v1/flow?days=30": [200, flowFixture],
      "/api/versions/v2/flow?days=30": [
        404,
        { error: { code: "not_found", message: "version not found" } },
      ],
    });
    const err = await fetchFlowAll(["v1", "v2"]).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("not_found");
  });
});

describe("key figures and block card", () => {
  test("14.2 row T1: the 4 tiles of the fixtures", () => {
    expect(tileFigures(defFixture, supAnswer, flowFixture)).toEqual([
      { label: "Cases in progress", value: "2", unit: "", sub: "On 1 step, 1 not assigned", bad: false },
      { label: "Average lead time", value: "1.5", unit: "days", sub: "Approved cases, last 30 days", bad: false },
      { label: "Cases late", value: "2", unit: "", sub: "All at Application entry", bad: true },
      { label: "Return rate", value: "25", unit: "%", sub: "1 return on 4 closed cases", bad: false },
    ]);
  });

  test("14.2 row T2: no closed case gives no lead time and no rate", () => {
    const flow: Flow = {
      ...flowFixture,
      closed: 0,
      ends: flowFixture.ends.map((e) => ({ ...e, cases: 0 })),
    };
    const [, lead, , rate] = tileFigures(defFixture, supAnswer, flow);
    expect(lead).toEqual({
      label: "Average lead time", value: "-", unit: "", sub: "No approved case in 30 days", bad: false,
    });
    expect(rate).toEqual({
      label: "Return rate", value: "-", unit: "", sub: "No closed case in 30 days", bad: false,
    });
  });

  test("14.2 row T3: the late tile with no late case, then on 2 steps", () => {
    const none = tileFigures(defFixture, noLate, flowFixture)[2]!;
    expect(none.sub).toBe("None past the deadline");
    expect(none.bad).toBe(false);
    expect(tileFigures(defFixture, twoLate, flowFixture)[2]!.sub).toBe("On 2 steps");
  });

  test("14.2 row B1: the step with the most late cases", () => {
    expect(blockOf(defFixture, supAnswer, usersFixture)).toEqual({
      nodeId: "entry",
      name: "Application entry",
      text: "2 cases wait. 2 are late. 1 has no assignee. Demo Advisor holds 1 of them.",
    });
  });

  test("14.2 row B2: no late case gives null", () => {
    expect(blockOf(defFixture, noLate, usersFixture)).toBeNull();
  });

  test("14.2 row B3: one case, an unknown assignee stays raw", () => {
    const sup: Supervision = {
      ...supAnswer,
      total_open: 1,
      total_late: 1,
      nodes: [{ node_id: "entry", open: 1, late: 1, median_hours: 25 }],
      cases: [{ ...supCase, assignee: "u-ghost" }],
    };
    expect(blockOf(defFixture, sup, usersFixture)?.text).toBe(
      "1 case waits. 1 is late. u-ghost holds 1 of them.",
    );
  });

  test("14.2 row B4: a tie takes the first step of the definition", () => {
    expect(blockOf(defFixture, twoLate, usersFixture)?.nodeId).toBe("entry");
  });
});

// mk builds one case of the step panel rows from the base case.
function mk(over: Partial<SupCase>): SupCase {
  return { ...supCase, ...over };
}

// withCases gives the fixture answer with other entry cases.
function withCases(cases: SupCase[]): Supervision {
  return { ...supAnswer, cases };
}

describe("step panel", () => {
  test("14.3 row Y1: the why text of the fixture step", () => {
    expect(whyText(supAnswer.cases, usersFixture)).toBe(
      "2 cases are late: CASE-2026-0002 and CASE-2026-0001. Demo Advisor holds 1 of the 2 cases. 1 case has no assignee.",
    );
  });

  test("14.3 row Y2: no case", () => {
    expect(whyText([], usersFixture)).toBe("No case waits at this step.");
  });

  test("14.3 row Y3: one free returned case, not late", () => {
    expect(
      whyText([mk({ late: false, assignee: "", returned: true })], usersFixture),
    ).toBe(
      "No case is late. 1 case has no assignee. 1 case came back to this step.",
    );
  });

  test("14.3 row Y4: three late cases, two returned", () => {
    const cases = [
      mk({ case_id: "c3", reference: "CASE-2026-0003", age_hours: 10, returned: true }),
      mk({ case_id: "c4", reference: "CASE-2026-0004", age_hours: 30, returned: true }),
      mk({ case_id: "c5", reference: "CASE-2026-0005", age_hours: 20 }),
    ];
    expect(whyText(cases, usersFixture)).toBe(
      "3 cases are late: CASE-2026-0004, CASE-2026-0005 and CASE-2026-0003. Demo Advisor holds 3 of the 3 cases. 2 cases came back to this step.",
    );
  });

  test("14.3 row Y5: an unknown holder stays raw", () => {
    expect(whyText([mk({ assignee: "u-ghost" })], usersFixture)).toBe(
      "1 case is late: CASE-2026-0001. u-ghost holds the case.",
    );
  });

  test("14.3 row O1: the cases of a step, oldest first, tie by reference", () => {
    const sup = withCases([
      supCase,
      supCase2,
      mk({ case_id: "c3", reference: "CASE-2026-0000", age_hours: 26 }),
    ]);
    expect(stepCases(sup, "entry").map((c) => c.case_id)).toEqual(["c3", "c2", "c1"]);
    expect(stepCases(sup, "review")).toEqual([]);
  });

  test("14.3 row H1: the holder with the most cases, tie the first", () => {
    const of = (ids: string[]) => ids.map((assignee) => mk({ assignee }));
    expect(topHolder(of(["u-a", "u-b", "u-b", ""]))).toEqual({ userId: "u-b", count: 2 });
    expect(topHolder(of(["u-a", "u-b"]))).toEqual({ userId: "u-a", count: 1 });
    expect(topHolder(of([""]))).toBeNull();
  });

  test("14.3 row L1: the list text", () => {
    expect(listText(["A"])).toBe("A");
    expect(listText(["A", "B"])).toBe("A and B");
    expect(listText(["A", "B", "C"])).toBe("A, B and C");
  });

  test("14.3 row T1: the time left", () => {
    expect(leftText(mk({ age_hours: 25, late: true }), 24)).toBe("Late by 2 h");
    expect(leftText(mk({ age_hours: 24, late: true }), 24)).toBe("Late by 1 h");
    expect(leftText(mk({ age_hours: 10, late: false }), 24)).toBe("13 h left");
    expect(leftText(mk({ age_hours: 23, late: false }), 24)).toBe("0 h left");
    expect(leftText(mk({ age_hours: 24, late: false }), 24)).toBe("0 h left");
    expect(leftText(mk({ age_hours: 5 }), null)).toBe("No deadline");
  });

  test("14.3 row T2: the track width", () => {
    expect(trackWidth(36, 48)).toBe(50);
    expect(trackWidth(72, 48)).toBe(100);
    expect(trackWidth(100, 48)).toBe(100);
    expect(trackWidth(5, null)).toBe(0);
    expect(trackWidth(24, 24)).toBeCloseTo(66.67, 2);
  });

  test("14.3 row I1: the initials", () => {
    expect(initials("Demo Advisor")).toBe("DA");
    expect(initials("u-ghost")).toBe("U");
  });

  test("14.3 row P1: the panel of the selected step", () => {
    const html = renderSupervision(supAnswer, "entry");
    for (const text of [
      "Step detail",
      "Advisor · Branch",
      "Waiting",
      "Median age",
      ">25 h<",
      ">24 h<",
      "2 cases are late: CASE-2026-0002 and CASE-2026-0001. Demo Advisor holds 1 of the 2 cases. 1 case has no assignee.",
      "Computed from the case data. No AI writes this text.",
      "Cases at this step, oldest first",
      "Deadline 24 h",
      "Time left",
      "Hanta Rakotobe · €240,000.00",
      "Late by 3 h",
      "Late by 2 h",
      'title="Demo Advisor"',
      ">DA<",
      'title="No assignee"',
      'aria-label="Close the step detail"',
    ]) {
      expect(html).toContain(text);
    }
    expect(html.indexOf("CASE-2026-0002")).toBeLessThan(html.indexOf("CASE-2026-0001"));
    expect(html).not.toContain("Time on step");
    expect(html).not.toContain("Select a step to see its cases.");
  });

  test("14.3 row P2: a returned case shows its chip", () => {
    const html = renderSupervision(
      withCases([{ ...supCase, returned: true }, supCase2]),
      "entry",
    );
    expect(html).toContain("Returned");
  });

  test("14.3 row P3: no selection shows no panel, the block card links to it", () => {
    const html = renderSupervision(supAnswer);
    expect(html).not.toContain("Step detail");
    expect(html).toContain("Open the step");
  });

  test("14.3 row P4: a step with no case and no deadline", () => {
    const html = renderSupervision(supAnswer, "review");
    expect(html).toContain("No case waits at this step.");
    expect(html).toContain("None");
    expect(html).toContain("ghost");
    expect(html).not.toContain("Deadline 24 h");
  });

  test("14.3 row P5: a case at 60 percent of the deadline has the near tone", () => {
    const html = renderSupervision(
      withCases([{ ...supCase, age_hours: 15, late: false }, supCase2]),
      "entry",
    );
    const last = html.slice(html.lastIndexOf("CASE-2026-0001"));
    expect(last).toContain("bg-[#d97706]");
  });
});
