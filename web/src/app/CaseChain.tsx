// The case chain strip of the triage card: one block for each step
// passed, the ghost blocks of the next steps, and the verify walk.

import { Fragment, useEffect, useRef, useState } from "react";
import { Check, Link, Lock, PenTool, ShieldAlert, ShieldCheck } from "lucide-react";
import { ApiError } from "../studio/api";
import type { CaseEvent, UserDTO } from "../studio/case-api";
import { eventLabel } from "../studio/Timeline";
import type { ProcessDefinition } from "../studio/types";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import { Hint } from "@/ui/hint";
import { verifyCase } from "./app-api";
import { actorOf } from "./AuditScreen";
import { chainStatus, seqTone, sheetProgress, walkEnd, type ChainBlock, type VerifyRun } from "./chain";
import { dayTimeText } from "./InboxScreen";
import { Kbd } from "./TriageScreen";

const STEP_MS = 60;

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const out = { ...map };
  delete out[key];
  return out;
}

export function useChainVerify(): {
  runs: Record<string, VerifyRun>;
  errors: Record<string, string>;
  busy: string | null;
  verify: (caseId: string, n: number) => void;
  reset: (caseId: string) => void;
} {
  const [runs, setRuns] = useState<Record<string, VerifyRun>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Blocks a second run before the busy state renders.
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearInterval(timer.current);
    },
    [],
  );

  async function verify(caseId: string, n: number) {
    if (running.current) return;
    running.current = true;
    setBusy(caseId);
    setErrors((old) => without(old, caseId));
    setRuns((old) => without(old, caseId));
    let bad: number;
    try {
      bad = await verifyCase(caseId);
    } catch (e) {
      setErrors((old) => ({ ...old, [caseId]: e instanceof ApiError ? e.message : String(e) }));
      running.current = false;
      setBusy(null);
      return;
    }
    const end = walkEnd({ bad, upTo: 0 }, n);
    let upTo = 0;
    setRuns((old) => ({ ...old, [caseId]: { bad, upTo } }));
    timer.current = setInterval(() => {
      upTo = Math.min(upTo + 1, end);
      setRuns((old) => ({ ...old, [caseId]: { bad, upTo } }));
      if (upTo >= end) {
        clearInterval(timer.current!);
        timer.current = null;
        running.current = false;
        setBusy(null);
      }
    }, STEP_MS);
  }

  function reset(caseId: string) {
    setRuns((old) => without(old, caseId));
    setErrors((old) => without(old, caseId));
  }

  return { runs, errors, busy, verify: (caseId, n) => void verify(caseId, n), reset };
}

const LINE = { idle: "bg-primary/30", ok: "bg-green-300", bad: "bg-red-300" };
const KIND = {
  step: "border-primary/30",
  rule: "border-amber-200 bg-[#fffdf5]",
  cur: "border-blue-600 ring-2 ring-blue-600/15",
  new: "flex-[2.3_1_0%] border-primary ring-[3px] ring-primary/15",
};
const TONE = { idle: "", ok: "border-green-300 bg-green-50 ring-0", bad: "border-red-300 bg-red-50 ring-0" };
const HASH = { idle: "text-primary", ok: "text-green-700", bad: "text-red-700" };
// The new block keeps its ring after a verify.
const NEW_OK = "border-green-600 ring-[3px] ring-green-600/15";
const NEW_LABEL = { idle: "font-semibold text-primary", ok: "font-semibold text-green-700", bad: "font-semibold text-red-700" };

export function ChainStrip(props: {
  reference: string;
  blocks: ChainBlock[];
  ghosts: string[];
  run: VerifyRun | null;
  n: number;
  error: string | null;
  busy: boolean;
  onVerify: () => void;
  onOpen: () => void;
}) {
  const { blocks, ghosts, run, n, error } = props;
  const status =
    error !== null
      ? { tone: "bad" as const, title: `The chain check did not run: ${error}`, detail: "" }
      : chainStatus(n, blocks.at(-1)?.hash ?? "", run);
  const lastHash = blocks.at(-1)?.hash ?? "";
  const Icon = status.tone === "idle" ? Link : status.tone === "bad" ? ShieldAlert : ShieldCheck;
  const lineTones = blocks.map((b) => seqTone(b.to, run));
  // The new block locks with its hash before any verify.
  const tones = blocks.map((b, i) => (b.kind === "new" && run === null ? "ok" : lineTones[i]!));

  return (
    <section aria-label="Case history" className="rounded-b-xl border-t bg-stone-50 px-[22px] pt-[9px] pb-3">
      <div className="mb-[7px] flex items-center justify-between gap-3 text-xs">
        <span className="inline-flex min-w-0 items-center gap-[7px] whitespace-nowrap text-muted-foreground">
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              status.tone === "ok" ? "text-green-600" : status.tone === "bad" ? "text-red-600" : "text-primary",
            )}
          />
          <b
            className={cn(
              "truncate font-semibold",
              status.tone === "ok" ? "text-green-700" : status.tone === "bad" ? "text-red-700" : "text-foreground",
            )}
          >
            {status.title}
          </b>
          {status.detail !== "" && (
            <span>
              {`${n} events. Last block `}
              <span className="font-mono text-[11.5px]">{lastHash}</span>.
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <button
            type="button"
            aria-keyshortcuts="V"
            disabled={props.busy}
            onClick={props.onVerify}
            className="inline-flex h-[26px] items-center gap-1.5 rounded-md border bg-white pr-2 pl-[5px] text-xs font-medium whitespace-nowrap hover:bg-zinc-100 disabled:cursor-default disabled:opacity-60"
          >
            <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded border border-b-2 border-zinc-300 bg-white px-1 font-sans text-[10.5px] font-semibold text-zinc-700">
              V
            </kbd>
            Verify chain
          </button>
          <button
            type="button"
            onClick={props.onOpen}
            className="inline-flex h-[26px] items-center gap-1.5 rounded-md border bg-white pr-2 pl-[5px] text-xs font-medium whitespace-nowrap hover:bg-zinc-100 disabled:cursor-default disabled:opacity-60"
          >
            <Link className="size-[13px]" />
            Open full chain
          </button>
        </span>
      </div>
      <button
        type="button"
        aria-label={`Open the full chain of ${props.reference}`}
        onClick={props.onOpen}
        className="flex w-full items-center rounded-[7px] text-left focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary"
      >
        {blocks.map((b, i) => (
          <Fragment key={b.from}>
            {i > 0 && <span className={cn("h-0.5 w-[9px] shrink-0", LINE[lineTones[i]!])} />}
            <span
              data-kind={b.kind}
              data-tone={tones[i]}
              title={
                b.kind === "new"
                  ? `Your decision. Events #${b.from}-${b.to}. Hash ${b.hash}. Previous ${b.prev}.`
                  : `${b.label}. Events #${b.from}-${b.to}. Hash ${b.hash}. Previous ${b.prev}.`
              }
              className={cn(
                "relative grid h-10 min-w-0 flex-1 content-center rounded-md border bg-white px-2 py-1",
                KIND[b.kind],
                TONE[tones[i]!],
                b.kind === "new" && tones[i] === "ok" && NEW_OK,
              )}
            >
              <span
                className={cn(
                  "truncate text-[10.5px]",
                  b.kind === "cur"
                    ? "font-medium text-blue-600"
                    : b.kind === "new"
                      ? NEW_LABEL[tones[i]!]
                      : "text-zinc-700",
                )}
              >
                {b.label}
              </span>
              <span className={cn("font-mono text-[11px] font-semibold", HASH[tones[i]!])}>
                {b.hash}
                {b.kind === "new" && (
                  <i className="font-normal not-italic text-[10px] text-muted-foreground">{` prev ${b.prev}`}</i>
                )}
              </span>
              <Lock
                className={cn(
                  "absolute right-1.5 size-[11px] text-green-600",
                  b.kind === "new" ? "top-[5px] bottom-auto" : "bottom-1.5",
                  tones[i] === "ok" ? "opacity-100" : "opacity-0",
                )}
              />
            </span>
          </Fragment>
        ))}
        {ghosts.map((g, i) => (
          <Fragment key={`ghost-${i}`}>
            {(blocks.length > 0 || i > 0) && (
              <span className="h-0.5 w-[9px] shrink-0 bg-[repeating-linear-gradient(90deg,#d4d4d8_0_3px,transparent_3px_6px)]" />
            )}
            <span
              data-kind="ghost"
              title={`${g}. No block yet.`}
              className="relative grid h-10 min-w-0 flex-1 content-center rounded-md border border-dashed border-zinc-300 bg-transparent px-1.5 py-1"
            >
              <span className="truncate text-[10px] text-zinc-400">{g}</span>
              <span className="font-sans text-[10.5px] text-zinc-400">No block</span>
            </span>
          </Fragment>
        ))}
      </button>
    </section>
  );
}

type SheetBodyProps = {
  reference: string;
  client: string;
  def: ProcessDefinition;
  users: UserDTO[];
  events: CaseEvent[];
  // The first seq of the events of a send: these rows are marked as new.
  firstNew: number | null;
  run: VerifyRun | null;
  error: string | null;
  busy: boolean;
  onVerify: () => void;
  onClose: () => void;
};

const COLS = "grid-cols-[26px_minmax(0,1fr)_112px_70px_84px_16px]";
const ROW = { idle: "", ok: "bg-green-50", bad: "bg-red-50" };
const SEQ = { idle: "bg-zinc-100 text-muted-foreground", ok: "bg-green-600 text-white", bad: "bg-red-600 text-white" };
const LOCK = { idle: "text-zinc-300", ok: "text-green-600", bad: "text-red-600" };
const STATUS = { idle: "", busy: "", ok: "font-semibold text-green-700", bad: "font-semibold text-red-700" };

// The full chain of a case: one row for each event, with the verify run
// of the strip. The body is a plain component, so the tests render it
// with no Dialog context.
export function ChainSheetBody(props: SheetBodyProps) {
  const { events, firstNew, run, error, users, def } = props;
  const n = events.length;
  const status =
    error !== null
      ? { tone: "bad" as const, title: `The chain check did not run: ${error}` }
      : run === null
        ? { tone: "idle" as const, title: `Ready to check ${n} events` }
        : chainStatus(n, "", run);
  const { done, pct } = sheetProgress(n, run);
  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b px-[18px] pt-4 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Case history</h2>
            <Hint label="About the case history">
              Each event carries the hash of the event before it. The log is append only. Nobody can edit an event in the app.
            </Hint>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {`${props.reference} · ${props.client}`}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-md border bg-white px-2 text-[12.5px] whitespace-nowrap hover:bg-zinc-100"
        >
          <Kbd>Esc</Kbd>
          Close
        </button>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 border-b px-[18px] py-3">
        <Button className="h-[34px]" aria-keyshortcuts="V" disabled={props.busy} onClick={props.onVerify}>
          <ShieldCheck />
          Verify chain
          <Kbd light>V</Kbd>
        </Button>
        <div>
          <div className="flex justify-between text-[12.5px] text-muted-foreground">
            <span className={STATUS[status.tone]}>{status.title}</span>
            <b className="font-semibold tabular-nums text-foreground">{`${done} / ${n}`}</b>
          </div>
          <div className="mt-[5px] h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <i
              className={cn(
                "block h-full transition-[width] duration-100 ease-linear",
                status.tone === "bad" ? "bg-red-600" : "bg-green-600",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <div
        className={cn(
          "grid h-[30px] items-center gap-2.5 border-b px-[18px] text-[11.5px] text-muted-foreground",
          COLS,
        )}
      >
        <span>#</span>
        <span>Event</span>
        <span>Actor</span>
        <span>Hash</span>
        <span>Previous</span>
        <span />
      </div>
      <ul aria-label="Events" className="min-h-0 flex-1 overflow-auto">
        {events.map((e) => {
          const tone = seqTone(e.seq, run);
          const isNew = firstNew !== null && e.seq >= firstNew;
          return (
            <li
              key={e.seq}
              data-tone={tone}
              data-new={isNew ? "true" : undefined}
              className={cn(
                "grid min-h-[37px] items-center gap-2.5 border-b border-zinc-100 px-[18px] text-[12.5px] transition-colors",
                COLS,
                ROW[tone],
                isNew && "shadow-[inset_3px_0_0_var(--color-primary)]",
              )}
            >
              <span className={cn("grid size-[22px] place-items-center rounded-full text-[11px] tabular-nums", SEQ[tone])}>
                {tone === "ok" ? (
                  <>
                    <Check className="size-3 stroke-[3]" />
                    <span className="sr-only">{e.seq}</span>
                  </>
                ) : (
                  e.seq
                )}
              </span>
              <span className="truncate" title={e.type}>
                {eventLabel(def, e, (id) => actorOf(users, id))}
              </span>
              <span className="min-w-0 text-xs leading-tight">
                <span className="block truncate">{actorOf(users, e.actor)}</span>
                <small className="block text-[11px] text-muted-foreground">{dayTimeText(e.at, true)}</small>
              </span>
              <span className={cn("font-mono text-[11.5px] font-semibold", HASH[tone])}>{e.hash.slice(0, 8)}</span>
              <span className="inline-flex items-center gap-[3px] font-mono text-[11px] text-muted-foreground">
                <Link className="size-[11px]" />
                {e.prev_hash.slice(0, 8)}
              </span>
              <Lock className={cn("size-[13px]", LOCK[tone])} />
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-3 border-t px-[18px] py-2.5 text-xs text-muted-foreground">
        <code className="rounded bg-zinc-100 px-[5px] py-px font-mono text-[11px] text-foreground">
          {'sha256(prev_hash + "\\n" + event)'}
        </code>
      </div>
    </>
  );
}

// The side sheet at the right. Escape closes it, and the focus goes back
// to the button that opened it.
export function ChainSheet(
  props: Omit<SheetBodyProps, "onClose"> & { open: boolean; onOpenChange: (open: boolean) => void },
) {
  const { open, onOpenChange, ...body } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label="Case history"
        aria-describedby={undefined}
        className="top-0 right-0 left-auto flex h-dvh w-[620px] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 shadow-[-20px_0_50px_rgba(0,0,0,.18)] sm:max-w-none data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
      >
        <ChainSheetBody {...body} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// The stamp of a sent card: primary for the first decision, red else.
export function SignedStamp({ label, first }: { label: string; first: boolean }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-5 right-[220px] z-[5] inline-flex items-center gap-[7px] rounded-md border-2 border-current bg-white px-3 py-1.5 text-sm font-bold tracking-[.02em] rotate-[-5deg] animate-in fade-in zoom-in-125 duration-300",
        first ? "text-primary" : "text-red-700",
      )}
    >
      <PenTool className="size-[15px] stroke-[2.4]" />
      {`Signed · ${label}`}
    </div>
  );
}
