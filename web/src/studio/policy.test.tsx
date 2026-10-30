// The 13 test rows of the policy import brief: the pure paragraph
// rules, the new api functions, the error line, and the dialog body.
// The environment is node: renderToString for the components, no
// jsdom, and the pdf.js legacy build for the read errors.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, createProcess, createVersion, policyToProcess } from "./api";
import { AnalyzeProgress, ImportDialogBody, elapsedText, isAbort } from "./ImportDialog";
import {
  extractParagraphs,
  paragraphsOfItems,
  policyErrorText,
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
function item(str: string, x: number, y: number): PdfItem {
  return { str, x, y };
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
    expect(html).toContain("animate-spin");
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
