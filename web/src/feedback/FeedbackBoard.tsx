// The board of the reported remarks, at /_feedback.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Label } from "@/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Textarea } from "@/ui/textarea";
import {
  feedbackImageURL,
  listFeedback,
  reopenFeedback,
  verifyFeedback,
  type FeedbackItem,
} from "./api";

// KIND_LABELS maps the kind of the API to its display text. It lives
// in this file only: only the badge reads it.
const KIND_LABELS: Record<string, string> = {
  bug: "Bug",
  adjust: "Adjustment",
  question: "Question",
};

// The five tabs, in contract order. The value is the raw status.
const TABS: { value: string; label: string }[] = [
  { value: "fixed", label: "To verify" },
  { value: "open", label: "Open" },
  { value: "in_lot", label: "In lot" },
  { value: "question", label: "Question" },
  { value: "verified", label: "Verified" },
];

// formatDate renders the RFC 3339 UTC date of the API as
// YYYY-MM-DD HH:mm.
function formatDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function FeedbackBoard() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // reload reads the whole list. A null answer (the API is absent)
  // keeps the tabs with zero counts and no items.
  const reload = useCallback(
    () => listFeedback().then((list) => setItems(list ?? [])),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const verify = async (id: string) => {
    try {
      await verifyFeedback(id);
      await reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const reopen = async () => {
    if (reopenId === null) return;
    try {
      await reopenFeedback(reopenId, note);
      setReopenId(null);
      setNote("");
      await reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Feedback</h1>
      <Tabs defaultValue="fixed">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label} ({items.filter((i) => i.status === t.value).length})
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent
            key={t.value}
            value={t.value}
            className="flex flex-col gap-3 pt-2"
          >
            {items
              .filter((i) => i.status === t.value)
              .map((item) => (
                <div
                  key={item.id}
                  data-testid={`feedback-item-${item.id}`}
                  className="flex flex-col gap-2 rounded-lg border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">#{item.id}</span>
                    <Badge>{KIND_LABELS[item.kind]}</Badge>
                    <a
                      href={item.url}
                      className="text-sm text-primary underline underline-offset-4"
                    >
                      {item.url}
                    </a>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(item.created_at)}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{item.text}</p>
                  {item.image !== null && (
                    <a
                      href={feedbackImageURL(item.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="w-fit"
                    >
                      <img
                        src={feedbackImageURL(item.id)}
                        width={160}
                        alt=""
                        className="rounded border"
                      />
                    </a>
                  )}
                  {item.understood !== null && (
                    <p className="text-sm">
                      <span className="font-medium">Understood:</span>{" "}
                      {item.understood}
                    </p>
                  )}
                  {item.fix.length >= 1 && (
                    <div className="text-sm">
                      <span className="font-medium">Fix:</span>
                      <ul className="list-disc pl-5">
                        {item.fix.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {item.fixed_commit !== null && (
                    <p className="text-sm">
                      <span className="font-medium">Fix commit:</span>{" "}
                      {item.fixed_commit}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {item.status === "fixed" && (
                      <Button size="sm" onClick={() => void verify(item.id)}>
                        Verified
                      </Button>
                    )}
                    {(item.status === "fixed" || item.status === "verified") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReopenId(item.id);
                          setNote("");
                        }}
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              ))}
          </TabsContent>
        ))}
      </Tabs>
      <Dialog
        open={reopenId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReopenId(null);
            setNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reopen</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reopen-note">What is still wrong?</Label>
            <Textarea
              id="reopen-note"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReopenId(null);
                setNote("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void reopen()} disabled={note.length === 0}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
