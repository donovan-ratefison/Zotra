// The version lifecycle actions of the top bar: the export of the
// definition, the freeze of the opened draft, the publish of a frozen
// version and the new draft from any version. The component holds no
// query and no query client: the shell passes the version list and
// the invalidation callback (the pattern of lot 3.1: queries in the
// screen, props down).

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { ApiError, freezeVersion, forkVersion, publishVersion } from "./api";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
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
            Loading the versions.
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

export function VersionActions({ def, version, versions,
  versionsPending, onVersionsChanged }: {
  def: ProcessDefinition;
  version: VersionSummary;
  versions: VersionSummary[];
  versionsPending: boolean;
  onVersionsChanged: () => void;
}) {
  const [dialog, setDialog] = useState<
    "freeze" | "publish" | "newdraft" | null
  >(null);
  const [busy, setBusy] = useState<
    "freeze" | "publish" | "newdraft" | null
  >(null);
  // The version that new cases run, or null before the first publish.
  const publishedNumber = versions.reduce<number | null>(
    (best, row) => (row.status === "published" && (best === null || row.number > best) ? row.number : best),
    null,
  );

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
      await freezeVersion(version.id);
      setDialog(null);
      toast.success(`v${version.number} frozen.`);
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
      await publishVersion(version.id);
      setDialog(null);
      toast.success(`v${version.number} published. It applies to new cases.`);
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
      const created = await forkVersion(version.id, label);
      setDialog(null);
      toast.success(`Draft v${created.number} created.`);
      onVersionsChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "The action did not complete.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download aria-hidden="true" />
          Export
        </Button>
        {version.status === "draft" && (
          <Button size="sm" onClick={() => setDialog("freeze")}>
            Freeze version
          </Button>
        )}
        {version.status === "frozen" && (
          <>
            <Button size="sm" onClick={() => setDialog("publish")}>
              Publish
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("newdraft")}>
              New draft from this version
            </Button>
          </>
        )}
        {version.status === "published" && (
          <Button size="sm" onClick={() => setDialog("newdraft")}>
            New draft from this version
          </Button>
        )}
      </div>
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
            version={version}
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
            version={version}
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
            version={version}
            busy={busy === "newdraft"}
            onCreate={(label) => void onCreateDraft(label)}
            onCancel={() => setDialog(null)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
