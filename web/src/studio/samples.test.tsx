/// <reference types="node" />
// The sample policy rows of the import dialog. The environment is
// node: renderToString for the body, and the fetch stub answers the
// real sample bytes.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchSample, ImportDialogBody, SAMPLES } from "./ImportDialog";
import { extractParagraphs } from "./policy";

afterEach(() => vi.unstubAllGlobals());

describe("sample policies", () => {
  test("ux2f: the fresh body shows the label and the three buttons", () => {
    const html = renderToString(
      createElement(ImportDialogBody, { onProposed: () => {}, onClose: () => {} }),
    );
    expect(html).toContain("Try a sample policy:");
    expect(html).toContain("Home loan (EN)");
    expect(html).toContain("SME loan (EN)");
    expect(html).toContain("Prêt immobilier (FR)");
  });

  test("ux2g: each sample has its served file and its file name", () => {
    expect(SAMPLES.map((s) => [s.url, s.fileName])).toEqual([
      ["/samples/home-loan.pdf", "home-loan.pdf"],
      ["/samples/sme-loan-disbursement.pdf", "sme-loan-disbursement.pdf"],
      ["/samples/deblocage-pret-immobilier.pdf", "deblocage-pret-immobilier.pdf"],
    ]);
    for (const s of SAMPLES) {
      expect(() => readFileSync(new URL(`../../public${s.url}`, import.meta.url))).not.toThrow();
    }
  });

  test("ux2h: SME loan fetches its PDF and gives a named PDF file that reads", async () => {
    const bytes = readFileSync(
      new URL("../../public/samples/sme-loan-disbursement.pdf", import.meta.url),
    );
    const paths: string[] = [];
    vi.stubGlobal("fetch", (path: string) => {
      paths.push(path);
      return Promise.resolve(new Response(bytes, { status: 200 }));
    });
    const file = await fetchSample(
      "/samples/sme-loan-disbursement.pdf",
      "sme-loan-disbursement.pdf",
    );
    expect(paths).toEqual(["/samples/sme-loan-disbursement.pdf"]);
    expect(file.name).toBe("sme-loan-disbursement.pdf");
    expect(file.type).toBe("application/pdf");
    // The name rule of loadFile: the default process name.
    expect(file.name.replace(/\.[^.]+$/, "")).toBe("sme-loan-disbursement");
    const result = await extractParagraphs(await file.arrayBuffer());
    expect(result.paragraphs.length).toBeGreaterThan(0);
  });

  test("ux2i: a 404 answer rejects", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
    await expect(fetchSample("/samples/x.pdf", "x.pdf")).rejects.toThrow("404");
  });

  test("ux2j: a network error rejects", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchSample("/samples/x.pdf", "x.pdf")).rejects.toThrow("Failed to fetch");
  });
});
