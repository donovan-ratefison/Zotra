// The rows of the branded policy draft (H1 to H9, L1 to L4, D1 to D3,
// F1). Node environment: renderToString, no jsdom. The fetch stub
// records each url.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, logoDataURI } from "./api";
import { baseLine, cssString, dateLabel, draftHTML, draftHtmlFile, type DraftCover } from "./draft-html";
import { PolicyDraftActions, type DraftBlock } from "./PolicyDraft";
import type { ProcessDefinition, VersionSummary } from "./types";

const cover: DraftCover = {
  bankName: "Banque Ravina",
  primaryColor: "#0f4c45",
  accentColor: "#b8913a",
  logoURI: "",
  processName: "Home loan",
  version: 4,
  status: "published",
  date: "2026-10-29T09:10:58Z",
  baseNumber: 1,
};

// The expected array of row W1 of policy-draft.test.tsx.
const blocks: DraftBlock[] = [
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
];

// Local copy of the miniDefinition of policy-draft.test.tsx, with the
// name "Home loan".
const homeLoan: ProcessDefinition = {
  schema_version: "1",
  name: "Home loan",
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

const version: VersionSummary = {
  id: "v4",
  process_id: "p1",
  parent_id: null,
  number: 4,
  label: "",
  status: "published",
  created_at: "2026-10-20T08:00:00Z",
  frozen_at: "2026-10-29T09:10:58Z",
};

const png = Uint8Array.from("\x89PNG\r\n\x1a\ndata", (c) => c.charCodeAt(0));
const pngURI = "data:image/png;base64,iVBORw0KGgpkYXRh";

const seen: string[] = [];

// stubFetch answers each url with the response that routes gives.
function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal("fetch", (url: string) => {
    seen.push(url);
    return Promise.resolve(routes[url]());
  });
}

function bankResponse(logoURL: string | null): Response {
  return Response.json({
    bank: {
      name: "Banque Ravina",
      primary_color: "#0f4c45",
      accent_color: "#b8913a",
      logo_url: logoURL,
      updated_at: "2026-10-29T09:10:58Z",
    },
  });
}

function pngResponse(): Response {
  return new Response(png, { headers: { "Content-Type": "image/png" } });
}

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

describe("draftHTML", () => {
  test("H1: head, page boxes and cover", () => {
    const html = draftHTML(cover, blocks);
    for (const s of [
      "<title>Home loan: policy draft, v4</title>",
      ":root{--primary:#0f4c45;--accent:#b8913a}",
      '@page{size:A4;margin:18mm;@top-left{content:"Banque Ravina";',
      '@top-right{content:"Home loan: policy draft";',
      '@bottom-left{content:"v4";',
      '@bottom-right{content:"page " counter(page) " of " counter(pages);',
      "<h1>Home loan: policy draft</h1>",
      'v4 <span class="badge">Published</span> <span>29 Oct 2026</span>',
      '<p class="gen">Changes since version 1. The AI wrote this draft. The bank reviews it before any use.</p>',
    ]) {
      expect(html).toContain(s);
    }
    expect(html).not.toContain("<img");
    expect(html).not.toContain('class="note"');
    expect(html).not.toContain("http");
  });

  test("J1 W2: base 0 says the draft checks the current process file", () => {
    expect(draftHTML({ ...cover, baseNumber: 0 }, blocks)).toContain(
      '<p class="gen">Checked against the current process file. The AI wrote this draft. The bank reviews it before any use.</p>',
    );
  });

  test("H2: the blocks in order", () => {
    const html = draftHTML(cover, blocks);
    const parts = [
      '<div class="block"><p><del>The analyst reviews the file.</del></p><p><ins>The analyst reviews and scores the file.</ins></p><p class="reason">Reason: The analysis step now scores the file.</p></div>',
      '<div class="block"><p><ins>The credit committee reviews the file before the amount check.</ins></p><p class="reason">New for step Credit committee. Reason: New step Credit committee.</p></div>',
      "<p>The director decides above EUR 100,000.</p>",
    ];
    const at = parts.map((p) => html.indexOf(p));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });

  test("H3: the logo", () => {
    expect(draftHTML({ ...cover, logoURI: pngURI }, blocks)).toContain(
      `<img src="${pngURI}" alt="Banque Ravina">`,
    );
  });

  test("H4: bank, process and AI text are escaped", () => {
    const html = draftHTML({ ...cover, bankName: 'A"</style>&', processName: 'Q"<x>' }, [
      { kind: "same", text: "<b>x</b> & y" },
    ]);
    expect(html).toContain('@top-left{content:"A\\"\\3c /style>&";');
    expect(html).toContain("<span>A&quot;&lt;/style&gt;&amp;</span>");
    expect(html).toContain('@top-right{content:"Q\\"\\3c x>: policy draft";');
    expect(html).toContain("<h1>Q&quot;&lt;x&gt;: policy draft</h1>");
    expect(html).toContain("<p>&lt;b&gt;x&lt;/b&gt; &amp; y</p>");
    expect(html.split("</style>").length).toBe(2);
  });

  test("H5: the other badges", () => {
    expect(draftHTML({ ...cover, status: "draft" }, blocks)).toContain('<span class="badge">Draft</span>');
    expect(draftHTML({ ...cover, status: "frozen" }, blocks)).toContain('<span class="badge">Frozen</span>');
  });

  test("H6: refused colors fall back to the seed colors", () => {
    const html = draftHTML({ ...cover, primaryColor: "red;}", accentColor: "" }, blocks);
    expect(html).toContain(":root{--primary:#0f4c45;--accent:#b8913a}");
    expect(html).not.toContain("red;}");
  });

  test("H7: no change gives the note", () => {
    const note = '<p class="note">The AI found no paragraph to update.</p>';
    expect(draftHTML(cover, [blocks[2]])).toContain(note);
    expect(draftHTML(cover, [])).toContain(note);
  });
});

test("H8: dateLabel is the UTC date", () => {
  expect(dateLabel("2026-09-03T23:30:00Z")).toBe("3 Sep 2026");
  expect(dateLabel("2026-12-31T23:30:00-02:00")).toBe("1 Jan 2027");
});

test("H9: cssString", () => {
  expect(cssString("a\\b")).toBe('"a\\\\b"');
  expect(cssString("line1\nline2")).toBe('"line1\\a line2"');
});

describe("logoDataURI", () => {
  test("L1: null gives an empty string and no fetch", async () => {
    stubFetch({});
    expect(await logoDataURI(null)).toBe("");
    expect(seen).toEqual([]);
  });

  test("L2: a PNG logo", async () => {
    stubFetch({ "/api/settings/bank/logo?v=1": pngResponse });
    expect(await logoDataURI("/api/settings/bank/logo?v=1")).toBe(pngURI);
    expect(seen).toEqual(["/api/settings/bank/logo?v=1"]);
  });

  test("L3: an SVG logo", async () => {
    stubFetch({
      "/l": () => new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
    });
    expect(await logoDataURI("/l")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  });

  test("L4: a 404 rejects with the ApiError", async () => {
    stubFetch({
      "/l": () => Response.json({ error: { code: "not_found", message: "no logo" } }, { status: 404 }),
    });
    const err = await logoDataURI("/l").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "not_found", message: "no logo" });
  });
});

describe("draftHtmlFile", () => {
  test("D1: frozen date and logo", async () => {
    stubFetch({
      "/api/settings/bank": () => bankResponse("/api/settings/bank/logo?v=1"),
      "/api/settings/bank/logo?v=1": pngResponse,
    });
    const f = await draftHtmlFile(homeLoan, version, 1, blocks);
    expect(f.name).toBe("Home loan-v4-policy-draft.html");
    expect(f.html).toContain("<span>29 Oct 2026</span>");
    expect(f.html).toContain(`<img src="${pngURI}" alt="Banque Ravina">`);
    expect(seen).toEqual(["/api/settings/bank", "/api/settings/bank/logo?v=1"]);
  });

  test("D2: no frozen date, no logo", async () => {
    stubFetch({ "/api/settings/bank": () => bankResponse(null) });
    const f = await draftHtmlFile(homeLoan, { ...version, frozen_at: null }, 1, blocks);
    expect(f.html).toContain("<span>20 Oct 2026</span>");
    expect(f.html).not.toContain("<img");
    expect(seen).toEqual(["/api/settings/bank"]);
  });

  test("D3: a 500 with no JSON body rejects", async () => {
    stubFetch({ "/api/settings/bank": () => new Response("", { status: 500 }) });
    const err = await draftHtmlFile(homeLoan, version, 1, blocks).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "http", message: "HTTP 500" });
  });
});

test("F1: the dialog actions", () => {
  const props = { onMarkdown: () => {}, onHtml: () => {}, onClose: () => {} };
  const on = renderToString(createElement(PolicyDraftActions, { ready: true, ...props }));
  const at = ["Download Markdown", "Download HTML", "Close"].map((s) => on.indexOf(s));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((x, y) => x - y)).toEqual(at);
  expect(on).not.toContain('disabled=""');
  const off = renderToString(createElement(PolicyDraftActions, { ready: false, ...props }));
  expect(off.split('disabled=""').length - 1).toBe(2);
});

test("J1 W1: baseLine", () => {
  expect(baseLine(0)).toBe("Checked against the current process file.");
  expect(baseLine(1)).toBe("Changes since version 1.");
  expect(baseLine(3)).toBe("Changes since version 3.");
});
