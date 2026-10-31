// The test rows of the scan import: the size rules of the page
// render, the client of the scan route, the scan flow seam, the
// notice stages, and the cited paragraphs of the policy panel.
// The environment is node: renderToString, no DOM.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, readPolicyScan } from "./api";
import { NoTextNotice, readScan } from "./ImportDialog";
import { CitedParagraphs, isScan } from "./PolicyPanel";
import { dataUrlBytes, fitScanPage, policyErrorText } from "./policy";

const P = "data:image/png;base64,";
const BIG = P + "A".repeat(4194308);
const EDGE = P + "A".repeat(4194304);
const SMALL = P + "AQID";

afterEach(() => {
  vi.unstubAllGlobals();
});

// renderOf records each width and answers with the given function.
function renderOf(answer: (width: number) => Promise<string>) {
  const widths: number[] = [];
  const render = (width: number) => {
    widths.push(width);
    return answer(width);
  };
  return { widths, render };
}

describe("page size rules", () => {
  test("S1: dataUrlBytes counts the decoded bytes", () => {
    expect(dataUrlBytes(P + "AQ==")).toBe(1);
    expect(dataUrlBytes(P + "AQI=")).toBe(2);
    expect(dataUrlBytes(SMALL)).toBe(3);
    expect(dataUrlBytes(EDGE)).toBe(3145728);
    expect(dataUrlBytes(BIG)).toBe(3145731);
  });

  test("S2: no base64 text or no comma gives 0", () => {
    expect(dataUrlBytes(P)).toBe(0);
    expect(dataUrlBytes("abc")).toBe(0);
  });

  test("S3: a small page keeps the first width", async () => {
    const r = renderOf(async () => SMALL);
    await expect(fitScanPage(r.render)).resolves.toBe(SMALL);
    expect(r.widths).toEqual([1600]);
  });

  test("S4: a big page goes to the next width", async () => {
    const r = renderOf(async (w) => (w === 1600 ? BIG : SMALL));
    await expect(fitScanPage(r.render)).resolves.toBe(SMALL);
    expect(r.widths).toEqual([1600, 1200]);
  });

  test("S5: a page of exactly 3 MiB fits", async () => {
    const r = renderOf(async () => EDGE);
    await expect(fitScanPage(r.render)).resolves.toBe(EDGE);
    expect(r.widths).toEqual([1600]);
  });

  test("S6: a page too big at each width rejects with too_large", async () => {
    const r = renderOf(async () => BIG);
    const err = await fitScanPage(r.render).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 413, code: "too_large" });
    expect((err as ApiError).message).toBe("A page of the scan is too large.");
    expect(r.widths).toEqual([1600, 1200, 900]);
    expect(policyErrorText(err)).toBe("A page of the scan is too large.");
  });

  test("S7: a render error passes through with no other width", async () => {
    const x = new Error("x");
    const r = renderOf(() => Promise.reject(x));
    await expect(fitScanPage(r.render)).rejects.toBe(x);
    expect(r.widths).toEqual([1600]);
  });
});

describe("scan route client", () => {
  test("S8: readPolicyScan posts the pages and unwraps the answer", async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const answer = { paragraphs: [{ id: "p1-1", text: "A" }], dropped: 2 };
    vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return Promise.resolve({ ok: true, status: 200, json: async () => answer });
    });
    const ctrl = new AbortController();
    await expect(readPolicyScan([P + "AQ=="], ctrl.signal)).resolves.toEqual(answer);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/ai/read-policy-scan");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ pages: [P + "AQ=="] });
    expect(calls[0].init?.signal).toBe(ctrl.signal);
  });

  const errors: [number, string, string][] = [
    [400, "invalid_pages", "pages must hold 1 to 10 PNG data URLs of 3 MiB or less"],
    [422, "no_text", "The AI found no text on these pages."],
    [
      503,
      "ai_not_recorded",
      "This request is not in the recorded demo answers. To use the live AI, set ZOTRA_AI_API_KEY and ZOTRA_AI_MODE=live in .env, then restart.",
    ],
    [503, "ai_unavailable", "The AI layer is off."],
    [422, "invalid_output", "the AI answer has no content"],
  ];
  test.each(errors)("S9: answer %i %s rejects an ApiError", async (status, code, message) => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: false,
        status,
        json: async () => ({ error: { code, message } }),
      }),
    );
    const err = await readPolicyScan([P + "AQ=="]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, code, message });
    expect(policyErrorText(err)).toBe(message);
  });
});

describe("scan flow", () => {
  const buf = new ArrayBuffer(4);
  const pages = [P + "AQ==", P + "Ag=="];
  const found = [
    { id: "p1-1", text: "A" },
    { id: "p2-1", text: "B" },
  ];

  test("S10: readScan renders, reads and returns the paragraphs", async () => {
    const ctrl = new AbortController();
    const render = vi.fn(async () => pages);
    const read = vi.fn(async () => ({ paragraphs: found, dropped: 0 }));
    await expect(readScan(buf, ctrl.signal, render, read)).resolves.toEqual(found);
    expect(render).toHaveBeenCalledWith(buf);
    expect(read).toHaveBeenCalledWith(pages, ctrl.signal);
  });

  test("S11: a render error rejects and the AI is not called", async () => {
    const tooLarge = new ApiError(413, "too_large", "A page of the scan is too large.");
    const read = vi.fn(async () => ({ paragraphs: found, dropped: 0 }));
    await expect(
      readScan(buf, new AbortController().signal, () => Promise.reject(tooLarge), read),
    ).rejects.toBe(tooLarge);
    expect(read).not.toHaveBeenCalled();
  });

  test("S12: an AI error rejects with the same error", async () => {
    const noText = new ApiError(422, "no_text", "The AI found no text on these pages.");
    await expect(
      readScan(buf, new AbortController().signal, async () => pages, () => Promise.reject(noText)),
    ).rejects.toBe(noText);
  });
});

describe("no text notice", () => {
  test("S13: the reading stage shows the loader and no button", () => {
    const html = renderToString(
      createElement(NoTextNotice, { reading: true, error: null, onRead: () => {} }),
    );
    expect(html).toContain("The AI reads the scan...");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Read the scan with AI");
  });

  test("S14: the error stage shows the error and the button", () => {
    const html = renderToString(
      createElement(NoTextNotice, {
        reading: false,
        error: "The AI found no text on these pages.",
        onRead: () => {},
      }),
    );
    expect(html).toContain(
      '<p class="text-sm text-destructive">The AI found no text on these pages.</p>',
    );
    expect(html).toContain("Read the scan with AI");
  });
});

describe("policy panel of a scan", () => {
  test("S15: isScan needs read pages with no paragraph id", () => {
    expect(isScan(0, {})).toBe(false);
    expect(isScan(2, {})).toBe(false);
    expect(isScan(2, { 1: [] })).toBe(true);
    expect(isScan(2, { 1: [], 2: [null] })).toBe(true);
    expect(isScan(2, { 1: [], 2: ["p2-1"] })).toBe(false);
    expect(isScan(1, { 1: ["p1-1", null] })).toBe(false);
    expect(isScan(1, { 1: [], 2: ["p2-1"] })).toBe(true);
  });

  test("S16: CitedParagraphs lists the text in highlight order", () => {
    const html = renderToString(
      createElement(CitedParagraphs, {
        paragraphs: [
          { id: "p1-2", text: "Loans above 50 000 EUR need a second review." },
          { id: "p2-1", text: "The analyst signs the file." },
        ],
      }),
    );
    expect(html).toContain('aria-label="Cited paragraphs"');
    expect(html).toContain("<h3");
    const first = html.indexOf("p1-2: Loans above 50 000 EUR need a second review.");
    const second = html.indexOf("p2-1: The analyst signs the file.");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  test("S17: no paragraph gives the title only", () => {
    const html = renderToString(createElement(CitedParagraphs, { paragraphs: [] }));
    expect(html).toContain("Cited paragraphs");
    expect(html).not.toContain("<p");
  });
});
