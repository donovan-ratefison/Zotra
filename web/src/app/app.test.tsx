// The test rows of lot 6.2, in the order of the brief. The
// environment is node: renderToString, one local QueryClient with
// retry false, pre-seeded caches, and the recording fetch stub of
// lot 6.1 for the api rows. React SSR inserts comment markers
// between adjacent text nodes, so every string that a row must find
// whole renders from one template literal.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "../studio/api";
import { bankTheme } from "../studio/BankSettings";
import { fetchInbox } from "./app-api";
import { AppShell, brandVars, hslOf, pickProcess, processUrlOf } from "./AppShell";
import { CaseScreen } from "./CaseScreen";
import { dayTimeText, InboxScreen, moneyText, pickField } from "./InboxScreen";
import type { InboxCase, InboxUser } from "./app-api";
import type { CaseState, UserDTO } from "../studio/case-api";
import type {
  ProcessDefinition,
  VersionStatus,
  VersionSummary,
} from "../studio/types";

// The base fixture is the miniDefinition of lot 2.2, with the changes
// of the brief: the seed theme, the name, the client_name and kind
// fields after amount, and their scope rows. The first string field
// is client_name, the first money field stays amount.
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
  data: { amount: 240000, client_name: "Hanta Rakotobe" },
  assignee: "",
  seq: 2,
  prev_hash: "x",
};

const takenState: CaseState = { ...stateFixture, assignee: "u-advisor" };
const otherTakenState: CaseState = { ...stateFixture, assignee: "u-backoffice" };
const closedState: CaseState = {
  ...stateFixture,
  status: "closed",
  result: "approved",
};

const inboxUser: InboxUser = {
  id: "u-advisor",
  name: "Demo Advisor",
  role_ids: ["advisor"],
};

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

// The row 13 variant: the same def with a logo set.
const versionSeedWithLogo = {
  ...versionRow(1, "published"),
  definition: {
    ...defFixture,
    theme: { ...defFixture.theme, logo_url: "/logo.png" },
  },
};

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

// seedShell fills the three stage caches, the users and the inbox,
// the row 12 set. Rows 21 and 22 unseed parts of it.
function seedShell(client: QueryClient) {
  client.setQueryData(["processes"], processesSeed);
  client.setQueryData(["versions", "p1"], [versionRow(1, "published")]);
  client.setQueryData(["version", "v1"], versionSeed);
  client.setQueryData(["users"], usersFixture);
  client.setQueryData(["inbox", "u-advisor"], { user: inboxUser, cases: [inboxCase] });
}

function renderInbox(
  cases: InboxCase[],
  state?: CaseState,
  enteredAt = "2026-10-27T12:05:00Z",
  def: ProcessDefinition = defFixture,
): string {
  const client = newClient();
  if (state !== undefined) {
    client.setQueryData(["case", "c1"], { case: caseFixture, state });
    client.setQueryData(["events", "c1"], [
      {
        case_id: "c1", seq: 1, type: "step_entered", at: enteredAt,
        actor: "system", payload: { node_id: "entry" }, prev_hash: "", hash: "",
      },
    ]);
  }
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(InboxScreen, {
        def,
        userId: "u-advisor",
        users: usersFixture,
        now: Date.parse("2026-10-28T02:00:00Z"),
        cases,
        roleNames: "Advisor",
        onOpenCase: () => {},
      }),
    ),
  );
}

// renderCase renders CaseScreen with the four caches seeded. With
// withCase false the helper skips the case seed, so the case query
// pends (row 23).
function renderCase(
  state: CaseState,
  options?: { withCase?: boolean; backLabel?: string; def?: ProcessDefinition },
): string {
  const client = newClient();
  if (options?.withCase !== false) {
    client.setQueryData(["case", "c1"], { case: caseFixture, state });
  }
  client.setQueryData(["version", "v1"], { ...versionSeed, definition: options?.def ?? defFixture });
  client.setQueryData(["events", "c1"], []);
  client.setQueryData(["documents", "c1"], []);
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(CaseScreen, {
        userId: "u-advisor",
        caseId: "c1",
        users: usersFixture,
        onBack: () => {},
        ...(options?.backLabel !== undefined && { backLabel: options.backLabel }),
      }),
    ),
  );
}

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

describe("format helpers", () => {
  test("6.2 row 1: hslOf gives the shadcn tuple", () => {
    expect(hslOf("#0f4c45")).toBe("173 67% 18%");
    expect(hslOf("#1d4ed8")).toBe("224 76% 48%");
  });

  test("6.2 row 2: brandVars maps the tokens, light colors flip the foreground", () => {
    expect(brandVars(defFixture.theme)).toEqual({
      "--primary": "hsl(173 67% 18%)",
      "--primary-foreground": "hsl(0 0% 98%)",
    });
    expect(
      brandVars({ brand_name: "Banque Ravina", primary_color: "#86efac", logo_url: null }),
    ).toEqual({
      "--primary": "hsl(142 77% 73%)",
      "--primary-foreground": "hsl(240 5.9% 10%)",
    });
  });

  test("6.2 row 3: moneyText formats numbers and refuses the rest", () => {
    // fb-030 rows C1 to C4.
    expect(moneyText(240000, "EUR")).toBe("€240,000.00");
    expect(moneyText(27500, "EUR")).toBe("€27,500.00");
    expect(moneyText(240000, "USD")).toBe("US$240,000.00");
    expect(moneyText(27500.5, "MGA")).toBe("MGA\u00a027,501");
    expect(moneyText(null, "USD")).toBe("-");
    expect(moneyText("x", "MGA")).toBe("-");
  });

  test("fb-030 row C5: the inbox uses the currency of the process", () => {
    const html = renderInbox([inboxCase], stateFixture, undefined, { ...defFixture, currency: "USD" });
    expect(html).toContain("US$240,000.00");
    expect(html).not.toContain("€240,000.00");
  });

  test("fb-030 row C6: the case screen uses the currency of its version", () => {
    const html = renderCase(stateFixture, { def: { ...defFixture, currency: "MGA" } });
    expect(html).toContain("MGA\u00a0240,000");
  });

  test("6.2 row 4: pickField gives the first field of a type, else null", () => {
    expect(pickField(defFixture, "string")?.name).toBe("client_name");
    expect(pickField(defFixture, "money")?.name).toBe("amount");
    expect(pickField(defFixture, "date")).toBeNull();
  });
});

describe("process of the URL", () => {
  const p1 = { id: "p1", name: "One", created_at: "2026-10-01T00:00:00Z" };
  const p2 = { id: "p2", name: "Two", created_at: "2026-10-02T00:00:00Z" };

  test("fix-monitor row M1: processUrlOf reads the process value", () => {
    expect(processUrlOf("?view=supervision&process=p2")).toBe("p2");
  });

  test("fix-monitor row M2: processUrlOf with no value gives null", () => {
    expect(processUrlOf("?view=supervision")).toBeNull();
  });

  test("fix-monitor row M3: pickProcess takes the wanted process", () => {
    expect(pickProcess([p1, p2], "p2")).toBe(p2);
  });

  test("fix-monitor row M4: an archived wanted process falls back to the earliest", () => {
    const archived = { ...p2, archived_at: "2026-10-03T00:00:00Z" };
    expect(pickProcess([p1, archived], "p2")).toBe(p1);
  });

  test("fix-monitor row M5: an unknown wanted process falls back to the earliest", () => {
    expect(pickProcess([p1], "nope")).toBe(p1);
  });
});

describe("app api", () => {
  test("6.2 row 5: fetchInbox reads the inbox with the user header", async () => {
    stubFetch(200, { user: inboxUser, cases: [inboxCase] });
    await expect(fetchInbox("u-advisor")).resolves.toEqual({
      user: inboxUser,
      cases: [inboxCase],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/inbox");
    expect((seen[0]!.init.headers as Record<string, string>)["X-Zotra-User"]).toBe(
      "u-advisor",
    );
  });

  test("6.2 row 6: an inbox refusal rejects as ApiError with the body message", async () => {
    stubFetch(403, {
      error: { code: "forbidden", message: "unknown user u-advisor", details: [] },
    });
    const err = await fetchInbox("u-advisor").then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("forbidden");
    expect(err.message).toBe("unknown user u-advisor");
  });

  test("6.2 row 7: a body that does not parse gives code http", async () => {
    stubFetch(500, "oops");
    const err = await fetchInbox("u-advisor").then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("http");
    expect(err.message).toBe("HTTP 500");
  });
});

describe("inbox screen", () => {
  test("6.2 row 8: the inbox row shows the case columns and the take action", () => {
    const html = renderInbox([inboxCase], stateFixture);
    expect(html).toContain("Inbox");
    expect(html).toContain('aria-label="About the inbox"');
    expect(html).not.toContain("The first taker owns the case.");
    expect(html).not.toContain("Open a case to work on its step.");
    expect(html).toContain("CASE-2026-0001");
    expect(html).toContain("Hanta Rakotobe");
    expect(html).toContain("€240,000.00");
    expect(html).toContain("Application entry");
    expect(html).toContain("Take the case");
    expect(html).toContain("28 Oct, 12:05");
    expect(html).toContain("10 h left");
    expect(html).toContain("New");
    expect(html).toContain("Not taken");
    expect(html.match(/>Not taken</g)).toHaveLength(2);
    expect(html).not.toContain("27/10/2026");
  });

  test("pol-3 rows D1 to D3: dayTimeText gives the short UTC date", () => {
    expect(dayTimeText("2026-10-27T12:00:00Z", false)).toBe("27 Oct, 12:00");
    expect(dayTimeText("2026-10-27T12:00:01Z", true)).toBe("27 Oct, 12:00:01");
    expect(dayTimeText("2026-01-05T00:04:09Z", true)).toBe("5 Jan, 00:04:09");
  });

  test("6.2 row 9: an empty inbox says so", () => {
    const html = renderInbox([]);
    expect(html).toContain("No case waits for your roles.");
  });

  test("6.2 row 10: a taken case offers Open instead of Take the case", () => {
    const html = renderInbox([inboxCase], takenState);
    expect(html).toContain("Open");
    expect(html).not.toContain("Take the case");
  });

  test("6.2 row 11: a pending case query gives the dash cells", () => {
    const html = renderInbox([inboxCase]);
    expect(html).toContain("CASE-2026-0001");
    expect(html).toContain("Application entry");
    expect(html).toContain("-</td>");
    expect(html).not.toContain("Take the case");
  });

  test("pol-16 row N2: a case taken by another user shows the initials and the name", () => {
    const html = renderInbox([inboxCase], otherTakenState);
    expect(html).toContain("DB");
    expect(html).toContain("Demo Back-office");
    // The only "Not taken" is the tab.
    expect(html.match(/>Not taken</g)).toHaveLength(1);
  });

  test("pol-16 row N3: a pending case gives dashes and the tab bar", () => {
    const html = renderInbox([inboxCase]);
    expect(html).toContain("-</td>");
    expect(html).toContain(">All<");
    expect(html.match(/>Not taken</g)).toHaveLength(1);
    expect(html).not.toContain("h left");
  });

  test("pol-16 row N4: a case past its deadline shows the late pill and the due date", () => {
    const html = renderInbox([inboxCase], stateFixture, "2026-10-26T12:00:00Z");
    expect(html).toContain("Late by 14 h");
    expect(html).toContain("27 Oct, 12:00");
  });

  test("pol-16 row N5: All is pressed and the search has its label and hint", () => {
    const html = renderInbox([inboxCase], stateFixture);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>All</);
    expect(html).toContain('aria-label="Search by case number or client"');
    expect(html).toContain('title="Case number or client"');
  });
});

describe("app shell", () => {
  test("6.2 row 12: the frame shows the brand, the nav, the process and the inbox row", () => {
    const client = newClient();
    seedShell(client);
    const html = renderApp(client);
    expect(html).toContain("Banque Ravina");
    expect(html).toContain("Credits");
    expect(html).toContain("Inbox");
    expect(html).toContain("Supervision");
    expect(html).toContain("Audit log");
    expect(html).toContain("Home loan v1");
    expect(html).toContain("Demo Advisor");
    expect(html).toContain("Demo profile");
    expect(html).toContain("Powered by Zotra");
    expect(html).toContain("CASE-2026-0001");
  });

  test("13.2b row V3: the sidebar has the Triage item with key T", () => {
    const client = newClient();
    seedShell(client);
    const html = renderApp(client);
    expect(html).toContain("Triage");
    expect(html).toContain('aria-keyshortcuts="T"');
  });

  test("6.2 row 13: a logo renders an img and no letter square", () => {
    const client = newClient();
    seedShell(client);
    client.setQueryData(["version", "v1"], versionSeedWithLogo);
    const html = renderApp(client);
    expect(html).toContain('src="/logo.png"');
    expect(html).not.toContain("background-color");
  });

  test("6.2 row 14: no published version shows the empty line and nothing else", () => {
    const client = newClient();
    client.setQueryData(["processes"], processesSeed);
    client.setQueryData(["versions", "p1"], [versionRow(1, "draft")]);
    const html = renderApp(client);
    expect(html).toContain("No published version yet.");
    expect(html).not.toContain("Demo profile");
  });

  test("6.2 row 21: a pending users query keeps the sidebar and loads the main area", () => {
    const client = newClient();
    client.setQueryData(["processes"], processesSeed);
    client.setQueryData(["versions", "p1"], [versionRow(1, "published")]);
    client.setQueryData(["version", "v1"], versionSeed);
    const html = renderApp(client);
    expect(html).toContain("Loading");
    expect(html).toContain('src="/zotra-loader-light.svg"');
    expect(html).toContain("Banque Ravina");
    expect(html).toContain("Inbox");
    expect(html).toContain("Home loan v1");
    expect(html).toContain("Powered by Zotra");
    expect(html).not.toContain("min-w-5");
    expect(html).not.toContain("Demo profile");
  });

  test("6.2 row 22: a pending inbox query keeps the user card without the badge", () => {
    const client = newClient();
    client.setQueryData(["processes"], processesSeed);
    client.setQueryData(["versions", "p1"], [versionRow(1, "published")]);
    client.setQueryData(["version", "v1"], versionSeed);
    client.setQueryData(["users"], usersFixture);
    const html = renderApp(client);
    expect(html).toContain("Loading");
    expect(html).toContain("Demo Advisor");
    expect(html).toContain("Demo profile");
    expect(html).not.toContain("min-w-5");
  });

  test("6.2 row 20: the case parameter renders the case screen, not the inbox", () => {
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&case=c1",
    });
    const client = newClient();
    seedShell(client);
    client.setQueryData(["case", "c1"], { case: caseFixture, state: stateFixture });
    client.setQueryData(["events", "c1"], []);
    client.setQueryData(["documents", "c1"], []);
    const html = renderApp(client);
    expect(html).toContain("CASE-2026-0001 · Home loan v1");
    expect(html).toContain("Take the step");
    expect(html).not.toContain("<tr");
  });

  test("fb-018 row F8: with a case open, the inbox entry is pressed", () => {
    // The sidebar entry, in the prop order of React: type, aria-pressed.
    const INBOX_ON = /<button[^>]*aria-pressed="true"[^>]*>Inbox/;
    vi.stubGlobal("location", {
      pathname: "/app",
      search: "?user=u-advisor&case=c1",
    });
    const client = newClient();
    seedShell(client);
    client.setQueryData(["case", "c1"], { case: caseFixture, state: stateFixture });
    client.setQueryData(["events", "c1"], []);
    client.setQueryData(["documents", "c1"], []);
    const html = renderApp(client);
    expect(html).toMatch(INBOX_ON);
  });

  // pol-20c: the sidebar header and the app colors read the bank profile.
  const bankTest = {
    name: "Banque Test",
    primary_color: "#7c3aed",
    accent_color: "#ffcc00",
    logo_url: null,
    updated_at: "2026-10-31T16:00:00Z",
  };

  test("pol-20c row K1: the bank profile names and colors the app", () => {
    const client = newClient();
    seedShell(client);
    client.setQueryData(["bank"], bankTest);
    const html = renderApp(client);
    expect(html).toContain("Banque Test");
    expect(html).not.toContain("Banque Ravina");
    expect(html).toContain(`--primary:${brandVars(bankTheme(bankTest))["--primary"]}`);
    expect(html).toContain("border-top-color:#ffcc00");
    expect(html).toMatch(/style="background-color:#7c3aed">B</);
  });

  test("pol-20c row K2: the bank logo replaces the letter tile", () => {
    const client = newClient();
    seedShell(client);
    client.setQueryData(["bank"], { ...bankTest, logo_url: "/api/settings/bank/logo?v=1" });
    const html = renderApp(client);
    expect(html).toContain('src="/api/settings/bank/logo?v=1"');
    expect(html).toContain('alt="Banque Test"');
    expect(html).not.toMatch(/style="background-color:#7c3aed">B</);
  });

  test("pol-20c row K3: while the bank profile loads, the app keeps the process theme", () => {
    const client = newClient();
    seedShell(client);
    const html = renderApp(client);
    expect(html).toContain("Banque Ravina");
    expect(html).toContain("border-top-color:transparent");
  });
});

describe("case screen", () => {
  test("13.3b row A1: the back button shows the back label", () => {
    expect(renderCase(stateFixture)).toMatch(/<\/svg>Inbox<\/button>/);
    const html = renderCase(stateFixture, { backLabel: "Triage" });
    expect(html).toMatch(/<\/svg>Triage<\/button>/);
    expect(html).not.toMatch(/<\/svg>Inbox<\/button>/);
  });

  test("6.2 row 15: an untaken case shows the acting-as line and the take branch", () => {
    const html = renderCase(stateFixture);
    expect(html).toContain("Inbox");
    expect(html).toContain("CASE-2026-0001 · Home loan v1");
    expect(html).toContain("Hanta Rakotobe");
    expect(html).toContain("Amount");
    expect(html).toContain("€240,000.00");
    expect(html).toContain("Application entry");
    expect(html).toContain("Acting as Demo Advisor");
    expect(html).toContain("Take the step");
    expect(html).toContain("Created 27 Oct, 12:00");
    expect(html).not.toContain("Act as");
    expect(html).not.toContain("Documents");
  });

  test("6.2 row 16: another assignee blocks the commands", () => {
    const html = renderCase(otherTakenState);
    expect(html).toContain("Taken by Demo Back-office.");
    expect(html).not.toContain("Take the step");
    expect(html).not.toContain("Submit");
  });

  test("6.2 row 17: a closed case shows the result", () => {
    const html = renderCase(closedState);
    expect(html).toContain("Case closed");
    expect(html).toContain("Result: approved.");
  });

  test("6.2 row 23: a pending case query shows the loading line", () => {
    const html = renderCase(stateFixture, { withCase: false });
    expect(html).toContain("Loading the case.");
    expect(html.indexOf("Loading the case.")).toBeGreaterThan(html.indexOf('src="/zotra-loader-light.svg"'));
    expect(html).toContain('src="/zotra-loader-light.svg"');
  });
});
