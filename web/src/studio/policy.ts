// The policy import: it reads a PDF with pdf.js and cuts the text
// into numbered paragraphs, one id p<page>-<index> per paragraph.

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { ApiError, fetchPolicy } from "./api";

// The browser needs the worker asset URL. In node (the tests) pdf.js
// loads its fake worker itself; a ?url value here breaks its loader.
if (!import.meta.env.SSR) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

export interface Paragraph {
  id: string;
  text: string;
}

// One text item of a PDF page, with its position, width and text
// height in points.
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// pdfItemsOf gives one PdfItem for each pdf.js content item, at the
// same index. A marked content item has no text: it becomes an empty
// item.
export function pdfItemsOf(
  items: ReadonlyArray<
    | { str: string; transform: number[]; width: number; height: number }
    | { type: string }
  >,
): PdfItem[] {
  return items.map((it) =>
    "str" in it
      ? {
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width,
          height: it.height,
        }
      : { str: "", x: 0, y: 0, width: 0, height: 0 },
  );
}

// One line of text: the y and the text height of its first item, its
// text, the right edge of its last item, and the indexes of its items.
interface TextLine {
  y: number;
  height: number;
  text: string;
  end: number;
  members: number[];
}

// paragraphsOfItems turns the items of one page into paragraphs:
// empty items go, the rest forms lines, the lines form paragraphs at
// the bigger vertical gaps, and each paragraph gets an id
// p<page>-<index>, 1-based per page.
export function paragraphsOfItems(
  page: number,
  items: readonly PdfItem[],
): Paragraph[] {
  return cut(page, items).paragraphs;
}

// paragraphIdsOfItems gives the paragraph id of each item, at its
// index, with the same cut as paragraphsOfItems. A blank item gets null.
export function paragraphIdsOfItems(
  page: number,
  items: readonly PdfItem[],
): (string | null)[] {
  return cut(page, items).ids;
}

function cut(
  page: number,
  items: readonly PdfItem[],
): { paragraphs: Paragraph[]; ids: (string | null)[] } {
  const ids: (string | null)[] = items.map(() => null);
  const kept = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.str.trim() !== "");
  const sorted = [...kept].sort((a, b) => b.it.y - a.it.y || a.it.x - b.it.x);
  const lines: TextLine[] = [];
  for (const { it, i } of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(it.y - line.y) <= 2) {
      // pdf.js splits a word at a ligature ("o", "ff", "icer"): the
      // pieces touch, so they join with no space.
      line.text += (it.x - line.end > 1 ? " " : "") + it.str;
      line.end = it.x + it.width;
      line.members.push(i);
    } else {
      lines.push({
        y: it.y,
        height: it.height,
        text: it.str,
        end: it.x + it.width,
        members: [i],
      });
    }
  }
  // The gaps between consecutive lines decide the paragraph cuts.
  const gaps: number[] = [];
  for (let k = 1; k < lines.length; k++) {
    gaps.push(lines[k - 1].y - lines[k].y);
  }
  // The base is the line spacing: the 20th percentile of the gaps that
  // are at least the text height of the lower line (table rows are
  // closer), or of all gaps if none is. No gap means no cut.
  let threshold = Infinity;
  if (gaps.length > 0) {
    const tall = gaps.filter((g, k) => g >= lines[k + 1].height);
    const base = [...(tall.length > 0 ? tall : gaps)].sort((a, b) => a - b);
    threshold = 1.25 * base[Math.floor(0.2 * (base.length - 1))];
  }
  const paragraphs: Paragraph[] = [];
  let index = 0;
  for (let k = 0; k < lines.length; k++) {
    const text = lines[k].text.replace(/\s+/g, " ").trim();
    if (
      k === 0 ||
      // A gap over 1.25 times the line spacing starts a paragraph.
      gaps[k - 1] > threshold ||
      // A change of text height (a title, a heading) starts one.
      Math.abs(lines[k].height - lines[k - 1].height) > 0.5 ||
      // A numbered section line ("2. Scope", "1.2 Rates") starts one.
      /^\d+\.(\d+\.?)*\s/.test(text)
    ) {
      index++;
      paragraphs.push({ id: `p${page}-${index}`, text });
    } else {
      paragraphs[paragraphs.length - 1].text += ` ${text}`;
    }
    for (const i of lines[k].members) {
      ids[i] = `p${page}-${index}`;
    }
  }
  return { paragraphs, ids };
}

// extractParagraphs reads one PDF and returns the page count and the
// paragraphs of every page, in page order. Bytes that pdf.js refuses
// reject with the pdf.js error.
export async function extractParagraphs(data: ArrayBuffer): Promise<{
  pages: number;
  paragraphs: Paragraph[];
}> {
  const doc = await pdfjsLib
    .getDocument({ data: new Uint8Array(data) })
    .promise;
  const paragraphs: Paragraph[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const pdfPage = await doc.getPage(page);
    const content = await pdfPage.getTextContent();
    paragraphs.push(...paragraphsOfItems(page, pdfItemsOf(content.items)));
  }
  return { pages: doc.numPages, paragraphs };
}

// policyErrorText is the error line of the dialog for any failure of
// the AI call. An ApiError gives its message, anything else gives the
// generic line.
export function policyErrorText(err: unknown): string {
  return err instanceof ApiError ? err.message : "The analysis did not run.";
}

// loadStoredPolicy reads the stored PDF of a process and cuts it with
// the same function as the import, so the citation ids match. No
// stored file gives null.
export async function loadStoredPolicy(
  processId: string,
): Promise<{ file: File; paragraphs: Paragraph[] } | null> {
  const file = await fetchPolicy(processId);
  if (file === null) {
    return null;
  }
  const { paragraphs } = await extractParagraphs(await file.arrayBuffer());
  return { file, paragraphs };
}

export type PolicyStatus = "ready" | "loading" | "error";

interface PolicyFile {
  file: File;
  paragraphs: Paragraph[];
}

// policySource picks the policy file and paragraphs of the panel. The
// first rule that applies wins: the open proposal, no process, the
// memory file of this process, then the stored file of the process.
export function policySource(
  proposal: PolicyFile | null,
  memory: (PolicyFile & { processId: string }) | null,
  processId: string | null,
  stored: {
    status: "pending" | "error" | "success";
    data: PolicyFile | null | undefined;
  },
): { file: File | null; paragraphs: Paragraph[]; status: PolicyStatus } {
  if (proposal !== null) {
    return { file: proposal.file, paragraphs: proposal.paragraphs, status: "ready" };
  }
  if (processId === null) {
    return { file: null, paragraphs: [], status: "ready" };
  }
  if (memory?.processId === processId) {
    return { file: memory.file, paragraphs: memory.paragraphs, status: "ready" };
  }
  if (stored.status === "pending") {
    return { file: null, paragraphs: [], status: "loading" };
  }
  if (stored.status === "error") {
    return { file: null, paragraphs: [], status: "error" };
  }
  if (stored.data == null) {
    return { file: null, paragraphs: [], status: "ready" };
  }
  return { file: stored.data.file, paragraphs: stored.data.paragraphs, status: "ready" };
}
