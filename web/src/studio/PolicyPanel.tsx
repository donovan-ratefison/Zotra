// The policy drawer content: the PDF of the imported policy, with the
// cited paragraphs highlighted. react-pdf loads through a dynamic
// import inside the effect, so the node test environment never sees
// it (its viewer module needs a DOM).

import { useEffect, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Paragraph } from "./policy";

export function isHighlighted(str: string, highlight: Paragraph[]): boolean {
  return (
    highlight.some((p) => p.text.includes(str.trim())) && str.trim() !== ""
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function PolicyPanel({ file, highlight }: {
  file: File | null;
  highlight: Paragraph[];
}) {
  const [mod, setMod] = useState<typeof import("react-pdf") | null>(null);
  // The load error is tied to the file that failed it, so a new file
  // shows the document view again with no reset effect.
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);

  // No file, no module load. The boolean dependency keeps a new file
  // object from re-running the import.
  const hasFile = file !== null;
  useEffect(() => {
    if (!hasFile) {
      return;
    }
    let live = true;
    import("react-pdf").then((m) => {
      // react-pdf holds its own pdfjs entry; its default worker URL
      // does not resolve in this app, so the worker asset takes over.
      m.pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      if (live) {
        setMod(m);
      }
    });
    return () => {
      live = false;
    };
  }, [hasFile]);

  // A new file clears the error of the old one.
  const loadError = file !== null && failedFile === file;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="text-[13px] font-semibold">Policy</span>
        {file !== null && (
          <span className="truncate text-[12px] text-muted-foreground">
            {file.name}
          </span>
        )}
      </div>
      {file === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          No policy file. Ask for an import first.
        </p>
      ) : mod === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Loading the policy...
        </p>
      ) : loadError ? (
        <p className="px-4 py-3 text-sm text-destructive">
          The policy did not load.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <mod.Document
            file={file}
            suspense={false}
            onLoadSuccess={(pdf) => setPageCount(pdf.numPages)}
            onLoadError={() => setFailedFile(file)}
          >
            {Array.from({ length: pageCount }, (_, i) => (
              <mod.Page
                key={i + 1}
                pageNumber={i + 1}
                width={520}
                renderTextLayer
                customTextRenderer={({ str }) =>
                  isHighlighted(str, highlight)
                    ? `<mark class="rounded-sm bg-yellow-200 px-0.5">${escapeHtml(str)}</mark>`
                    : escapeHtml(str)
                }
              />
            ))}
          </mod.Document>
        </div>
      )}
    </div>
  );
}
