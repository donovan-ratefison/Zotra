// The import dialog: drop a policy PDF, read it with pdf.js, send
// the paragraphs to the AI, and hand the proposal to the shell for
// review. Nothing is saved here: the shell creates the process and
// the draft when the designer accepts. The body is a plain
// component, so the tests render it with no Dialog context: the
// title is a plain element and the description is a Hint.

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import { Hint } from "@/ui/hint";
import { Input } from "@/ui/input";
import { ApiError, policyToProcess } from "./api";
import { extractParagraphs, policyErrorText, type Paragraph } from "./policy";
import type { ProcessDefinition } from "./types";

// Detail is one validation error of a 422 answer.
interface Detail {
  path: string;
  message: string;
}

// elapsedText gives m:ss of the whole seconds. A negative or
// non-finite value gives 0:00.
export function elapsedText(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const rest = total % 60;
  return `${Math.floor(total / 60)}:${rest < 10 ? "0" : ""}${rest}`;
}

// isAbort is true for the error of an aborted request: the dialog
// shows no error text for it.
export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// The inner bar slides from left to right in a loop. Under reduced
// motion it stays still.
const BAR_CSS = `
@keyframes zanalyze { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.zanalyze { animation: zanalyze 1.5s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .zanalyze { animation: none; } }
`;

// AnalyzeProgress shows that the AI analysis runs: a spinner, the
// size of the work, a moving bar and the elapsed time.
export function AnalyzeProgress({ paragraphs, seconds }: { paragraphs: number; seconds: number }) {
  return (
    <>
      <style>{BAR_CSS}</style>
      <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Analyzing the policy
        </div>
        <p className="text-sm text-muted-foreground">
          {`The AI reads ${paragraphs} ${paragraphs === 1 ? "paragraph" : "paragraphs"} and drafts the process.`}
        </p>
        <div data-testid="analyze-bar" className="h-1 overflow-hidden rounded bg-muted">
          <div className="zanalyze h-full w-2/5 rounded bg-primary" />
        </div>
        <p className="text-xs text-muted-foreground">{`Elapsed ${elapsedText(seconds)}`}</p>
      </div>
    </>
  );
}

// analyzeDisabled is true when the dialog cannot send the policy:
// no file, an analysis that runs, or a file with no text (a scan).
export function analyzeDisabled(hasFile: boolean, analyzing: boolean, paragraphs: number): boolean {
  return !hasFile || analyzing || paragraphs === 0;
}

// NoTextNotice tells that the PDF has no text layer for the AI.
export function NoTextNotice() {
  return (
    <p role="alert" className="text-sm text-destructive">
      This PDF has no readable text. It is a scan or a photo. Use a PDF that holds text.
    </p>
  );
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
  const [seconds, setSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Count the seconds of the analysis, from the click.
  useEffect(() => {
    if (!analyzing) {
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setSeconds((Date.now() - start) / 1000), 1000);
    return () => clearInterval(id);
  }, [analyzing]);

  // A close by Esc or the overlay unmounts the body: abort the request.
  useEffect(() => () => abortRef.current?.abort(), []);

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
    if (!current || analyzing || paragraphs.length === 0) {
      return;
    }
    const useName = name.trim() || baseName;
    setSeconds(0);
    setAnalyzing(true);
    setAnalysisError(null);
    setDetails(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let definition: ProcessDefinition;
    try {
      const answer = await policyToProcess(useName, paragraphs, ctrl.signal);
      definition = answer.definition;
    } catch (err) {
      if (isAbort(err) || ctrl.signal.aborted) {
        return;
      }
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
    if (ctrl.signal.aborted) {
      return;
    }
    abortRef.current = null;
    onProposed(useName, definition, paragraphs, current);
    reset();
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-lg leading-none font-semibold">New from policy</h2>
        <Hint label="About New from policy">
          The AI reads the policy and proposes the process. You review the
          result before it is saved.
        </Hint>
      </div>
      {analyzing && <AnalyzeProgress paragraphs={paragraphs.length} seconds={seconds} />}
      {!analyzing && (
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
      )}
      {reading && <p className="text-sm text-muted-foreground">Reading the policy...</p>}
      {loadError && (
        <p className="text-sm text-destructive">The file did not read as a PDF.</p>
      )}
      {file && !reading && !analyzing && (
        <div className="flex flex-col gap-2">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-sm text-muted-foreground">
            {pages} pages, {paragraphs.length} paragraphs
          </p>
          {paragraphs.length === 0 ? (
            <NoTextNotice />
          ) : (
            <>
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
            </>
          )}
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
            abortRef.current?.abort();
            abortRef.current = null;
            reset();
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => void analyze()}
          disabled={analyzeDisabled(file !== null, analyzing, paragraphs.length)}
        >
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
      {/* Focus the dialog content, not its first focusable element:
          that is the Hint, and a focus opens its tooltip at each open. */}
      <DialogContent
        aria-label="New from policy"
        className="max-h-[85vh] overflow-y-auto"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <ImportDialogBody
          onProposed={onProposed}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
