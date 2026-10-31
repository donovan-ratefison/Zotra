// The 21 test rows of the version actions brief, in order. The
// environment is node: renderToString, no jsdom, no query client and
// no provider (no tested component holds a query). The fetch stub
// records each call, the pattern of lot 2.3 (row 20 of
// panel.test.tsx): the api rows push { url, init }, and the rows that
// check the request read seen[0].

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, forkVersion, freezeVersion, publishVersion } from "./api";
import {
  FreezeDialogBody,
  HistoryBody,
  NewDraftDialogBody,
  PublishDialogBody,
  VersionActions,
  definitionFile,
  docLinks,
  labelValid,
  newestPublished,
  statusText,
} from "./version-actions";
import { TopBar } from "./StudioShell";
import { useStudioStore } from "./store";
import type {
  ProcessDefinition,
  VersionStatus,
  VersionSummary,
} from "./types";

const miniDefinition: ProcessDefinition = {
  schema_version: "1",
  name: "Mini loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
  roles: [{ id: "advisor", name: "Advisor", department: "Branch" }],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
  ],
  scope: [{ field: "amount", role: "advisor", access: "write" }],
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

// A full version row with exact values; status accepts any raw value,
// so the unknown-status row can use "archived".
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

// The answer of a new draft call: a draft with the parent set and
// its own label.
const newDraftAnswer: VersionSummary = {
  ...versionRow(2, "draft"),
  parent_id: "v1",
  label: "Variable rate",
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

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

describe("docLinks", () => {
  test("L1: the links and the file name of a version", () => {
    expect(docLinks(miniDefinition, versionRow(2, "draft"))).toEqual({
      html: "/api/versions/v2/doc.html",
      md: "/api/versions/v2/doc.md",
      mdName: "Mini loan-v2.md",
    });
  });

  test("L2: the name is trimmed", () => {
    const def = { ...miniDefinition, name: "  Home loan  " };
    expect(docLinks(def, versionRow(1, "draft")).mdName).toBe("Home loan-v1.md");
  });

  test("L3: each forbidden file name character becomes a dash", () => {
    const def = { ...miniDefinition, name: "A/B: test?" };
    expect(docLinks(def, versionRow(3, "draft")).mdName).toBe("A-B- test--v3.md");
  });

  test("L4: a blank name gives process", () => {
    const def = { ...miniDefinition, name: "   " };
    expect(docLinks(def, versionRow(1, "draft")).mdName).toBe("process-v1.md");
  });

  test("L5: the version id is encoded in the path", () => {
    const version = { ...versionRow(1, "draft"), id: "a b" };
    expect(docLinks(miniDefinition, version).html).toBe("/api/versions/a%20b/doc.html");
  });
});

describe("definitionFile and labelValid", () => {
  test("1: definitionFile names and serializes the export file", () => {
    const file = definitionFile(miniDefinition, versionRow(2, "draft"));
    expect(file.name).toBe("process-v2.json");
    expect(file.body).toBe(JSON.stringify(miniDefinition, null, 2));
  });

  test("2: labelValid refuses blank labels", () => {
    expect(labelValid("")).toBe(false);
    expect(labelValid("  ")).toBe(false);
    expect(labelValid(" Variable rate ")).toBe(true);
  });
});

describe("freezeVersion", () => {
  test("3: POSTs the freeze route with no body", async () => {
    stubFetch(200, { version: versionRow(2, "frozen") });
    const frozen = await freezeVersion("v2");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/versions/v2/freeze");
    expect(seen[0]!.init.method).toBe("POST");
    expect("body" in seen[0]!.init).toBe(false);
    expect(frozen.status).toBe("frozen");
  });

  test("4: a non-draft gives the 409 conflict", async () => {
    stubFetch(409, {
      error: {
        code: "conflict",
        message: "version v2 is not a draft",
        details: [],
      },
    });
    const error = await freezeVersion("v2").then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe("conflict");
    expect(apiError.message).toBe("version v2 is not a draft");
  });
});

describe("publishVersion", () => {
  test("5: POSTs the publish route with no body", async () => {
    stubFetch(200, { version: versionRow(2, "published") });
    const published = await publishVersion("v2");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/versions/v2/publish");
    expect(seen[0]!.init.method).toBe("POST");
    expect("body" in seen[0]!.init).toBe(false);
    expect(published.status).toBe("published");
  });

  test("6: a non-frozen version gives the 409 conflict", async () => {
    stubFetch(409, {
      error: {
        code: "conflict",
        message: "version v1 is not frozen",
        details: [],
      },
    });
    const error = await publishVersion("v1").then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("conflict");
    expect(apiError.message).toBe("version v1 is not frozen");
  });
});

describe("new draft call", () => {
  test("7: POSTs the new draft route with the label", async () => {
    stubFetch(201, { version: newDraftAnswer });
    const created = await forkVersion("v1", "Variable rate");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/versions/v1/fork");
    expect(seen[0]!.init.method).toBe("POST");
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      label: "Variable rate",
    });
    expect(created).toEqual(newDraftAnswer);
  });
});

describe("status buttons", () => {
  const actionsProps = (version: VersionSummary, versions: VersionSummary[]) => ({
    def: miniDefinition,
    version,
    versions,
    versionsPending: false,
    onVersionsChanged: () => {},
  });

  test("8: a draft shows Export and Freeze version", () => {
    const html = renderToString(
      createElement(VersionActions, actionsProps(versionRow(2, "draft"), [
        versionRow(1, "published"),
        versionRow(2, "draft"),
      ])),
    );
    expect(html).toContain("Export");
    expect(html).toContain("Documentation");
    expect(html).toContain("Freeze version");
    expect(html).not.toContain("New draft from this version");
    expect(html).not.toContain("Publish");
  });

  test("9: a frozen version shows Publish and the new draft action", () => {
    const html = renderToString(
      createElement(VersionActions, actionsProps(versionRow(2, "frozen"), [
        versionRow(1, "published"),
        versionRow(2, "frozen"),
      ])),
    );
    expect(html).toContain("Publish");
    expect(html).toContain("New draft from this version");
    expect(html).toContain("Export");
    expect(html).toContain("Documentation");
    expect(html).not.toContain("Freeze version");
  });

  test("10: a published version shows only Export and the new draft action", () => {
    const html = renderToString(
      createElement(VersionActions, actionsProps(versionRow(1, "published"), [
        versionRow(1, "published"),
      ])),
    );
    expect(html).toContain("New draft from this version");
    expect(html).toContain("Export");
    expect(html).toContain("Documentation");
    expect(html).not.toContain("Freeze version");
    expect(html).not.toContain("Publish");
  });

  test("11: an unknown status shows only Export", () => {
    const html = renderToString(
      createElement(VersionActions, actionsProps(versionRow(3, "archived"), [
        versionRow(1, "published"),
        versionRow(3, "archived"),
      ])),
    );
    expect(html).toContain("Export");
    expect(html).toContain("Documentation");
    expect(html).not.toContain("Freeze version");
    expect(html).not.toContain("Publish");
    expect(html).not.toContain("New draft from this version");
  });

  test("L7: the Documentation trigger comes before the Export button", () => {
    const html = renderToString(
      createElement(VersionActions, actionsProps(versionRow(2, "draft"), [
        versionRow(2, "draft"),
      ])),
    );
    expect(html.indexOf("Documentation")).toBeGreaterThan(-1);
    expect(html.indexOf("Documentation")).toBeLessThan(html.indexOf('aria-label="Export"'));
  });
});

describe("newest published version", () => {
  test("P1: an empty list has no published version", () => {
    expect(newestPublished([])).toBe(null);
  });

  test("P2: an unknown status is not published", () => {
    expect(
      newestPublished([versionRow(1, "draft"), versionRow(2, "frozen"), versionRow(3, "archived")]),
    ).toBe(null);
  });

  test("P3: the highest published number wins", () => {
    expect(
      newestPublished([
        versionRow(1, "published"),
        versionRow(2, "frozen"),
        versionRow(4, "published"),
        versionRow(5, "draft"),
      ]),
    ).toBe(4);
  });

  test("P4: the order of the list does not change the result", () => {
    expect(newestPublished([versionRow(4, "published"), versionRow(1, "published")])).toBe(4);
  });
});

describe("short new draft label", () => {
  const actionsProps = (version: VersionSummary) => ({
    def: miniDefinition,
    version,
    versions: [version],
    versionsPending: false,
    onVersionsChanged: () => {},
  });

  test("T1: a published version shows New draft, with the full name in the aria-label", () => {
    const html = renderToString(createElement(VersionActions, actionsProps(versionRow(1, "published"))));
    expect(html).toContain(">New draft<");
    expect(html).toContain('aria-label="New draft from this version"');
    expect(html).not.toContain(">New draft from this version<");
  });

  test("T2: a frozen version shows Publish and New draft", () => {
    const html = renderToString(createElement(VersionActions, actionsProps(versionRow(2, "frozen"))));
    expect(html).toContain(">Publish<");
    expect(html).toContain(">New draft<");
  });
});

describe("freeze dialog body", () => {
  test("12: the body shows the title, the two lines and the footer", () => {
    const html = renderToString(
      createElement(FreezeDialogBody, {
        version: versionRow(2, "draft"),
        busy: false,
        onCancel: () => {},
      }),
    );
    expect(html).toContain("Freeze the draft of v2");
    expect(html).toContain(
      "The draft becomes v2. It is not editable anymore.",
    );
    expect(html).toContain(
      "Your next changes need a new draft from this version.",
    );
    expect(html).toContain("Cancel");
    expect(html).toContain("Freeze v2");
    expect(html).not.toContain(' disabled=""');
    expect(html).not.toContain('aria-label="Label"');
  });

  test("13: a busy freeze disables the confirm button", () => {
    const html = renderToString(
      createElement(FreezeDialogBody, {
        version: versionRow(2, "draft"),
        busy: true,
        onCancel: () => {},
      }),
    );
    expect(html).toContain(' disabled=""');
  });
});

describe("publish dialog body", () => {
  const publishProps = (over: {
    publishedNumber?: number | null;
    versionsPending?: boolean;
  }) => ({
    version: versionRow(2, "frozen"),
    def: miniDefinition,
    publishedNumber: 1,
    versionsPending: false,
    busy: false,
    onCancel: () => {},
    ...over,
  });

  test("14: the body names the replaced version", () => {
    const html = renderToString(
      createElement(PublishDialogBody, publishProps({ publishedNumber: 1 })),
    );
    expect(html).toContain("Publish v2");
    expect(html).toContain("v2 replaces v1 for new cases.");
    expect(html).toContain("Cases in progress stay on their version.");
    expect(html).toContain("Cancel");
    expect(html).toContain("Publish v2");
  });

  test("15: no published version yet gives the first publish line", () => {
    const html = renderToString(
      createElement(PublishDialogBody, publishProps({ publishedNumber: null })),
    );
    expect(html).toContain("This is the first published version of Mini loan.");
    expect(html).not.toContain("replaces");
  });

  test("16: pending versions give the loading line", () => {
    const html = renderToString(
      createElement(PublishDialogBody, publishProps({ versionsPending: true })),
    );
    expect(html).toContain("Loading the versions.");
    expect(html).not.toContain("replaces");
    expect(html).not.toContain("first published version");
  });
});

describe("new draft dialog body", () => {
  const draftProps = (busy: boolean) => ({
    version: versionRow(1, "published"),
    busy,
    onCreate: () => {},
    onCancel: () => {},
  });

  test("17: the body holds the label field and a disabled confirm", () => {
    const html = renderToString(
      createElement(NewDraftDialogBody, draftProps(false)),
    );
    expect(html).toContain("New draft from v1");
    expect(html).toContain('aria-label="Label"');
    expect(html).toContain("Cancel");
    expect(html).toContain("Create draft");
    expect(html).toContain(' disabled=""');
  });

  test("18: a busy create disables the confirm button", () => {
    const html = renderToString(
      createElement(NewDraftDialogBody, draftProps(true)),
    );
    expect(html).toContain(' disabled=""');
  });
});

describe("top bar", () => {
  test("19, T3: the top bar shows the pill and the published actions", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(1, "published"),
        versions: [versionRow(1, "published")],
        versionsPending: false,
        onVersionsChanged: () => {},
      }),
    );
    expect(html).toContain("v1 · Published");
    expect(html).toContain("Export");
    expect(html).toContain("New draft from this version");
  });

  test("B1: the top bar shows the Zotra wordmark, not the old tile", () => {
    const html = renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: versionRow(1, "published"),
        versions: [versionRow(1, "published")],
        versionsPending: false,
        onVersionsChanged: () => {},
      }),
    );
    expect(html).toContain('src="/zotra-wordmark.svg"');
    expect(html).toContain('alt="Zotra"');
    expect(html).not.toContain('rx="6"');
  });

  // pol-20c: the breadcrumb names the bank, and a gear opens the bank settings.
  const b1Props = {
    def: miniDefinition,
    version: versionRow(1, "published"),
    versions: [versionRow(1, "published")],
    versionsPending: false,
    onVersionsChanged: () => {},
  };

  test("G1: the breadcrumb shows the bank name", () => {
    const html = renderToString(createElement(TopBar, { ...b1Props, brandName: "Banque Test" }));
    expect(html).toContain(">Banque Test</a>");
    expect(html).not.toContain(">Mini Bank</a>");
  });

  test("G2: with no bank name, the breadcrumb shows the process theme", () => {
    const html = renderToString(createElement(TopBar, b1Props));
    expect(html).toContain(">Mini Bank</a>");
  });

  test("G3: the top bar has the gear link to the bank settings", () => {
    const html = renderToString(createElement(TopBar, b1Props));
    expect(html).toContain('href="/settings"');
    expect(html).toContain('aria-label="Bank settings"');
    expect(html).toContain('title="Bank settings"');
  });

  test("F3: the top bar shows the unsaved badge while the draft is dirty", () => {
    const topBarProps = {
      def: miniDefinition,
      version: versionRow(1, "published"),
      versions: [versionRow(1, "published")],
      versionsPending: false,
      onVersionsChanged: () => {},
    };
    // The server snapshot of zustand 5 is getInitialState(), so the
    // dirty flag goes to the initial state and to the live state
    // (the pattern of setStudioStore in panel.test.tsx).
    Object.assign(useStudioStore.getInitialState(), { dirty: true });
    useStudioStore.setState({ dirty: true });
    const withBadge = renderToString(createElement(TopBar, topBarProps));
    Object.assign(useStudioStore.getInitialState(), { dirty: false });
    useStudioStore.setState({ dirty: false });
    const withoutBadge = renderToString(createElement(TopBar, topBarProps));
    const badge = withBadge.slice(withBadge.indexOf("text-amber-700"));
    expect(badge).toContain("Unsaved changes");
    expect(withoutBadge).not.toContain("Unsaved changes");
  });
});

describe("api errors", () => {
  test("20: an unknown version gives the 404 not_found", async () => {
    stubFetch(404, {
      error: {
        code: "not_found",
        message: "no version v9",
        details: [],
      },
    });
    const error = await freezeVersion("v9").then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.code).toBe("not_found");
    expect(apiError.message).toBe("no version v9");
  });

  test("21: a non-parsing error body gives code http and the status", async () => {
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Promise.resolve({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      });
    });
    const error = await publishVersion("v2").then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(500);
    expect(apiError.code).toBe("http");
    expect(apiError.message).toBe("HTTP 500");
  });
});

describe("one published version for new cases", () => {
  test("S1: a draft says Draft", () => {
    expect(statusText(versionRow(2, "draft"), 3)).toBe("Draft");
  });
  test("S2: a frozen version says Frozen", () => {
    expect(statusText(versionRow(2, "frozen"), 3)).toBe("Frozen");
  });
  test("S3: the newest published version says Published", () => {
    expect(statusText(versionRow(3, "published"), 3)).toBe("Published");
  });
  test("S4: an older published version says Replaced by v3", () => {
    expect(statusText(versionRow(1, "published"), 3)).toBe("Replaced by v3");
  });
  test("S5: no newest number keeps Published", () => {
    expect(statusText(versionRow(1, "published"), null)).toBe("Published");
  });

  const twoPublished = [versionRow(1, "published"), versionRow(3, "published")];
  const topBar = (shown: VersionSummary) =>
    renderToString(
      createElement(TopBar, {
        def: miniDefinition,
        version: shown,
        versions: twoPublished,
        versionsPending: false,
        onVersionsChanged: () => {},
      }),
    );

  test("T1: the top bar shows the replaced version with a gray dot", () => {
    const html = topBar(versionRow(1, "published"));
    expect(html).toContain("v1 · Replaced by v3");
    expect(html).toContain("v3 · Published");
    expect(html).toContain("#71717a");
    expect(html).not.toContain("v1 · Published");
  });
  test("T2: the top bar shows the newest published version with a green dot", () => {
    const html = topBar(versionRow(3, "published"));
    expect(html).toContain("v1 · Replaced by v3");
    expect(html).toContain("v3 · Published");
    expect(html).toContain("#16a34a");
  });

  const count = (html: string, text: string) => html.split(text).length - 1;
  const history = (versions: VersionSummary[]) =>
    renderToString(
      createElement(HistoryBody, {
        def: miniDefinition,
        version: versions[0],
        versions,
        onAction: () => {},
      }),
    );

  test("H1: the history has one Published badge and one replaced badge", () => {
    const html = history([versionRow(1, "published"), versionRow(2, "frozen"), versionRow(3, "published")]);
    expect(count(html, ">Replaced by v3<")).toBe(1);
    expect(count(html, ">Published<")).toBe(1);
    expect(count(html, "New cases start on this version.")).toBe(1);
    expect(count(html, "Shown")).toBe(1);
    expect(count(html, "New cases start on v3. Its cases in progress stay on v1.")).toBe(1);
  });
  test("H2: a history with no published version has no new-case line", () => {
    const html = history([versionRow(1, "draft"), versionRow(2, "frozen")]);
    expect(html).not.toContain("New cases start on this version.");
    expect(html).not.toContain("Replaced by");
  });
});
