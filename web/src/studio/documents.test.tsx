// The test rows of lot 5.2, in the order of the brief. The
// environment is node: renderToString for the components, no jsdom
// (the patterns of the approved lots). A query resolves only through
// a pre-seeded cache: the render rows seed the caches they need. The
// local stubFetch records the request as given and parses nothing:
// the rows that assert a JSON body parse it in the row, and the
// upload row reads the FormData field.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { ApiError } from "./api";
import { runCommand, type CaseEvent, type CaseState, type UserDTO } from "./case-api";
import {
  listCaseDocuments,
  readZones,
  uploadDocument,
  type DocumentDTO,
  type ZoneDTO,
} from "./doc-api";
import { FieldInput } from "./field-inputs";
import { ScanDialogBody, ZoneOverlay, zoneStyle } from "./ScanDialog";
import { documentProvides, StepDocuments } from "./StepDocuments";
import { StepScreen } from "./StepScreen";
import { TestScreen } from "./TestScreen";
import { useStudioStore, type StudioMode } from "./store";
import type { ProcessDefinition, ProcessNode, VersionSummary } from "./types";

// The base fixture is the lot 3.1 test fixture, with the changes of
// the brief: two required documents on entry, one signoff task with
// a signature after analysis, and the edges e7, e9 and e10. Every
// node stays reachable and reaches an end.
const docsDefinition: ProcessDefinition = {
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
      deadline_hours: 24, documents: ["ID card", "Salary slips"], signature: false,
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
    { id: "signoff", type: "task", name: "Sign off", role: "analyst",
      deadline_hours: null, documents: [], signature: true, checks: [],
      decisions: ["approve", "refuse"], end_result: null,
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
    { id: "e7", from: "analysis", to: "signoff", label: null, decision: "favorable", condition: null, is_default: false },
    { id: "e8", from: "analysis", to: "refused", label: null, decision: "unfavorable", condition: null, is_default: false },
    { id: "e9", from: "signoff", to: "complete", label: null, decision: "approve", condition: null, is_default: false },
    { id: "e10", from: "signoff", to: "refused", label: null, decision: "refuse", condition: null, is_default: false },
  ],
  sources: [],
};

const entryNode = docsDefinition.nodes.find((n) => n.id === "entry")!;
const signoffNode = docsDefinition.nodes.find((n) => n.id === "signoff")!;
const docsField = docsDefinition.fields.find((f) => f.name === "docs")!;

// scan builds one scan of the case, with the overrides of the row.
function scan(over: Partial<DocumentDTO> = {}): DocumentDTO {
  return {
    id: "d1",
    case_id: "c1",
    name: "ID card.png",
    mime: "image/png",
    sha256: "a".repeat(64),
    created_at: "2026-10-27T12:00:00Z",
    ...over,
  };
}

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

const takenState: CaseState = { ...stateFixture, assignee: "u-advisor", seq: 3 };
const signoffState: CaseState = {
  ...stateFixture,
  node_id: "signoff",
  assignee: "u-analyst",
  data: {},
  seq: 6,
};

const signatureEvent: CaseEvent = {
  case_id: "c1",
  seq: 5,
  type: "signature_added",
  at: "2026-10-27T12:00:03Z",
  actor: "u-analyst",
  payload: { node_id: "signoff", user_id: "u-analyst", document_hash: "a".repeat(64) },
  prev_hash: "x",
  hash: "y",
};

const signatureZones: ZoneDTO[] = [
  { label: "signature", box: { x: 25, y: 10, width: 50, height: 20 } },
];
const stampZones: ZoneDTO[] = [
  { label: "stamp", box: { x: 1, y: 2, width: 3, height: 4 } },
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

// stubFetch records every call with the body as given (a FormData
// body must survive) and answers the stub.
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
      init?: { method?: string; headers?: Record<string, string>; body?: unknown },
    ) => {
      calls.push({
        path,
        method: init?.method,
        headers: init?.headers,
        body: init?.body ?? null,
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

// renderDocs renders StepDocuments with one render prop per rule.
function renderDocs(props?: {
  node?: ProcessNode;
  documents?: DocumentDTO[] | null;
  documentsError?: string | null;
  uploading?: boolean;
  readOnly?: boolean;
  signed?: boolean;
}): string {
  return renderToString(
    createElement(StepDocuments, {
      node: props?.node ?? entryNode,
      documents: props?.documents ?? [scan()],
      documentsError: props?.documentsError ?? null,
      uploading: props?.uploading ?? false,
      onUpload: () => {},
      onCommand: () => {},
      signed: props?.signed ?? false,
      readOnly: props?.readOnly ?? false,
    }),
  );
}

// renderStep renders StepScreen on the docs fixture. The one scan of
// the default provides the first required name of entry.
function renderStep(state: CaseState, props?: {
  documents?: DocumentDTO[] | null;
  events?: CaseEvent[];
  decisionEnabled?: boolean;
  actor?: string;
}): string {
  return renderToString(
    createElement(StepScreen, {
      def: docsDefinition,
      state,
      users: usersFixture,
      actor: props?.actor ?? "u-advisor",
      onActorChange: () => {},
      onCommand: () => {},
      failedChecks: [],
      decisionEnabled: props?.decisionEnabled ?? false,
      onValueChange: () => {},
      documents:
        props && props.documents !== undefined ? props.documents : [scan()],
      documentsError: null,
      events: props?.events ?? [],
      uploading: false,
      onUpload: () => {},
    }),
  );
}

// renderBody renders ScanDialogBody with the zones cache pre-seeded,
// or left pending when zones is null.
function renderBody(mode: "view" | "sign", zones: ZoneDTO[] | null): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (zones !== null) {
    client.setQueryData(["zones", "d1"], zones);
  }
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ScanDialogBody, { doc: scan(), mode, onSign: () => {} }),
    ),
  );
}

// renderTestScreen renders TestScreen on the docs fixture, with the
// caches pre-seeded: the users, the case on the given state, no
// events, and the one scan.
function renderTestScreen(state: CaseState): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["users"], usersFixture);
  client.setQueryData(["case", "c1"], { case: caseFixture, state });
  client.setQueryData(["events", "c1"], []);
  client.setQueryData(["documents", "c1"], [scan()]);
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
        createElement(TestScreen, { def: docsDefinition, version: versionFixture }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setStudioStore({
    selectedNodeId: null,
    tab: "general",
    mode: "design",
    testCaseId: null,
  });
});

describe("zone helpers", () => {
  test("5.2 row 1: zoneStyle gives the percents of the box", () => {
    expect(zoneStyle(signatureZones[0]!, { width: 200, height: 100 })).toEqual({
      left: "12.5%",
      top: "10%",
      width: "25%",
      height: "20%",
    });
  });

  test("5.2 row 2: no size, no zone box", () => {
    const html = renderToString(
      createElement(ZoneOverlay, { zones: signatureZones, size: null }),
    );
    expect(html).toBe("");
  });

  test("5.2 row 3: one zone box holds its style and its label", () => {
    const html = renderToString(
      createElement(ZoneOverlay, {
        zones: signatureZones,
        size: { width: 200, height: 100 },
      }),
    );
    expect(html).toContain("left:12.5%");
    expect(html).toContain(">signature</span>");
  });
});

describe("name rule", () => {
  test("5.2 row 4: an exact name or a prefix provides, nothing else", () => {
    expect(documentProvides("ID card.png", "ID card")).toBe(true);
    expect(documentProvides("ID card", "ID card")).toBe(true);
    expect(documentProvides("ID cardx.png", "ID card")).toBe(false);
    expect(documentProvides("ID", "ID card")).toBe(false);
  });
});

describe("document api", () => {
  test("5.2 row 5: listCaseDocuments unwraps the documents envelope", async () => {
    const calls = stubFetch(200, { documents: [scan()] });
    const docs = await listCaseDocuments("c1");
    expect(docs).toHaveLength(1);
    expect(docs[0]!.name).toBe("ID card.png");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/cases/c1/documents");
    expect(calls[0]!.method).toBeUndefined();
  });

  test("5.2 row 6: uploadDocument sends the file under its name", async () => {
    const calls = stubFetch(201, { document: scan() });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const doc = await uploadDocument(
      "c1",
      new File([bytes], "ID card.png", { type: "image/png" }),
    );
    expect(doc.name).toBe("ID card.png");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/cases/c1/documents");
    expect(calls[0]!.method).toBe("POST");
    const file = (calls[0]!.body as FormData).get("file") as File;
    expect(file.name).toBe("ID card.png");
  });

  test("5.2 row 7: a refused upload rejects as ApiError", async () => {
    stubFetch(400, {
      error: {
        code: "invalid_upload",
        message: "only PNG and JPEG scans are accepted",
        details: [],
      },
    });
    const error = await uploadDocument(
      "c1",
      new File([new Uint8Array([1])], "note.txt"),
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe("invalid_upload");
    expect(apiError.message).toBe("only PNG and JPEG scans are accepted");
  });

  test("5.2 row 8: readZones unwraps the zones envelope", async () => {
    const calls = stubFetch(200, { zones: signatureZones });
    const zones = await readZones("d1");
    expect(zones).toEqual(signatureZones);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/documents/d1/zones");
    expect(calls[0]!.method).toBe("POST");
  });

  test("5.2 row 9: a sign command carries the user and the five fields", async () => {
    const calls = stubFetch(200, { events: [], state: signoffState });
    await runCommand("c1", "u-analyst", {
      type: "sign",
      document_hash: "a".repeat(64),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers?.["X-Zotra-User"]).toBe("u-analyst");
    expect(JSON.parse(calls[0]!.body as string)).toEqual({
      type: "sign",
      data: {},
      values: {},
      decision: "",
      document_hash: "a".repeat(64),
    });
  });
});

describe("document field input", () => {
  test("5.2 row 10: one checkbox row per scan, checked from the value", () => {
    const html = renderToString(
      createElement(FieldInput, {
        field: docsField,
        value: ["d1"],
        onChange: () => {},
        disabled: false,
        scans: [{ id: "d1", name: "ID card.png" }],
      }),
    );
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="ID card.png"');
    const variant = renderToString(
      createElement(FieldInput, {
        field: docsField,
        value: null,
        onChange: () => {},
        disabled: false,
        scans: [{ id: "d1", name: "ID card.png" }],
      }),
    );
    expect(variant).toContain('aria-checked="false"');
  });

  test("5.2 row 11: no scans gives the empty line and no checkbox", () => {
    const html = renderToString(
      createElement(FieldInput, {
        field: docsField,
        value: null,
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(html).toContain("No scans yet.");
    expect(html).not.toContain('role="checkbox"');
  });
});

describe("documents card", () => {
  test("5.2 row 12: the card counts, lists the required rows and the scans", () => {
    const html = renderDocs();
    expect(html).toContain("Documents");
    expect(html).toContain("1 of 2 required");
    expect(html).toContain("ID card");
    expect(html).toContain("Attached");
    expect(html).toContain("Salary slips");
    expect(html).toContain("Required document missing");
    expect(html).toContain(">Attach<");
    expect(html).toContain("Drop a scan here or click to choose one.");
    expect(html).toContain("PNG or JPG, 10 MiB at most.");
    expect(html).toContain("ID card.png");
    expect(html).toContain("image/png · 27/10/2026, 12:00:00");
    expect(html).toContain(">View<");
  });

  test("5.2 row 13: all names provided closes the attach paths", () => {
    const html = renderDocs({
      documents: [scan(), scan({ id: "d2", name: "Salary slips.pdf", mime: "image/jpeg" })],
    });
    expect(html).toContain("2 of 2 required");
    expect(html).not.toContain("Required document missing");
    expect(html).not.toContain(">Attach<");
    expect(html).not.toContain("Drop a scan here");
  });

  test("5.2 row 14: the signature block offers the select and the sign button", () => {
    const html = renderDocs({ node: signoffNode, signed: false });
    expect(html).toContain("Signature");
    expect(html).toContain("Document to sign");
    expect(html).toContain(">Sign<");
    const variant = renderDocs({ node: signoffNode, signed: true });
    expect(variant).toContain("Signed.");
    expect(variant).toContain("ID card.png");
    expect(variant).not.toContain("Document to sign");
  });

  test("5.2 row 15: no scan and no signature line to sign", () => {
    const html = renderDocs({ node: signoffNode, documents: [] });
    expect(html).toContain("No scans yet.");
    expect(html).not.toContain(">Sign<");
  });

  test("5.2 row 16: a replay shows the rows and hides the attach paths", () => {
    const html = renderDocs({ readOnly: true });
    expect(html).toContain("Attached");
    expect(html).toContain("Required document missing");
    expect(html).toContain(">View<");
    expect(html).not.toContain(">Attach<");
    expect(html).not.toContain("Drop a scan here");
  });

  test("5.2 row 24: a load error replaces the body of the card", () => {
    const html = renderDocs({ documentsError: "the case did not load" });
    expect(html).toContain(
      "The documents did not load: the case did not load",
    );
    expect(html).not.toContain("Attached");
    expect(html).not.toContain("Required document missing");
    expect(html).not.toContain(">View<");
  });

  test("5.2 row 25: an upload hides the attach control and flags the zone", () => {
    const html = renderDocs({ uploading: true });
    expect(html).not.toContain(">Attach<");
    expect(html).toContain('aria-disabled="true"');
  });
});

describe("step screen gate", () => {
  test("5.2 row 17: a missing document disables the submit", () => {
    const html = renderStep(takenState);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Submit/);
    expect(html).toContain("Missing document: Salary slips.");
    const variant = renderStep(takenState, {
      documents: [scan(), scan({ id: "d2", name: "Salary slips.png" })],
    });
    expect(variant).toMatch(/<button(?![^>]*\bdisabled=)[^>]*>[^<]*Submit/);
    expect(variant).not.toContain("Missing document: Salary slips.");
  });

  test("5.2 row 18: a missing signature disables the decisions", () => {
    const html = renderStep(signoffState, {
      decisionEnabled: true,
      events: [],
    });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*approve/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*refuse/);
    expect(html).toContain("The step has no signature yet.");
    const variant = renderStep(signoffState, {
      decisionEnabled: true,
      events: [signatureEvent],
    });
    expect(variant).toMatch(/<button(?![^>]*\bdisabled=)[^>]*>[^<]*approve/);
    expect(variant).toMatch(/<button(?![^>]*\bdisabled=)[^>]*>[^<]*refuse/);
    expect(variant).not.toContain("The step has no signature yet.");
  });

  test("5.2 row 26: a loading list counts every name as missing", () => {
    const html = renderStep(takenState, { documents: null });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Submit/);
    expect(html).toContain("Missing document: ID card.");
    expect(html).toContain("Missing document: Salary slips.");
    expect(html).toContain("Loading the documents.");
    expect(html).not.toContain("image/png");
  });
});

describe("scan dialog body", () => {
  test("5.2 row 19: the body shows the scan, its hash and its zones", () => {
    const html = renderBody("view", signatureZones);
    expect(html).toContain('src="/api/documents/d1/bytes"');
    expect(html).toContain('alt="Scan ID card.png"');
    expect(html).toContain(`sha256:${"a".repeat(64)}`);
    expect(html).toContain("Read only");
    expect(html).toContain("signature: 25, 10, 50, 20");
  });

  test("5.2 row 20: a pending zones query gives the detection line", () => {
    const html = renderBody("view", null);
    expect(html).toContain("Detecting the zones...");
  });

  test("5.2 row 21: no signature zone disables the sign action", () => {
    const html = renderBody("sign", stampZones);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Sign this document/);
    expect(html).toContain("No signature zone on this scan.");
  });

  test("5.2 row 22: a signature zone enables the sign action", () => {
    const html = renderBody("sign", signatureZones);
    expect(html).toMatch(
      /<button(?![^>]*\bdisabled=)[^>]*>[^<]*Sign this document/,
    );
    const view = renderBody("view", signatureZones);
    expect(view).not.toContain("Sign this document");
  });
});

describe("test screen wiring", () => {
  test("5.2 row 23: the opened case shows the documents card and the scans", () => {
    const html = renderTestScreen(takenState);
    expect(html).toContain("Documents");
    expect(html).toContain("1 of 2 required");
    expect(html).toContain("image/png · 27/10/2026, 12:00:00");
  });
});
