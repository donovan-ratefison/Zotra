// The Report button: one probe at start, the pick mode, and the
// report dialog. The idle button is one 24 x 24 icon fixed in the
// bottom-right corner, clear of every app control.
import { useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Label } from "@/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import { Textarea } from "@/ui/textarea";
import { createFeedback, listFeedback } from "./api";
import { buildSelector, stepsFor } from "./selector";

// Pick holds the data of the picked element, or the null fields of a
// skipped pick (Enter).
type Pick = {
  selector: string | null;
  element_text: string | null;
  box: { x: number; y: number; width: number; height: number } | null;
};

type Phase = "idle" | "picking" | "dialog";

// ReportTrigger is the idle Report button: one 24 x 24 icon fixed
// at the bottom-right corner, clear of every app control.
export function ReportTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button
      data-testid="report-button"
      variant="default"
      size="icon-xs"
      aria-label="Report"
      title="Report"
      className="fixed bottom-1 right-1 z-50"
      onClick={onClick}
    >
      <Flag />
    </Button>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ReportButton() {
  const [probe, setProbe] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pick, setPick] = useState<Pick | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [kind, setKind] = useState("bug");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const outlined = useRef<HTMLElement | null>(null);

  // One GET at start: the button shows only when the API answers.
  useEffect(() => {
    void listFeedback().then((list) => setProbe(list !== null));
  }, []);

  // The pick mode, while phase is "picking". The cleanup removes the
  // listeners and clears the outline, for each of the three exits:
  // pick, Enter, Escape.
  useEffect(() => {
    if (phase !== "picking") return;

    const onOver = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el === outlined.current) return;
      if (outlined.current) outlined.current.style.outline = "";
      outlined.current = el;
      el.style.outline = "2px solid var(--primary)";
    };

    const onPick = (e: MouseEvent) => {
      // Capture phase: the click never reaches the app.
      e.preventDefault();
      e.stopPropagation();
      const el = e.target as HTMLElement;
      const r = el.getBoundingClientRect();
      setPick({
        selector: buildSelector(stepsFor(el)),
        element_text: Array.from((el.textContent ?? "").trim())
          .slice(0, 80)
          .join(""),
        box: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      });
      setPhase("dialog");
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        setPick(null);
        setPhase("dialog");
      } else if (e.key === "Escape") {
        setPhase("idle");
      }
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("click", onPick, { capture: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("click", onPick, { capture: true });
      document.removeEventListener("keydown", onKey);
      if (outlined.current) outlined.current.style.outline = "";
      outlined.current = null;
    };
  }, [phase]);

  // The paste listener, while phase is "dialog". A paste event fires
  // on the focused element, so the listener sits on document, not on
  // the zone.
  useEffect(() => {
    if (phase !== "dialog") return;

    const readAsDataURL = (file: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) return;
        readAsDataURL(file)
          .then(setImageData)
          .catch((err: unknown) => toast.error(errorText(err)));
        return;
      }
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [phase]);

  // resetAll closes everything and gives each field its start value.
  const resetAll = () => {
    setPhase("idle");
    setPick(null);
    setImageData(null);
    setText("");
    setKind("bug");
    setSending(false);
  };

  const send = async () => {
    setSending(true);
    try {
      const item = await createFeedback({
        kind,
        text,
        url: location.pathname + location.search,
        selector: pick?.selector ?? null,
        element_text: pick?.element_text ?? null,
        box: pick?.box ?? null,
        viewport: { width: innerWidth, height: innerHeight },
        image_data: imageData,
      });
      toast.success(`Report #${item.id} saved`);
      resetAll();
    } catch (err) {
      toast.error(errorText(err));
      setSending(false);
    }
  };

  if (probe !== true) return null;

  if (phase === "picking") {
    return (
      <div className="fixed inset-x-0 top-0 z-50 bg-primary px-4 py-2 text-center text-sm text-primary-foreground">
        Click the element to report. Press Enter to skip, Esc to cancel.
      </div>
    );
  }

  if (phase === "dialog") {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) resetAll();
        }}
      >
        <DialogContent data-testid="report-dialog" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Report</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {pick?.element_text || "No element"}
            </p>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPick(null);
                  setPhase("picking");
                }}
              >
                Point again
              </Button>
            </div>
            <div className="rounded-md border border-dashed p-3 text-sm">
              <p className="text-muted-foreground">Paste a screenshot (Ctrl+V)</p>
              {imageData !== null && (
                <div className="mt-2 flex flex-col items-start gap-2">
                  <img src={imageData} alt="" className="max-h-48 rounded border" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setImageData(null)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="report-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="adjust">Adjustment</SelectItem>
                  <SelectItem value="question">Question</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-text">Text</Label>
              <Textarea
                id="report-text"
                required
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetAll}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={text.length === 0 || sending}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return <ReportTrigger onClick={() => setPhase("picking")} />;
}
