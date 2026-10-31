// The documents card of the step screen: one row per required
// document, the attach controls, the drop zone, the scans of the
// case, and the signature block. Nothing runs here: the upload goes
// through onUpload (TestScreen owns the documents cache) and the sign
// goes through onCommand. The card holds one scan dialog at a time.

import { useRef, useState } from "react";
import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Hint } from "@/ui/hint";
import { CheckCircle2, CircleDashed, FileText, PenLine, Upload } from "lucide-react";
import { ScanDialog } from "./ScanDialog";
import type { CommandInput } from "./case-api";
import { readDocumentFields, type DocumentDTO } from "./doc-api";
import type { ProcessNode } from "./types";

// documentProvides tells whether one scan provides one required
// name: an exact match, or the required name as a prefix before the
// extension dot ("ID card.png" provides "ID card").
export function documentProvides(scanName: string, required: string): boolean {
  return scanName === required || scanName.startsWith(required + ".");
}

// extOf gives the extension of a file name, lowercased, with the
// dot: "ID card.png" gives ".png". A name without a dot before its
// end gives "".
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

// RequiredRow is one required document name with its status: the
// providing scan opens with View; a missing row carries one hidden
// file input with its Attach button.
function RequiredRow({ name, scan, showControl, onPick, onView }: {
  name: string;
  scan: DocumentDTO | undefined;
  showControl: boolean;
  onPick: (file: File) => void;
  onView: (doc: DocumentDTO) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const provided = scan !== undefined;
  return (
    <li className="flex min-h-8 items-center gap-2">
      {provided ? (
        <CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <CircleDashed aria-hidden className="size-4 shrink-0 text-destructive" />
      )}
      <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
      <span className="sr-only">{provided ? "Attached" : "Required document missing"}</span>
      {provided ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          title={`${scan.name} · ${scan.mime} · ${utcText(scan.created_at)}`}
          onClick={() => onView(scan)}
        >
          View
        </Button>
      ) : (
        showControl && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onPick(file);
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => inputRef.current?.click()}
            >
              Attach
            </Button>
          </>
        )
      )}
    </li>
  );
}

// utcText gives the delivered UTC date form (the rule of lot 5.2).
function utcText(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", { timeZone: "UTC" });
}

// DropZone is the attach zone: a click, an Enter or Space key, or a
// drop of one file picks it. The file goes to the first missing
// required document. While a upload runs, the zone renders disabled
// and without handlers.
function DropZone({ uploading, onPick }: {
  uploading: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = () => inputRef.current?.click();
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Attach a scan"
      aria-disabled={uploading ? true : undefined}
      onClick={uploading ? undefined : open}
      onKeyDown={
        uploading
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }
      }
      onDragOver={uploading ? undefined : (e) => e.preventDefault()}
      onDrop={
        uploading
          ? undefined
          : (e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) {
                onPick(file);
              }
            }
      }
      className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-center text-muted-foreground hover:bg-muted/50"
    >
      <Upload aria-hidden className="size-3.5 shrink-0" />
      <p className="text-[12.5px]">
        {uploading ? "Uploading the scan." : "Drop a scan here or click to choose one."}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onPick(file);
          }
        }}
      />
    </div>
  );
}

export function StepDocuments({ node, documents, documentsError, uploading, onUpload, onCommand, signed, readOnly = false, onFill, fillTargets }: {
  node: ProcessNode;
  documents: DocumentDTO[] | null;
  documentsError: string | null;
  uploading: boolean;
  onUpload: (file: File, targetName: string) => void;
  onCommand: (cmd: CommandInput) => void;
  signed: boolean;
  readOnly?: boolean;
  onFill?: (values: Record<string, unknown>) => void;
  fillTargets?: { name: string; label: string; type: string }[];
}) {
  const [dialog, setDialog] = useState<{
    doc: DocumentDTO;
    mode: "view" | "sign";
  } | null>(null);
  // The scan to sign; null falls back to the first scan.
  const [signId, setSignId] = useState<string | null>(null);

  const list = documents ?? [];
  const missing = node.documents.filter(
    (name) => !list.some((d) => documentProvides(d.name, name)),
  );
  const providedCount = node.documents.length - missing.length;
  const selectedScan =
    signId === null ? list[0] : list.find((d) => d.id === signId) ?? list[0];
  const attach = (file: File, required: string) =>
    onUpload(file, `${required}${extOf(file.name)}`);

  // The scans that provide no required name: they stay reachable.
  const others = list.filter(
    (d) => !node.documents.some((name) => documentProvides(d.name, name)),
  );

  return (
    <section aria-label="Documents" className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <h4 className="text-[13px] font-semibold">Documents</h4>
        {node.documents.length > 0 && (
          <span className="text-[12px] text-muted-foreground">
            {`${providedCount} of ${node.documents.length} required`}
          </span>
        )}
        <span className="flex-1" />
        <Hint label="About the documents">
          PNG or JPG, 10 MiB at most. A dropped file goes to the first missing
          document. View opens the scan with its detected zones.
        </Hint>
      </div>
      {documentsError !== null ? (
        <p className="text-destructive text-sm">
          {`The documents did not load: ${documentsError}`}
        </p>
      ) : documents === null ? (
        <p className="text-sm text-muted-foreground"><BrandLoader size={16} label="Loading the documents." /></p>
      ) : (
        <>
          {node.documents.length > 0 && (
            <ul className="flex flex-col">
              {node.documents.map((name) => (
                <RequiredRow
                  key={name}
                  name={name}
                  scan={list.find((d) => documentProvides(d.name, name))}
                  showControl={!readOnly && !uploading}
                  onPick={(file) => attach(file, name)}
                  onView={(doc) => setDialog({ doc, mode: "view" })}
                />
              ))}
            </ul>
          )}
          {missing.length > 0 && !readOnly && (
            <DropZone
              uploading={uploading}
              onPick={(file) => attach(file, missing[0]!)}
            />
          )}
          {others.length > 0 && (
            <ul className="flex flex-col">
              {others.map((d) => (
                <li key={d.id} className="flex min-h-8 items-center gap-2">
                  <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[13px]" title={`${d.mime} · ${utcText(d.created_at)}`}>
                    {d.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setDialog({ doc: d, mode: "view" })}
                  >
                    View
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {node.signature && (
            <div className="flex min-h-8 items-center gap-2 border-t pt-2">
              <PenLine aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-[13px] font-medium">Signature</span>
              <span className="flex-1" />
              {signed ? (
                <span className="flex items-center gap-1 text-[13px] text-emerald-700">
                  <CheckCircle2 aria-hidden className="size-4" />
                  Signed.
                </span>
              ) : readOnly ? (
                <span className="text-[13px] text-muted-foreground">Not signed.</span>
              ) : list.length === 0 ? (
                <span className="text-[12px] text-muted-foreground">No scans yet.</span>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5">
                  <Select
                    value={selectedScan?.id ?? ""}
                    onValueChange={setSignId}
                  >
                    <SelectTrigger aria-label="Document to sign" size="sm" className="h-7 max-w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {list.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      if (selectedScan) {
                        setDialog({ doc: selectedScan, mode: "sign" });
                      }
                    }}
                  >
                    Sign
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {dialog !== null && (
        <ScanDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null);
            }
          }}
          doc={dialog.doc}
          mode={dialog.mode}
          onSign={(hash) => {
            onCommand({ type: "sign", document_hash: hash });
            setDialog(null);
          }}
          {...(onFill === undefined || fillTargets === undefined
            ? {}
            : {
                readFields: (doc: DocumentDTO) =>
                  readDocumentFields(doc.id, fillTargets),
                fillTargets,
                onFill: (values: Record<string, unknown>) => {
                  onFill(values);
                  setDialog(null);
                },
              })}
        />
      )}
    </section>
  );
}
