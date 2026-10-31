// The policy draft as one printable HTML file, in the look of the
// documentation page: the bank profile, a cover block and an A4 print
// layout. The draft is not stored, so the browser builds the file. The
// css copies the values of the server page: change both together.

import { fetchBank, logoDataURI } from "./api";
import { isHexColor } from "./BankSettings";
import type { DraftBlock } from "./PolicyDraft";
import { escapeHtml } from "./PolicyPanel";
import type { ProcessDefinition, VersionStatus, VersionSummary } from "./types";
import { STATUS_BADGE, docLinks } from "./version-actions";

export type DraftCover = {
  bankName: string;
  primaryColor: string;
  accentColor: string;
  logoURI: string;
  processName: string;
  version: number;
  status: VersionStatus;
  date: string;
  baseNumber: number;
};

// baseLine is the line that says what the draft compares: base 0 is
// version 1, checked against its own process file.
export function baseLine(baseNumber: number): string {
  return baseNumber === 0 ? "Checked against the current process file." : `Changes since version ${baseNumber}.`;
}

// cssString quotes s as a CSS string that cannot close the style
// element.
export function cssString(s: string): string {
  return `"${s.replace(/[\\"<\n]/g, (c) => ({ "\\": "\\\\", '"': '\\"', "<": "\\3c ", "\n": "\\a " })[c] ?? c)}"`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// dateLabel gives the UTC date as "29 Oct 2026".
export function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const CSS = `*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;padding:32px 16px;background:#f4f4f5;color:#18181b;font:15px/1.55 Inter,system-ui,sans-serif}
.sheet{max-width:820px;margin:0 auto;padding:56px 64px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06)}
.cover{display:flex;justify-content:space-between;gap:32px;padding-bottom:24px;margin-bottom:24px;border-bottom:2px solid var(--accent)}
.bank{display:flex;align-items:center;gap:12px;font-weight:600;color:var(--primary)}
.bank img{max-height:48px;max-width:160px}
.cover h1{margin:0 0 8px;font-size:26px;line-height:1.25;color:var(--primary);text-align:right}
.meta,.gen{margin:0;text-align:right;color:#52525b}
.gen{font-size:12px;color:#71717a}
.badge{display:inline-block;padding:0 8px;border:1px solid var(--primary);border-radius:9999px;color:var(--primary);font-size:12px;font-weight:600}
.note{color:#52525b}
.draft p{margin:0 0 12px}
del{color:#71717a}
ins{text-decoration:none;background:#fef9c3}
.block{border-left:3px solid var(--accent);padding-left:12px;margin:0 0 12px}
.block p{margin:0 0 4px}
.reason{font-size:12px;color:#52525b}
@media print{body{font-size:10.5pt;padding:0;background:none}.sheet{max-width:none;padding:0;box-shadow:none}
.block,p{break-inside:avoid}}`;

const box = ";font-size:8pt;color:#71717a}";

// draftHTML renders the draft blocks as one file with the bank profile.
export function draftHTML(c: DraftCover, blocks: DraftBlock[]): string {
  const n = escapeHtml(c.processName);
  const t = `${n}: policy draft`;
  const p = isHexColor(c.primaryColor) ? c.primaryColor : "#0f4c45";
  const a = isHexColor(c.accentColor) ? c.accentColor : "#b8913a";
  const bank = escapeHtml(c.bankName);
  const logo = c.logoURI === "" ? "" : `<img src="${escapeHtml(c.logoURI)}" alt="${bank}">`;
  const none = !blocks.some((b) => b.kind !== "same");
  const body = blocks
    .map((b) =>
      b.kind === "same"
        ? `<p>${escapeHtml(b.text)}</p>`
        : b.kind === "changed"
          ? `<div class="block"><p><del>${escapeHtml(b.old)}</del></p><p><ins>${escapeHtml(b.text)}</ins></p><p class="reason">Reason: ${escapeHtml(b.reason)}</p></div>`
          : `<div class="block"><p><ins>${escapeHtml(b.text)}</ins></p><p class="reason">New for step ${escapeHtml(b.step)}. Reason: ${escapeHtml(b.reason)}</p></div>`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${t}, v${c.version}</title><style>
:root{--primary:${p};--accent:${a}}
@page{size:A4;margin:18mm;@top-left{content:${cssString(c.bankName)}${box}@top-right{content:${cssString(`${c.processName}: policy draft`)}${box}@bottom-left{content:"v${c.version}"${box}@bottom-right{content:"page " counter(page) " of " counter(pages)${box}}
${CSS}
</style></head><body>
<main class="sheet"><header class="cover"><div class="bank">${logo}<span>${bank}</span></div><div><h1>${t}</h1><p class="meta">v${c.version} <span class="badge">${STATUS_BADGE[c.status][0]}</span> <span>${dateLabel(c.date)}</span></p><p class="gen">${baseLine(c.baseNumber)} The AI wrote this draft. The bank reviews it before any use.</p></div></header>
${none ? `<p class="note">The AI found no paragraph to update.</p>\n` : ""}<section class="draft">
${body}
</section></main></body></html>
`;
}

// draftHtmlFile reads the bank profile and its logo, and gives the
// file name and the HTML of the draft.
export async function draftHtmlFile(
  def: ProcessDefinition,
  version: VersionSummary,
  baseNumber: number,
  blocks: DraftBlock[],
): Promise<{ name: string; html: string }> {
  const bank = await fetchBank();
  const logoURI = await logoDataURI(bank.logo_url);
  const html = draftHTML(
    {
      bankName: bank.name,
      primaryColor: bank.primary_color,
      accentColor: bank.accent_color,
      logoURI,
      processName: def.name,
      version: version.number,
      status: version.status,
      date: version.frozen_at ?? version.created_at,
      baseNumber,
    },
    blocks,
  );
  return { name: docLinks(def, version).mdName.replace(/\.md$/, "-policy-draft.html"), html };
}
