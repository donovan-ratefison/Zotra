// The rows of the policy draft (W1 to W7). Node environment:
// renderToString, no jsdom. The fetch stub records each call.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "./api";
import { updatePolicy, type PolicyDraft } from "./ai-api";
import { PolicyDraftView, draftBlocks, draftMarkdown } from "./PolicyDraft";
import type { ProcessDefinition } from "./types";

// Local copy of the mini definition of diff.test.ts, with the node
// committee added.
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
      deadline_hours: 24, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "committee", type: "task", name: "Credit committee", role: "advisor",
      deadline_hours: 24, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "released", type: "end", name: "Loan released", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "approved", scope_overrides: [],
      source_ids: [], citations: [],
    },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
    { id: "e2", from: "entry", to: "released", label: null, decision: null, condition: null, is_default: false },
  ],
  sources: [],
};

// The paragraphs and the A1 answer of the route rows.
const paragraphs = [
  { id: "p1-1", text: "The analyst reviews the file." },
  { id: "p1-2", text: "The director decides above EUR 100,000." },
];
const a1: PolicyDraft = {
  base_number: 1,
  changed: [
    {
      paragraph_id: "p1-1",
      new_text: "The analyst reviews and scores the file.",
      reason: "The analysis step now scores the file.",
      element_ids: ["analysis"],
    },
  ],
  added: [
    {
      step_id: "committee",
      after_paragraph_id: "p1-1",
      text: "The credit committee reviews the file before the amount check.",
      reason: "New step Credit committee.",
    },
  ],
  dropped: 0,
};

const seen: { url: string; init: RequestInit }[] = [];

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  });
}

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

function view(props: Parameters<typeof PolicyDraftView>[0]): string {
  return renderToString(createElement(PolicyDraftView, props));
}

describe("draftBlocks", () => {
  test("W1: changed p1-1, added Credit committee, same p1-2", () => {
    expect(draftBlocks(paragraphs, a1, miniDefinition)).toEqual([
      {
        kind: "changed",
        old: "The analyst reviews the file.",
        text: "The analyst reviews and scores the file.",
        reason: "The analysis step now scores the file.",
      },
      {
        kind: "added",
        text: "The credit committee reviews the file before the amount check.",
        reason: "New step Credit committee.",
        step: "Credit committee",
      },
      { kind: "same", text: "The director decides above EUR 100,000." },
    ]);
  });

  test("W2: an addition after p1-2 follows p1-2", () => {
    const draft = { ...a1, changed: [], added: [{ ...a1.added[0], after_paragraph_id: "p1-2" }] };
    expect(draftBlocks(paragraphs, draft, miniDefinition).map((b) => b.kind)).toEqual([
      "same",
      "same",
      "added",
    ]);
  });
});

test("W3: the Markdown draft", () => {
  expect(draftMarkdown("Home loan", 1, draftBlocks(paragraphs, a1, miniDefinition))).toBe(
    "# Home loan: policy draft\n\n" +
      "Changes since version 1. The AI wrote this draft. The bank reviews it before any use.\n\n" +
      "~~The analyst reviews the file.~~\n\n" +
      "The analyst reviews and scores the file.\n\n" +
      "*Reason: The analysis step now scores the file.*\n\n" +
      "The credit committee reviews the file before the amount check.\n\n" +
      "*New for step Credit committee. Reason: New step Credit committee.*\n\n" +
      "The director decides above EUR 100,000.\n",
  );
});

describe("PolicyDraftView", () => {
  test("W4: pending and error", () => {
    expect(view({ status: "pending", blocks: [] })).toContain("The AI writes the draft...");
    expect(view({ status: "error", blocks: [], error: "AI down" })).toContain(
      "The draft did not load. AI down",
    );
  });

  test("W5: success shows struck, highlighted and reason lines", () => {
    const html = view({ status: "success", draft: a1, blocks: draftBlocks(paragraphs, a1, miniDefinition) });
    for (const s of ["<del", "line-through", "<ins", "bg-yellow-100", "Reason: ", "New for step Credit committee."]) {
      expect(html).toContain(s);
    }
    expect(html).toContain("The AI wrote this draft: the bank reviews it.");
  });

  test("W6: empty lists and dropped items", () => {
    const html = view({ status: "success", draft: { base_number: 1, changed: [], added: [], dropped: 2 }, blocks: [] });
    expect(html).toContain("The AI found no paragraph to update.");
    expect(html).toContain("The server refused 2 AI items");
  });
});

describe("updatePolicy", () => {
  test("W7: POST with the body; 400 no_changes gives an ApiError", async () => {
    stubFetch(200, a1);
    expect(await updatePolicy("v2", paragraphs)).toEqual(a1);
    expect(seen[0].url).toBe("/api/ai/update-policy");
    expect(seen[0].init.method).toBe("POST");
    expect(JSON.parse(seen[0].init.body as string)).toEqual({ version_id: "v2", paragraphs });

    stubFetch(400, { error: { code: "no_changes", message: "this version has no change since version 1" } });
    const err = await updatePolicy("v1", paragraphs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("no_changes");
    expect((err as ApiError).message).toBe("this version has no change since version 1");
  });
});
