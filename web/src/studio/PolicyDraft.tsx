// The policy draft dialog: the AI draft of the policy text for the
// changes of one version since version 1. Each changed paragraph shows
// its old text struck and its new text highlighted. Nothing is stored:
// the designer can download the draft as Markdown or as branded HTML.

import { Download } from "lucide-react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/ui/dialog";
import type { PolicyDraft } from "./ai-api";
import { ApiError } from "./api";
import { draftHtmlFile } from "./draft-html";
import type { Paragraph } from "./policy";
import type { ProcessDefinition, VersionSummary } from "./types";
import { docLinks } from "./version-actions";

export type DraftBlock =
  | { kind: "same"; text: string }
  | { kind: "changed"; old: string; text: string; reason: string }
  | { kind: "added"; text: string; reason: string; step: string };

// draftBlocks gives the full policy text in order: each paragraph,
// changed or the same, then the additions that follow it.
export function draftBlocks(
  paragraphs: Paragraph[],
  draft: PolicyDraft,
  def: ProcessDefinition,
): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  for (const p of paragraphs) {
    const c = draft.changed.find((x) => x.paragraph_id === p.id);
    blocks.push(
      c === undefined
        ? { kind: "same", text: p.text }
        : { kind: "changed", old: p.text, text: c.new_text, reason: c.reason },
    );
    for (const a of draft.added.filter((x) => x.after_paragraph_id === p.id)) {
      const step = def.nodes.find((n) => n.id === a.step_id)?.name ?? a.step_id;
      blocks.push({ kind: "added", text: a.text, reason: a.reason, step });
    }
  }
  return blocks;
}

// draftMarkdown writes the draft as one Markdown file.
export function draftMarkdown(title: string, baseNumber: number, blocks: DraftBlock[]): string {
  const parts = [
    `# ${title}: policy draft`,
    `Changes since version ${baseNumber}. The AI wrote this draft. The bank reviews it before any use.`,
    ...blocks.map((b) =>
      b.kind === "same"
        ? b.text
        : b.kind === "changed"
          ? `~~${b.old}~~\n\n${b.text}\n\n*Reason: ${b.reason}*`
          : `${b.text}\n\n*New for step ${b.step}. Reason: ${b.reason}*`,
    ),
  ];
  return `${parts.join("\n\n")}\n`;
}

export type DraftStatus = "idle" | "pending" | "error" | "success";

// PolicyDraftView is the body of the dialog. It holds no state: the
// shell owns the request.
export function PolicyDraftView({ status, draft, blocks, error }: {
  status: DraftStatus;
  draft?: PolicyDraft;
  blocks: DraftBlock[];
  error?: string;
}) {
  if (status === "error") {
    return (
      <p className="text-sm" style={{ color: "#dc2626" }}>
        {`The draft did not load. ${error ?? ""}`}
      </p>
    );
  }
  if (status !== "success" || draft === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <BrandLoader size={16} label="The AI writes the draft..." />
      </p>
    );
  }
  const reason = (text: string) => (
    <p className="text-[12px] text-muted-foreground">{text}</p>
  );
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        {`Changes since version ${draft.base_number}. The AI wrote this draft: the bank reviews it.`}
      </p>
      {draft.changed.length === 0 && draft.added.length === 0 && (
        <p>The AI found no paragraph to update.</p>
      )}
      {draft.dropped > 0 && (
        <p className="text-muted-foreground">
          {`The server refused ${draft.dropped} AI items with an unknown paragraph or element.`}
        </p>
      )}
      {blocks.map((b, i) =>
        b.kind === "same" ? (
          <p key={i}>{b.text}</p>
        ) : b.kind === "changed" ? (
          <div key={i} className="flex flex-col gap-1">
            <p><del className="text-muted-foreground line-through">{b.old}</del></p>
            <p><ins className="bg-yellow-100 no-underline">{b.text}</ins></p>
            {reason(`Reason: ${b.reason}`)}
          </div>
        ) : (
          <div key={i} className="flex flex-col gap-1">
            <p><ins className="bg-yellow-100 no-underline">{b.text}</ins></p>
            {reason(`New for step ${b.step}. Reason: ${b.reason}`)}
          </div>
        ),
      )}
    </div>
  );
}

export function PolicyDraftActions({ ready, onMarkdown, onHtml, onClose }: {
  ready: boolean;
  onMarkdown: () => void;
  onHtml: () => void;
  onClose: () => void;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" disabled={!ready} onClick={onMarkdown}>
        <Download aria-hidden="true" />
        Download Markdown
      </Button>
      <Button variant="outline" disabled={!ready} onClick={onHtml}>
        <Download aria-hidden="true" />
        Download HTML
      </Button>
      <Button onClick={onClose}>Close</Button>
    </DialogFooter>
  );
}

export function PolicyDraftDialog({ open, onOpenChange, def, version, paragraphs, status, draft, error }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  def: ProcessDefinition;
  version: VersionSummary;
  paragraphs: Paragraph[];
  status: DraftStatus;
  draft?: PolicyDraft;
  error?: string;
}) {
  const blocks = draft === undefined ? [] : draftBlocks(paragraphs, draft, def);

  // saveFile saves body as one file, the way the export of the
  // definition does.
  function saveFile(body: string, type: string, name: string) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement("a");
    a.download = name;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onDownload() {
    if (draft === undefined) {
      return;
    }
    saveFile(
      draftMarkdown(def.name, draft.base_number, blocks),
      "text/markdown",
      docLinks(def, version).mdName.replace(/\.md$/, "-policy-draft.md"),
    );
  }

  function onDownloadHtml() {
    if (draft === undefined) {
      return;
    }
    draftHtmlFile(def, version, draft.base_number, blocks).then(
      (f) => saveFile(f.html, "text/html", f.name),
      (e: unknown) =>
        toast(`The export failed. ${e instanceof ApiError ? e.message : "Network error."}`),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[85vh] max-w-3xl flex-col sm:max-w-3xl"
      >
        <DialogTitle>Policy draft</DialogTitle>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <PolicyDraftView status={status} draft={draft} blocks={blocks} error={error} />
        </div>
        <PolicyDraftActions
          ready={status === "success"}
          onMarkdown={onDownload}
          onHtml={onDownloadHtml}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
