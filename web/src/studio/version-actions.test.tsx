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
  NewDraftDialogBody,
  PublishDialogBody,
  VersionActions,
  definitionFile,
  labelValid,
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
    expect(html).not.toContain("Freeze version");
    expect(html).not.toContain("Publish");
    expect(html).not.toContain("New draft from this version");
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
  test("19: the top bar shows the pill and the published actions", () => {
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
