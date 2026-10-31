/// <reference types="node" />
// The test rows of the policy import: the pure paragraph rules, the
// api functions, the error line, the dialog body, and the stored
// policy (api, source rules, panel stages).
// The environment is node: renderToString for the components, no
// jsdom, and the pdf.js legacy build for the read errors.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ApiError,
  createProcess,
  createVersion,
  fetchPolicy,
  policyToProcess,
  uploadPolicy,
} from "./api";
import {
  AnalyzeProgress,
  ImportDialogBody,
  NoTextNotice,
  analyzeDisabled,
  elapsedText,
  isAbort,
} from "./ImportDialog";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { isHighlighted, PolicyPanel } from "./PolicyPanel";
import {
  extractParagraphs,
  loadStoredPolicy,
  paragraphIdsOfItems,
  paragraphsOfItems,
  pdfItemsOf,
  policyErrorText,
  policySource,
  type PdfItem,
} from "./policy";
import type { ProcessDefinition } from "./types";

// The mini definition fixture of the approved 2.2 brief, with all
// fields.
const miniDefinition: ProcessDefinition = {
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
    { name: "documents", label: "Documents", type: "document", options: [], computed: null },
  ],
  scope: [
    { field: "amount", role: "advisor", access: "write" },
    { field: "amount", role: "analyst", access: "read" },
    { field: "documents", role: "advisor", access: "write" },
    { field: "documents", role: "analyst", access: "read" },
  ],
  nodes: [
    { id: "start", type: "start", name: "Application received", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "entry", type: "task", name: "Application entry", role: "advisor",
      deadline_hours: 24, documents: ["ID"], signature: false,
      checks: [{ id: "c1", expression: "amount > 0.0", message: "The amount must be positive.",
                 plain_text: "The loan amount must be positive.", citations: [] }],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "review", type: "task", name: "Review", role: "ghost",
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "check", type: "gateway", name: "File complete?", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "granted", type: "end", name: "Loan granted", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "approved", scope_overrides: [], source_ids: [], citations: [] },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null,
      condition: null, is_default: false },
    { id: "e2", from: "entry", to: "check", label: null, decision: null,
      condition: null, is_default: false },
    { id: "e3", from: "check", to: "review", label: "Incomplete",
      decision: null, condition: "size(documents) < 4", is_default: false },
    { id: "e4", from: "check", to: "granted", label: null, decision: null,
      condition: null, is_default: true },
    { id: "e5", from: "review", to: "entry", label: "Return",
      decision: "unfavorable", condition: null, is_default: false },
  ],
  sources: [],
};

// item builds one text item at a position.
// The default width 0 keeps a gap over 1 between the items of rows 16
// to 21, so they join with a space.
function item(str: string, x: number, y: number, width = 0): PdfItem {
  return { str, x, y, width };
}

// The fetch stubs need only ok, status and json, the surface that the
// api client reads. calls records the path and the body of each call.
function stubFetch(status: number, body: unknown) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    (path: string, init?: { method?: string; body?: string }) => {
      calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
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

describe("paragraph rules", () => {
  test("16: no items gives no paragraph", () => {
    expect(paragraphsOfItems(1, [])).toEqual([]);
  });

  test("17: equal gaps give one paragraph", () => {
    const rows = paragraphsOfItems(1, [
      item("A.", 72, 720),
      item("B.", 72, 706),
      item("C.", 72, 692),
    ]);
    expect(rows).toEqual([{ id: "p1-1", text: "A. B. C." }]);
  });

  test("18: the gap over 1.6 times the lower middle splits", () => {
    const rows = paragraphsOfItems(1, [
      item("A.", 72, 720),
      item("B.", 72, 706),
      item("C.", 72, 670),
    ]);
    // Median 14, threshold 22.4, the gap 36 splits.
    expect(rows).toEqual([
      { id: "p1-1", text: "A. B." },
      { id: "p1-2", text: "C." },
    ]);
  });

  test("19: items of one line join with one space", () => {
    const rows = paragraphsOfItems(1, [
      item("Loan", 72, 720),
      item("policy.", 110, 719),
    ]);
    expect(rows).toEqual([{ id: "p1-1", text: "Loan policy." }]);
  });

  test("20: the items sort by y descending", () => {
    const rows = paragraphsOfItems(1, [
      item("C.", 72, 692),
      item("A.", 72, 720),
      item("B.", 72, 706),
    ]);
    expect(rows).toEqual([{ id: "p1-1", text: "A. B. C." }]);
  });

  test("21: an item of spaces only gives no paragraph", () => {
    expect(paragraphsOfItems(1, [item("   ", 72, 720)])).toEqual([]);
  });
});

describe("split ligatures", () => {
  test("P1: the pieces of a word at a ligature join", () => {
    const rows = paragraphsOfItems(1, [
      item("head o", 56.25, 648.63, 217.6),
      item("ff", 273.85, 648.63, 7.81),
      item("ice grants.", 281.66, 648.63, 60),
    ]);
    expect(rows).toEqual([{ id: "p1-1", text: "head office grants." }]);
  });

  test("P2: a space item keeps the word space", () => {
    const rows = paragraphsOfItems(1, [
      item("This policy", 56.25, 679.38, 60.12),
      item(" ", 116.37, 679.38, 4.66),
      item("fi", 119.86, 679.38, 7.33),
      item("xes the rules.", 127.19, 679.38, 80),
    ]);
    expect(rows).toEqual([{ id: "p1-1", text: "This policy fixes the rules." }]);
  });

  test("P3: a gap of 1 joins, a gap over 1 gives a space", () => {
    expect(
      paragraphsOfItems(1, [item("A", 0, 720, 10), item("B", 11, 720, 5)])[0].text,
    ).toBe("AB");
    expect(
      paragraphsOfItems(1, [item("A", 0, 720, 10), item("B", 11.5, 720, 5)])[0].text,
    ).toBe("A B");
  });

  test("P4: each item gets the id of its paragraph, a blank item null", () => {
    const ids = paragraphIdsOfItems(1, [
      item("A.", 72, 720, 10),
      item(" ", 90, 720, 4),
      item("B.", 72, 706, 10),
      item("C.", 72, 670, 10),
    ]);
    expect(ids).toEqual(["p1-1", null, "p1-1", "p1-2"]);
  });

  test("P5: pdfItemsOf keeps the index of a marked content item", () => {
    expect(
      pdfItemsOf([
        { str: "a", transform: [1, 0, 0, 1, 5, 6], width: 3 },
        { type: "beginMarkedContent" },
      ]),
    ).toEqual([
      { str: "a", x: 5, y: 6, width: 3 },
      { str: "", x: 0, y: 0, width: 0 },
    ]);
  });

  test("P7 and P8: the example page 1 marks only the items of the cited paragraph", async () => {
    const bytes = readFileSync(
      new URL("../../../examples/home-loan/policy.pdf", import.meta.url),
    );
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const ids = paragraphIdsOfItems(1, pdfItemsOf(content.items));
    expect(ids[12]).toBe("p1-3");
    expect(ids[39]).toBe("p1-4");
    expect(ids[7]).toBeNull();
    const hl = [{ id: "p1-3", text: "x" }];
    expect(isHighlighted(ids[12], hl)).toBe(true);
    expect(isHighlighted(ids[39], hl)).toBe(false);
  });
});

describe("api client", () => {
  test("22: policyToProcess unwraps the answer", async () => {
    const calls = stubFetch(200, { definition: miniDefinition, attempts: 2 });
    const result = await policyToProcess("Home loan", [
      { id: "p1-1", text: "The advisor collects the file." },
    ]);
    expect(result.attempts).toBe(2);
    expect(result.definition.name).toBe("Mini loan");
    expect(calls[0].path).toBe("/api/ai/policy-to-process");
    expect(calls[0].body).toEqual({
      name: "Home loan",
      paragraphs: [{ id: "p1-1", text: "The advisor collects the file." }],
    });
  });

  test("23: a 422 answer carries the code and the details", async () => {
    stubFetch(422, {
      error: {
        code: "invalid_output",
        message: "The AI output did not pass validation after 3 attempts.",
        details: [{ path: "/nodes/0/name", message: "name is required" }],
      },
    });
    const err = await policyToProcess("Home loan", []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(422);
    expect(apiErr.code).toBe("invalid_output");
    expect(apiErr.details).toHaveLength(1);
  });

  test("24: createProcess unwraps the process envelope", async () => {
    const calls = stubFetch(201, {
      process: { id: "p1", name: "P", created_at: "2026-10-27T09:00:00Z" },
    });
    const process = await createProcess("P");
    expect(process).toEqual({
      id: "p1",
      name: "P",
      created_at: "2026-10-27T09:00:00Z",
    });
    expect(calls[0].path).toBe("/api/processes");
    expect(calls[0].body).toEqual({ name: "P" });
  });

  test("25: createVersion unwraps the version envelope", async () => {
    const calls = stubFetch(201, {
      version: {
        id: "v1",
        process_id: "p1",
        parent_id: null,
        number: 1,
        label: "From policy",
        status: "draft",
        created_at: "2026-10-27T12:00:00Z",
        frozen_at: null,
        definition: miniDefinition,
      },
    });
    const version = await createVersion("p1", "From policy", miniDefinition);
    expect(version.definition.name).toBe("Mini loan");
    expect(calls[0].path).toBe("/api/processes/p1/versions");
  });
});

describe("error line", () => {
  test("26: an ApiError gives its message, anything else the generic line", () => {
    expect(policyErrorText(new ApiError(500, "internal", "boom", []))).toBe(
      "boom",
    );
    expect(policyErrorText(new Error("x"))).toBe("The analysis did not run.");
  });
});

describe("pdf read", () => {
  test("27: bytes that are not a PDF reject", async () => {
    const bytes = new TextEncoder().encode("not a pdf");
    await expect(extractParagraphs(bytes.buffer)).rejects.toThrow();
  });
});

describe("dialog body", () => {
  test("28: the fresh body holds title, drop zone and the two buttons", () => {
    const html = renderToString(
      createElement(ImportDialogBody, {
        onProposed: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("New from policy");
    expect(html).toContain("Drop the policy PDF here, or browse.");
    expect(html).toContain("Cancel");
    expect(html).toContain("Analyze policy");
    // No file loaded: the analyze button is disabled.
    expect(html).toContain("disabled");
  });
});

describe("analysis progress and cancel", () => {
  const body = () =>
    renderToString(
      createElement(ImportDialogBody, { onProposed: () => {}, onClose: () => {} }),
    );

  test("50a: the description sits in a Hint next to the title", () => {
    expect(body()).toContain('aria-label="About New from policy"');
  });

  test("50b: the description paragraph is gone", () => {
    expect(body()).not.toContain("The AI reads the policy and proposes");
  });

  test("50c: elapsedText gives m:ss of the whole seconds", () => {
    expect(elapsedText(0)).toBe("0:00");
    expect(elapsedText(59.9)).toBe("0:59");
    expect(elapsedText(65)).toBe("1:05");
    expect(elapsedText(3600)).toBe("60:00");
  });

  test("50d: a negative or non-finite value gives 0:00", () => {
    expect(elapsedText(-1)).toBe("0:00");
    expect(elapsedText(NaN)).toBe("0:00");
    expect(elapsedText(Infinity)).toBe("0:00");
  });

  const progress = (paragraphs: number, seconds: number) =>
    renderToString(createElement(AnalyzeProgress, { paragraphs, seconds }));

  test("50e: the status block holds the spinner text, the size and the time", () => {
    const html = progress(42, 18);
    expect(html).toContain('role="status"');
    expect(html).toContain("Analyzing the policy");
    expect(html).toContain("The AI reads 42 paragraphs and drafts the process.");
    expect(html).toContain("Elapsed 0:18");
  });

  test("50f: one paragraph is singular", () => {
    expect(progress(1, 0)).toContain("The AI reads 1 paragraph and drafts the process.");
  });

  test("50g: zero paragraphs and zero seconds", () => {
    const html = progress(0, 0);
    expect(html).toContain("The AI reads 0 paragraphs");
    expect(html).toContain("Elapsed 0:00");
  });

  test("50h: the block holds the bar and the spinner", () => {
    const html = progress(42, 18);
    expect(html).toContain('data-testid="analyze-bar"');
    expect(html).toContain('src="/zotra-loader-light.svg"');
  });

  test("50i: policyToProcess passes the signal only when given", async () => {
    const inits: (RequestInit | undefined)[] = [];
    vi.stubGlobal("fetch", (_path: string, init?: RequestInit) => {
      inits.push(init);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ definition: miniDefinition, attempts: 1 }),
      });
    });
    const ctrl = new AbortController();
    await policyToProcess("Home loan", [], ctrl.signal);
    await policyToProcess("Home loan", []);
    expect(inits[0]?.signal).toBe(ctrl.signal);
    expect(inits[1] && "signal" in inits[1]).toBe(false);
  });

  test("50j: an abort rejects, and isAbort marks it as no error", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.reject(new DOMException("aborted", "AbortError")),
    );
    const err = await policyToProcess("Home loan", []).catch((e: unknown) => e);
    expect(isAbort(err)).toBe(true);
    expect(isAbort(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbort(new Error("x"))).toBe(false);
  });
});

describe("PDF without text", () => {
  test("121a: a file with paragraphs enables the analysis", () => {
    expect(analyzeDisabled(true, false, 12)).toBe(false);
  });

  test("121b: a file with 0 paragraphs disables it", () => {
    expect(analyzeDisabled(true, false, 0)).toBe(true);
  });

  test("121c: no file disables it", () => {
    expect(analyzeDisabled(false, false, 12)).toBe(true);
  });

  test("121d: a running analysis disables it", () => {
    expect(analyzeDisabled(true, true, 12)).toBe(true);
  });

  test("121e: no file and 0 paragraphs disable it", () => {
    expect(analyzeDisabled(false, false, 0)).toBe(true);
  });

  test("121f: the notice is an alert with the exact text", () => {
    const html = renderToString(createElement(NoTextNotice));
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "This PDF has no readable text. It is a scan or a photo. Use a PDF that holds text.",
    );
  });

  test("121g: a PDF with no text layer gives 1 page and 0 paragraphs", async () => {
    const bytes = readFileSync(new URL("./testdata/no-text.pdf", import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const result = await extractParagraphs(buffer);
    expect(result).toMatchObject({ pages: 1 });
    expect(result.paragraphs).toEqual([]);
  });
});

// The stored policy rows: the stub records each call and answers one
// real Response, built fresh for each call.
function stubResponse(make: () => Response) {
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return Promise.resolve(make());
  });
  return calls;
}

function errorBody(status: number, code: string, message: string) {
  return () =>
    new Response(JSON.stringify({ error: { code, message } }), { status });
}

describe("stored policy api", () => {
  test("B1: uploadPolicy sends one PUT with the PDF and the escaped name", async () => {
    const calls = stubResponse(() => new Response(null, { status: 200 }));
    const file = new File(["%PDF-1 a"], "Home loan.pdf");
    await uploadPolicy("p 1", file);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/processes/p%201/policy");
    expect(calls[0].init?.method).toBe("PUT");
    expect(calls[0].init?.headers).toEqual({
      "Content-Type": "application/pdf",
      "X-File-Name": "Home%20loan.pdf",
    });
    expect(calls[0].init?.body).toBe(file);
  });

  test("B2: a 413 rejects with the ApiError of the body", async () => {
    stubResponse(
      errorBody(413, "too_large", "the policy file must stay under 20 MiB"),
    );
    const err = await uploadPolicy("p 1", new File(["%PDF-1 a"], "Home loan.pdf")).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 413,
      message: "the policy file must stay under 20 MiB",
    });
  });

  test("B3: fetchPolicy gives a PDF file with the decoded name", async () => {
    const calls = stubResponse(
      () =>
        new Response("%PDF-1 a", {
          status: 200,
          headers: { "X-File-Name": "Home%20loan.pdf" },
        }),
    );
    const file = await fetchPolicy("p1");
    expect(calls[0].path).toBe("/api/processes/p1/policy");
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe("Home loan.pdf");
    expect(file?.type).toBe("application/pdf");
    expect(await file?.text()).toBe("%PDF-1 a");
  });

  test("B4: no name header gives policy.pdf", async () => {
    stubResponse(() => new Response("%PDF-1 a", { status: 200 }));
    expect((await fetchPolicy("p1"))?.name).toBe("policy.pdf");
  });

  test("B5: a bad escape keeps the raw name", async () => {
    stubResponse(
      () =>
        new Response("%PDF-1 a", {
          status: 200,
          headers: { "X-File-Name": "%E0%A4%A" },
        }),
    );
    expect((await fetchPolicy("p1"))?.name).toBe("%E0%A4%A");
  });

  test("B6: a 404 gives null", async () => {
    stubResponse(errorBody(404, "not_found", "no policy p1"));
    expect(await fetchPolicy("p1")).toBeNull();
  });

  test("B7: a 500 rejects with ApiError status 500", async () => {
    stubResponse(errorBody(500, "internal", "cannot complete the request"));
    const err = await fetchPolicy("p1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500 });
  });

  test("B8: loadStoredPolicy cuts the stored example policy", async () => {
    const bytes = readFileSync(
      new URL("../../../examples/home-loan/policy.pdf", import.meta.url),
    );
    stubResponse(
      () =>
        new Response(bytes, {
          status: 200,
          headers: { "X-File-Name": "home-loan-policy.pdf" },
        }),
    );
    const result = await loadStoredPolicy("p1");
    expect(result?.file.name).toBe("home-loan-policy.pdf");
    expect(result?.paragraphs).toHaveLength(12);
    expect(result?.paragraphs[0]).toEqual({
      id: "p1-1",
      text: "Banque Ravina, Credit Policy",
    });
    // P6: the ligature pieces join, the paragraph count stays.
    expect(result?.paragraphs[2]).toEqual({
      id: "p1-3",
      text: "1. Purpose and scope This policy fixes the rules for the payment of a home loan. The bank pays each home loan in one payment to the notary of the buyer. The policy applies to each home loan of 50,000 EUR or more that the head office or a branch grants. It runs from the signature of the loan agreement to the payment of the funds to the notary.",
    });
    for (const p of result?.paragraphs ?? []) {
      expect(p.text).not.toMatch(/\b(fi|ff|fl) | (fi|ff|fl)\b/);
    }
  });

  test("B9: loadStoredPolicy on a 404 gives null", async () => {
    stubResponse(errorBody(404, "not_found", "no policy p1"));
    expect(await loadStoredPolicy("p1")).toBeNull();
  });
});

describe("policy source", () => {
  const pFile = new File(["a"], "proposal.pdf");
  const mFile = new File(["b"], "memory.pdf");
  const sFile = new File(["c"], "stored.pdf");
  const pPar = [{ id: "p1-1", text: "Proposal" }];
  const mPar = [{ id: "p1-1", text: "Memory" }];
  const sPar = [{ id: "p1-1", text: "Stored" }];
  const memory = { processId: "p1", file: mFile, paragraphs: mPar };
  const empty = { file: null, paragraphs: [] };

  test("B10: the proposal wins", () => {
    expect(
      policySource({ file: pFile, paragraphs: pPar }, memory, "p1", {
        status: "success",
        data: { file: sFile, paragraphs: sPar },
      }),
    ).toEqual({ file: pFile, paragraphs: pPar, status: "ready" });
  });

  test("B11: no process gives the empty panel", () => {
    expect(
      policySource(null, null, null, { status: "pending", data: undefined }),
    ).toEqual({ ...empty, status: "ready" });
  });

  test("B12: the memory of the same process wins over a pending query", () => {
    expect(
      policySource(null, memory, "p1", { status: "pending", data: undefined }),
    ).toEqual({ file: mFile, paragraphs: mPar, status: "ready" });
  });

  test("B13: the memory of another process gives the stored file", () => {
    expect(
      policySource(null, memory, "p2", {
        status: "success",
        data: { file: sFile, paragraphs: sPar },
      }),
    ).toEqual({ file: sFile, paragraphs: sPar, status: "ready" });
  });

  test("B14: pending gives loading, error gives error", () => {
    expect(
      policySource(null, null, "p1", { status: "pending", data: undefined }),
    ).toEqual({ ...empty, status: "loading" });
    expect(
      policySource(null, null, "p1", { status: "error", data: undefined }),
    ).toEqual({ ...empty, status: "error" });
  });

  test("B15: success with no data gives the empty panel", () => {
    expect(
      policySource(null, null, "p1", { status: "success", data: null }),
    ).toEqual({ ...empty, status: "ready" });
    expect(
      policySource(null, null, "p1", { status: "success", data: undefined }),
    ).toEqual({ ...empty, status: "ready" });
  });

  test("B16: the panel shows the loading and error stages", () => {
    const loading = renderToString(
      createElement(PolicyPanel, { file: null, highlight: [], status: "loading" }),
    );
    expect(loading).toContain("Loading the policy...");
    const error = renderToString(
      createElement(PolicyPanel, { file: null, highlight: [], status: "error" }),
    );
    expect(error).toContain("The policy did not load.");
    expect(error).toContain("text-destructive");
    const ready = renderToString(
      createElement(PolicyPanel, { file: new File([], "p.pdf"), highlight: [] }),
    );
    expect(ready).toContain("Loading the policy...");
  });
});
