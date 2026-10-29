// The documents card of the step screen: one row per required
// document, the attach controls, the drop zone, the scans of the
// case, and the signature block. Nothing runs here: the upload goes
// through onUpload (TestScreen owns the documents cache) and the sign
// goes through onCommand. The card holds one scan dialog at a time.

import { useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Separator } from "@/ui/separator";
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

// RequiredRow is one required document name with its status and, on
// a missing row, one hidden file input with its Attach button.
function RequiredRow({ name, provided, showControl, onPick }: {
  name: string;
  provided: boolean;
  showControl: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[13px]">{name}</span>
      {provided ? (
        <span className="text-[12px] text-muted-foreground">Attached</span>
      ) : (
        <>
          <span className="text-[12px] text-destructive">
            Required document missing
          </span>
          {showControl && (
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
                onClick={() => inputRef.current?.click()}
              >
                Attach
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
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
      className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-4 text-center"
    >
      <p className="text-sm font-semibold">
        Drop a scan here or click to choose one.
      </p>
      <p className="text-[12px] text-muted-foreground">
        PNG or JPG, 10 MiB at most. The file goes to the first missing
        document.
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

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <h4 className="text-sm font-medium">Documents</h4>
      {node.documents.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {`${providedCount} of ${node.documents.length} required`}
        </p>
      )}
      {documentsError !== null ? (
        <p className="text-destructive text-sm">
          {`The documents did not load: ${documentsError}`}
        </p>
      ) : documents === null ? (
        <p className="text-sm text-muted-foreground">Loading the documents.</p>
      ) : (
        <>
          {node.documents.map((name) => (
            <RequiredRow
              key={name}
              name={name}
              provided={!missing.includes(name)}
              showControl={!readOnly && !uploading}
              onPick={(file) => attach(file, name)}
            />
          ))}
          {missing.length > 0 && !readOnly && (
            <DropZone
              uploading={uploading}
              onPick={(file) => attach(file, missing[0]!)}
            />
          )}
          <div className="flex flex-col gap-2">
            {list.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px]">{d.name}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {`${d.mime} · ${new Date(d.created_at).toLocaleString(
                      "en-IE",
                      { timeZone: "UTC" },
                    )}`}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialog({ doc: d, mode: "view" })}
                >
                  View
                </Button>
              </div>
            ))}
          </div>
          {node.signature && (
            <>
              <Separator />
              <div className="flex flex-col gap-1.5">
                <p className="text-[12px] font-semibold uppercase text-muted-foreground">
                  Signature
                </p>
                {signed ? (
                  <p className="text-[13px]">Signed.</p>
                ) : readOnly ? (
                  <p className="text-[13px]">Not signed.</p>
                ) : list.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">
                    No scans yet.
                  </p>
                ) : (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Document to sign</span>
                    <div className="flex items-center gap-2">
                      <Select
                        value={selectedScan?.id ?? ""}
                        onValueChange={setSignId}
                      >
                        <SelectTrigger aria-label="Document to sign" className="w-full">
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
                        onClick={() => {
                          if (selectedScan) {
                            setDialog({ doc: selectedScan, mode: "sign" });
                          }
                        }}
                      >
                        Sign
                      </Button>
                    </div>
                  </label>
                )}
              </div>
            </>
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
    </div>
  );
}
