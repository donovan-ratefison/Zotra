// The import dialog: drop a policy PDF, read it with pdf.js, send
// the paragraphs to the AI, and hand the proposal to the shell for
// review. Nothing is saved here: the shell creates the process and
// the draft when the designer accepts. The body is a plain
// component, so the tests render it with no Dialog context: the
// title and the description are plain elements.

import { useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { ApiError, policyToProcess } from "./api";
import { extractParagraphs, policyErrorText, type Paragraph } from "./policy";
import type { ProcessDefinition } from "./types";

// Detail is one validation error of a 422 answer.
interface Detail {
  path: string;
  message: string;
}

export function ImportDialogBody({
  onProposed,
  onClose,
}: {
  onProposed: (
    name: string,
    definition: ProcessDefinition,
    paragraphs: Paragraph[],
    file: File,
  ) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [baseName, setBaseName] = useState("");
  const [name, setName] = useState("");
  const [reading, setReading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [details, setDetails] = useState<Detail[] | null>(null);

  // reset clears every state of the body, after a close or a saved
  // import.
  function reset() {
    setFile(null);
    setPages(0);
    setParagraphs([]);
    setBaseName("");
    setName("");
    setReading(false);
    setLoadError(false);
    setAnalyzing(false);
    setAnalysisError(null);
    setDetails(null);
  }

  // loadFile reads one picked or dropped file into paragraphs.
  async function loadFile(picked: File) {
    setReading(true);
    setLoadError(false);
    setAnalysisError(null);
    setDetails(null);
    try {
      const buffer = await picked.arrayBuffer();
      const result = await extractParagraphs(buffer);
      const base = picked.name.replace(/\.[^.]+$/, "");
      setFile(picked);
      setPages(result.pages);
      setParagraphs(result.paragraphs);
      setBaseName(base);
      setName(base);
    } catch {
      setFile(null);
      setLoadError(true);
    } finally {
      setReading(false);
    }
  }

  // analyze sends the paragraphs and, on success, hands the proposal
  // to the shell.
  async function analyze() {
    const current = file;
    if (!current || analyzing) {
      return;
    }
    const useName = name.trim() || baseName;
    setAnalyzing(true);
    setAnalysisError(null);
    setDetails(null);
    let definition: ProcessDefinition;
    try {
      const answer = await policyToProcess(useName, paragraphs);
      definition = answer.definition;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.code === "invalid_output") {
        setDetails(
          err.details.map((d) => {
            const row = (d ?? {}) as { path?: unknown; message?: unknown };
            return {
              path: typeof row.path === "string" ? row.path : "",
              message: typeof row.message === "string" ? row.message : "",
            };
          }),
        );
      } else {
        setAnalysisError(policyErrorText(err));
      }
      setAnalyzing(false);
      return;
    }
    onProposed(useName, definition, paragraphs, current);
    reset();
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg leading-none font-semibold">New from policy</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          The AI reads the policy and proposes the process. You review the
          result before it is saved.
        </p>
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Policy PDF"
        className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground hover:bg-accent/50"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const picked = e.dataTransfer.files[0];
          if (picked) {
            void loadFile(picked);
          } else {
            setFile(null);
            setLoadError(true);
          }
        }}
      >
        <span>Drop the policy PDF here, or browse.</span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) {
              void loadFile(picked);
            }
            e.target.value = "";
          }}
        />
      </div>
      {reading && <p className="text-sm text-muted-foreground">Reading the policy...</p>}
      {loadError && (
        <p className="text-sm text-destructive">The file did not read as a PDF.</p>
      )}
      {file && !reading && (
        <div className="flex flex-col gap-2">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-sm text-muted-foreground">
            {pages} pages, {paragraphs.length} paragraphs
          </p>
          <div className="flex flex-col gap-1 rounded-md border p-2 text-xs text-muted-foreground">
            {paragraphs.slice(0, 3).map((p) => (
              <p key={p.id} className="truncate">
                {p.id}: {p.text.slice(0, 80)}
              </p>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="process-name" className="text-sm font-medium">
              Process name
            </label>
            <Input
              id="process-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
      )}
      {details && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-destructive">
            The AI output did not pass validation.
          </p>
          {details.map((d, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {d.path === "" ? "document" : d.path}: {d.message}
            </p>
          ))}
        </div>
      )}
      {analysisError && (
        <p className="text-sm text-destructive">{analysisError}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button onClick={() => void analyze()} disabled={file === null || analyzing}>
          {analyzing ? "Analyzing the policy..." : "Analyze policy"}
        </Button>
      </div>
    </div>
  );
}

export function ImportDialog({
  open,
  onOpenChange,
  onProposed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProposed: (
    name: string,
    definition: ProcessDefinition,
    paragraphs: Paragraph[],
    file: File,
  ) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="New from policy" className="max-h-[85vh] overflow-y-auto">
        <ImportDialogBody
          onProposed={onProposed}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
