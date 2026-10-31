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

// One text item of a PDF page, with its position in points.
export interface PdfItem {
  str: string;
  x: number;
  y: number;
}

// One line of text: the y of its first item, and its text.
interface TextLine {
  y: number;
  text: string;
}

// paragraphsOfItems turns the items of one page into paragraphs:
// empty items go, the rest forms lines, the lines form paragraphs at
// the bigger vertical gaps, and each paragraph gets an id
// p<page>-<index>, 1-based per page.
export function paragraphsOfItems(
  page: number,
  items: readonly PdfItem[],
): Paragraph[] {
  const kept = items.filter((it) => it.str.trim() !== "");
  const sorted = [...kept].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(it.y - line.y) <= 2) {
      line.text = `${line.text} ${it.str}`.trim();
    } else {
      lines.push({ y: it.y, text: it.str.trim() });
    }
  }
  // The gaps between consecutive lines decide the paragraph cuts.
  const gaps: number[] = [];
  for (let k = 1; k < lines.length; k++) {
    gaps.push(lines[k - 1].y - lines[k].y);
  }
  // The threshold is 1.6 times the lower middle of the sorted gaps
  // (integer division). No gap means no cut.
  let threshold = Infinity;
  if (gaps.length > 0) {
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    threshold = 1.6 * sortedGaps[Math.floor((sortedGaps.length - 1) / 2)];
  }
  const paragraphs: Paragraph[] = [];
  let index = 0;
  for (let k = 0; k < lines.length; k++) {
    if (k === 0 || gaps[k - 1] > threshold) {
      index++;
      paragraphs.push({ id: `p${page}-${index}`, text: lines[k].text });
    } else {
      paragraphs[paragraphs.length - 1].text += ` ${lines[k].text}`;
    }
  }
  return paragraphs;
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
    const items: PdfItem[] = [];
    for (const it of content.items) {
      if ("str" in it) {
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5] });
      }
    }
    paragraphs.push(...paragraphsOfItems(page, items));
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
