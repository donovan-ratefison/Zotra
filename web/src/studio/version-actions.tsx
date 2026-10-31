// The version lifecycle actions of the top bar: the export of the
// definition, the freeze of the opened draft, the publish of a frozen
// version and the new draft from any version. The component holds no
// query and no query client: the shell passes the version list and
// the invalidation callback (the pattern of lot 3.1: queries in the
// screen, props down).

import { useEffect, useRef, useState } from "react";
import { Download, FileText, GitBranch, GitCompareArrows, History, Lock, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError, freezeVersion, forkVersion, publishVersion } from "./api";
import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import type { ProcessDefinition, VersionSummary } from "./types";

// definitionFile names and serializes the export file of one version.
export function definitionFile(
  def: ProcessDefinition,
  version: VersionSummary,
): { name: string; body: string } {
  return {
    name: `process-v${version.number}.json`,
    body: JSON.stringify(def, null, 2),
  };
}

// docLinks gives the links of the documentation menu; the items render
// in a portal, so the rows test this function.
export function docLinks(
  def: ProcessDefinition,
  version: VersionSummary,
): { html: string; md: string; mdName: string } {
  const base = `/api/versions/${encodeURIComponent(version.id)}/doc`;
  const name = def.name.trim().replace(/[\\/:*?"<>|]/g, "-") || "process";
  return { html: `${base}.html`, md: `${base}.md`, mdName: `${name}-v${version.number}.md` };
}

// labelValid accepts a label with at least one non-space character.
export function labelValid(raw: string): boolean {
  return raw.trim().length > 0;
}

export function FreezeDialogBody({ version, busy, onConfirm, onCancel }: {
  version: VersionSummary;
  busy: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold leading-tight">
          {`Freeze the draft of v${version.number}`}
        </h2>
        <p className="text-sm text-muted-foreground">
          {`The draft becomes v${version.number}. It is not editable anymore.`}
        </p>
        <p className="text-sm text-muted-foreground">
          Your next changes need a new draft from this version.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => onConfirm?.()}>
          {`Freeze v${version.number}`}
        </Button>
      </div>
    </div>
  );
}

export function PublishDialogBody({ version, def, publishedNumber,
  versionsPending, busy, onConfirm, onCancel }: {
  version: VersionSummary;
  def: ProcessDefinition;
  publishedNumber: number | null;
  versionsPending: boolean;
  busy: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold leading-tight">
          {`Publish v${version.number}`}
        </h2>
        {versionsPending ? (
          <p className="text-sm text-muted-foreground">
            <BrandLoader size={16} label="Loading the versions." />
          </p>
        ) : publishedNumber !== null ? (
          <p className="text-sm text-muted-foreground">
            {`v${version.number} replaces v${publishedNumber} for new cases.`}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {`This is the first published version of ${def.name}.`}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Cases in progress stay on their version.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => onConfirm?.()}>
          {`Publish v${version.number}`}
        </Button>
      </div>
    </div>
  );
}

export function NewDraftDialogBody({ version, busy, onCreate, onCancel }: {
  version: VersionSummary;
  busy: boolean;
  onCreate: (label: string) => void;
  onCancel: () => void;
}) {
  // The label the designer typed. The body mounts fresh at each
  // dialog open (Radix mounts the content when open), so the label is
  // empty at open without a reset effect.
  const [label, setLabel] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold leading-tight">
          {`New draft from v${version.number}`}
        </h2>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Label</span>
        <Input
          aria-label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy || !labelValid(label)}
          onClick={() => onCreate(label.trim())}
        >
          Create draft
        </Button>
      </div>
    </div>
  );
}

export const STATUS_BADGE: Record<VersionSummary["status"], [text: string, cls: string]> = {
  draft: ["Draft", "border-amber-300 bg-amber-50 text-amber-800"],
  frozen: ["Frozen", "border-blue-300 bg-blue-50 text-blue-800"],
  published: ["Published", "border-emerald-300 bg-emerald-50 text-emerald-800"],
};

export function dateText(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

// newestPublished gives the number of the version that new cases run:
// the highest published number, or null before the first publish.
export function newestPublished(versions: VersionSummary[]): number | null {
  let best: number | null = null;
  for (const row of versions) {
    if (row.status === "published" && (best === null || row.number > best)) best = row.number;
  }
  return best;
}

// statusText names the status of a version. Several versions can be
// published: only the newest one runs new cases, an older one says
// which version replaced it.
export function statusText(row: VersionSummary, newest: number | null): string {
  if (row.status === "published" && newest !== null && row.number < newest) {
    return `Replaced by v${newest}`;
  }
  return STATUS_BADGE[row.status]?.[0] ?? row.status;
}

// HistoryBody is the version history: one card per version, newest
// first, on a vertical line. Each card carries the actions its status
// allows. The opened version carries the Shown badge.
export function HistoryBody({ def, version, versions, onOpen, onCompare, onAction }: {
  def: ProcessDefinition;
  version: VersionSummary;
  versions: VersionSummary[];
  onOpen?: (id: string) => void;
  onCompare?: (id: string) => void;
  onAction: (kind: "freeze" | "publish" | "newdraft", target: VersionSummary) => void;
}) {
  const rows = [...versions].sort((a, b) => b.number - a.number);
  // The newest published version is in view when the panel opens,
  // also when the versions arrive after the open.
  const published = newestPublished(versions);
  const publishedRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    publishedRow.current?.scrollIntoView({ block: "nearest" });
  }, [published]);
  const numberOf = (id: string | null) =>
    id === null ? null : (versions.find((v) => v.id === id)?.number ?? null);
  const drafts = rows.filter((v) => v.status === "draft").length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-5 pt-5 pb-3">
        <h2 className="text-lg font-semibold leading-tight">Version history</h2>
        <p className="text-[13px] text-muted-foreground">
          {`${def.name} · ${rows.length - drafts} ${rows.length - drafts === 1 ? "version" : "versions"}${drafts > 0 ? ` and ${drafts} ${drafts === 1 ? "draft" : "drafts"}` : ""}`}
        </p>
      </div>
      <ol className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <span aria-hidden className="absolute top-6 bottom-6 left-[27px] w-px bg-border" />
        {rows.map((row) => {
          const shown = row.id === version.id;
          const replaced = row.status === "published" && published !== null && row.number < published;
          const badgeCls = replaced ? "border-zinc-300 bg-zinc-50 text-zinc-700" : STATUS_BADGE[row.status][1];
          const parent = numberOf(row.parent_id);
          return (
            <li
              key={row.id}
              ref={row.number === published ? publishedRow : undefined}
              className="relative mb-3 flex gap-3"
            >
              <span
                aria-hidden
                className={`relative z-10 mt-4 size-3 shrink-0 rounded-full border-2 bg-background ${
                  replaced
                    ? "border-zinc-400"
                    : row.status === "published"
                      ? "border-emerald-600"
                      : row.status === "frozen"
                        ? "border-blue-600"
                        : "border-dashed border-amber-500"
                } ${shown ? "ring-4 ring-blue-100" : ""}`}
              />
              <div
                className={`flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border p-3 ${
                  shown ? "border-blue-300 bg-blue-50/40" : row.status === "draft" ? "border-dashed" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[14px] font-semibold">{`v${row.number}`}</span>
                  <span className="min-w-0 truncate text-[14px]">{row.label}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeCls}`}
                    title={replaced ? `New cases start on v${published}. Its cases in progress stay on v${row.number}.` : undefined}
                  >
                    {statusText(row, published)}
                  </span>
                  {shown && (
                    <span className="rounded-full border border-blue-300 bg-background px-2 py-0.5 text-[11px] font-medium text-blue-700">
                      Shown
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground">
                  {`${dateText(row.frozen_at ?? row.created_at)}${parent === null ? "" : ` · from v${parent}`}`}
                </p>
                {row.status === "published" && row.number === published && (
                  <p className="text-[12px] text-emerald-800">New cases start on this version.</p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {!shown && onOpen !== undefined && (
                    <Button variant="outline" size="sm" className="h-7" onClick={() => onOpen(row.id)}>
                      Open
                    </Button>
                  )}
                  {!shown && onCompare !== undefined && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7"
                      aria-label={`Compare v${row.number} with the shown version`}
                      onClick={() => onCompare(row.id)}
                    >
                      <GitCompareArrows aria-hidden="true" />
                      Compare
                    </Button>
                  )}
                  {row.status === "draft" && (
                    <Button variant="outline" size="sm" className="h-7" onClick={() => onAction("freeze", row)}>
                      <Lock aria-hidden="true" />
                      Freeze
                    </Button>
                  )}
                  {row.status === "frozen" && (
                    <Button size="sm" className="h-7" onClick={() => onAction("publish", row)}>
                      <Upload aria-hidden="true" />
                      Publish
                    </Button>
                  )}
                  {row.status !== "draft" && (
                    <Button variant="outline" size="sm" className="h-7" onClick={() => onAction("newdraft", row)}>
                      <GitBranch aria-hidden="true" />
                      New draft from this version
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="border-t px-5 py-3 text-[12px] text-muted-foreground">
        A case in progress stays on the version where it started. Publish
        makes a version active for new cases.
      </p>
    </div>
  );
}

export function VersionActions({ def, version, versions,
  versionsPending, onVersionsChanged, onOpenVersion, onCompareVersion, onUpdatePolicy }: {
  def: ProcessDefinition;
  version: VersionSummary;
  versions: VersionSummary[];
  versionsPending: boolean;
  onVersionsChanged: () => void;
  onOpenVersion?: (id: string) => void;
  onCompareVersion?: (id: string) => void;
  // Set when the process has a policy: the menu offers the AI draft.
  onUpdatePolicy?: () => void;
}) {
  const [dialog, setDialog] = useState<
    "freeze" | "publish" | "newdraft" | null
  >(null);
  // The version the dialogs act on: the opened one from the top bar,
  // any one from the history.
  const [target, setTarget] = useState<VersionSummary>(version);
  const [historyOpen, setHistoryOpen] = useState(false);
  const act = (kind: "freeze" | "publish" | "newdraft", row: VersionSummary) => {
    setTarget(row);
    setDialog(kind);
  };
  const [busy, setBusy] = useState<
    "freeze" | "publish" | "newdraft" | null
  >(null);
  // The version that new cases run, or null before the first publish.
  const publishedNumber = newestPublished(versions);

  // onExport downloads the definition as one JSON file. The anchor
  // lives in the handler: no row can cover a click under
  // renderToString, the pure definitionFile has the rows.
  function onExport() {
    const file = definitionFile(def, version);
    const url = URL.createObjectURL(
      new Blob([file.body], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.download = file.name;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFreeze() {
    if (busy !== null) {
      return;
    }
    setBusy("freeze");
    try {
      await freezeVersion(target.id);
      setDialog(null);
      toast.success(`v${target.number} frozen.`);
      onVersionsChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "The action did not complete.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function onPublish() {
    if (busy !== null) {
      return;
    }
    setBusy("publish");
    try {
      await publishVersion(target.id);
      setDialog(null);
      toast.success(`v${target.number} published. It applies to new cases.`);
      onVersionsChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "The action did not complete.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function onCreateDraft(label: string) {
    if (busy !== null) {
      return;
    }
    setBusy("newdraft");
    try {
      const created = await forkVersion(target.id, label);
      setDialog(null);
      toast.success(`Draft v${created.number} created.`);
      onVersionsChanged();
      if (historyOpen) {
        onOpenVersion?.(created.id);
        setHistoryOpen(false);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "The action did not complete.",
      );
    } finally {
      setBusy(null);
    }
  }

  const links = docLinks(def, version);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
          <History aria-hidden="true" />
          History
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Documentation"
              title="Open or download the documentation"
            >
              <FileText aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={links.html} target="_blank" rel="noopener">
                Open the documentation
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={links.md} download={links.mdName}>
                Download Markdown
              </a>
            </DropdownMenuItem>
            {onUpdatePolicy !== undefined && (
              <DropdownMenuItem onSelect={() => onUpdatePolicy()}>
                <Sparkles aria-hidden="true" />
                Update the policy
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Export"
          title="Export the definition as a JSON file"
          onClick={onExport}
        >
          <Download aria-hidden="true" />
        </Button>
        {version.status === "draft" && (
          <Button size="sm" onClick={() => act("freeze", version)}>
            Freeze version
          </Button>
        )}
        {version.status === "frozen" && (
          <>
            <Button size="sm" onClick={() => act("publish", version)}>
              Publish
            </Button>
            <Button variant="outline" size="sm" aria-label="New draft from this version" onClick={() => act("newdraft", version)}>
              New draft
            </Button>
          </>
        )}
        {version.status === "published" && (
          <Button size="sm" aria-label="New draft from this version" onClick={() => act("newdraft", version)}>
            New draft
          </Button>
        )}
      </div>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent
          aria-label="Version history"
          className="top-0 right-0 left-auto h-full max-h-none w-[420px] max-w-[100vw] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-[420px] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
        >
          <HistoryBody
            def={def}
            version={version}
            versions={versions}
            onOpen={
              onOpenVersion === undefined
                ? undefined
                : (id) => {
                    onOpenVersion(id);
                    setHistoryOpen(false);
                  }
            }
            onCompare={
              onCompareVersion === undefined
                ? undefined
                : (id) => {
                    setHistoryOpen(false);
                    onCompareVersion(id);
                  }
            }
            onAction={act}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === "freeze"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
      >
        <DialogContent aria-label="Freeze version">
          <FreezeDialogBody
            version={target}
            busy={busy === "freeze"}
            onConfirm={() => void onFreeze()}
            onCancel={() => setDialog(null)}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === "publish"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
      >
        <DialogContent aria-label="Publish">
          <PublishDialogBody
            version={target}
            def={def}
            publishedNumber={publishedNumber}
            versionsPending={versionsPending}
            busy={busy === "publish"}
            onConfirm={() => void onPublish()}
            onCancel={() => setDialog(null)}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === "newdraft"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
      >
        <DialogContent aria-label="New draft">
          <NewDraftDialogBody
            version={target}
            busy={busy === "newdraft"}
            onCreate={(label) => void onCreateDraft(label)}
            onCancel={() => setDialog(null)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
