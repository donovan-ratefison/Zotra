// The triage deck: the inbox queue as cards, most urgent first, with
// the checks and the documents of the front case. F and U send the
// decisions of the step with the commands of the case screen. The
// pure rules live in triage.ts.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, CircleCheck, CircleX, Link, Lock, ShieldCheck } from "lucide-react";
import { ApiError, getVersion } from "../studio/api";
import {
  listEvents,
  readCase,
  runCommand,
  type CaseDTO,
  type CaseEvent,
  type CaseState,
  type UserDTO,
} from "../studio/case-api";
import { listCaseDocuments, type DocumentDTO } from "../studio/doc-api";
import { valueText } from "../studio/format";
import type { ProcessNode, Version } from "../studio/types";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { fetchChecks, type CheckResult, type InboxCase } from "./app-api";
import { pickField } from "./InboxScreen";
import {
  SHARE_LIMIT,
  decisionLabel,
  documentRows,
  dueText,
  editableTarget,
  enteredAt,
  firstDocIndex,
  keyFigures,
  lockReason,
  moveAfterSend,
  msLeft,
  queueOrder,
  receivedText,
  sendCommands,
  sendDecision,
  sendResultText,
  shareOfIncome,
  startIndex,
  triageAction,
  type Answer,
} from "./triage";
import { TriageDocuments } from "./TriageDocuments";
import { ChainStrip, SignedStamp, useChainVerify } from "./CaseChain";
import { appendBlock, blockText, chainBlocks, ghostLabels, newBlock } from "./chain";

// The pause before the move to the next card, so the user sees the stamp.
const MOVE_MS = 1200;

// A sent case keeps the documents and checks of the send moment.
interface Sent {
  decision: string;
  docs: DocumentDTO[];
  checks: CheckResult[];
  // The events and the state of the command answer.
  answer: Answer;
}

// One loaded case of the queue.
interface Item {
  id: string;
  row: CaseDTO;
  state: CaseState;
  events: CaseEvent[];
  version: Version;
  node: ProcessNode | null;
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

function clientOf(item: Item): string {
  const f = pickField(item.version.definition, "string");
  const v = f === null ? undefined : item.state.data[f.name];
  return typeof v === "string" && v !== "" ? v : "-";
}

function amountOf(item: Item): string {
  const def = item.version.definition;
  const f = pickField(def, "money");
  return f === null ? "-" : valueText(f, item.state.data[f.name], def.currency);
}

// A queue case rests on a task with one or more decisions.
function inQueue(item: Item): boolean {
  return item.node !== null && item.node.type === "task" && item.node.decisions.length > 0;
}

export function Kbd({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <kbd
      className={`inline-grid h-5 min-w-5 place-items-center rounded border border-b-2 px-[5px] font-sans text-[11px] font-semibold ${
        light ? "border-white/40 bg-white/15 text-white" : "border-zinc-300 bg-white text-zinc-700"
      }`}
    >
      {children}
    </kbd>
  );
}

const TONES = {
  ok: "bg-green-50 text-green-700",
  warn: "bg-amber-50 text-amber-700",
  late: "bg-red-50 text-red-700",
  none: "bg-zinc-100 text-zinc-600",
};

function Pill({ tone, text }: { tone: keyof typeof TONES; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">{children}</div>;
}

export function TriageScreen(props: {
  userId: string;
  users: UserDTO[];
  cases: InboxCase[];
  now: number;
  onExit: () => void;
  start: string[];
  onOpenCase: (ids: string[]) => void;
}) {
  const { cases, now } = props;
  // The order of the first full load. A sent case stays in the deck;
  // a new case waits for the next visit.
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const ids = frozen ?? cases.map((c) => c.id);
  // The decision and the snapshot of each sent case. The queries of a
  // sent case stop, so its card keeps the data of the send moment.
  const [sent, setSent] = useState<Record<string, Sent>>({});

  const caseQs = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["case", id],
      queryFn: () => readCase(id),
      enabled: sent[id] === undefined,
    })),
  });
  const eventQs = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["events", id],
      queryFn: () => listEvents(id),
      enabled: sent[id] === undefined,
    })),
  });
  const versionIds = [...new Set(caseQs.flatMap((q) => (q.data ? [q.data.case.version_id] : [])))];
  const versionQs = useQueries({
    queries: versionIds.map((id) => ({ queryKey: ["version", id], queryFn: () => getVersion(id) })),
  });

  const all = [...caseQs, ...eventQs, ...versionQs];
  const loaded = caseQs.every((q) => q.data) && eventQs.every((q) => q.data) && versionQs.every((q) => q.data);
  const items: Item[] = loaded
    ? ids.map((id, i) => {
        const { case: row, state } = caseQs[i]!.data!;
        const version = versionQs[versionIds.indexOf(row.version_id)]!.data!;
        const node = version.definition.nodes.find((n) => n.id === state.node_id) ?? null;
        return { id, row, state, events: eventQs[i]!.data!, version, node };
      })
    : [];
  const derived = loaded
    ? queueOrder(
        items.filter(inQueue).map((it) => ({
          id: it.id,
          reference: it.row.reference,
          created_at: it.row.created_at,
          msLeft: msLeft(enteredAt(it.events, it.node!.id), it.node!.deadline_hours, now),
        })),
      )
    : null;

  // Freeze during render (the React pattern for state derived from a
  // previous render), so the first full load fixes the deck order.
  if (frozen === null && derived !== null) setFrozen(derived);

  const error = all.find((q) => q.isError)?.error;
  if (error) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">The triage did not load.</h1>
        <p className="text-muted-foreground">{messageOf(error)}</p>
      </Centered>
    );
  }
  if (derived === null) {
    return <Centered><p className="text-muted-foreground">Loading the triage.</p></Centered>;
  }
  const order = frozen ?? derived;
  if (order.length === 0) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">Triage</h1>
        <p className="text-muted-foreground">No case waits for a decision.</p>
        <Button variant="outline" onClick={props.onExit}>Back to the inbox</Button>
      </Centered>
    );
  }
  const queue = order.map((id) => items.find((it) => it.id === id)!);
  return (
    <Deck
      {...props}
      queue={queue}
      sent={sent}
      onSent={(id, snap) => setSent((old) => ({ ...old, [id]: snap }))}
    />
  );
}

function Deck({
  userId,
  users,
  now,
  onExit,
  start,
  onOpenCase,
  queue,
  sent,
  onSent,
}: {
  userId: string;
  users: UserDTO[];
  now: number;
  onExit: () => void;
  start: string[];
  onOpenCase: (ids: string[]) => void;
  queue: Item[];
  sent: Record<string, Sent>;
  onSent: (id: string, snap: Sent) => void;
}) {
  const queryClient = useQueryClient();
  // Read once: the deck mounts again after each return from the case.
  const [index, setIndex] = useState(() => startIndex(queue.map((it) => it.id), start));
  const [busy, setBusy] = useState(false);
  // The open document row of the dialog (null: closed), and the last
  // one, so the focus goes back to it after a close.
  const [docIndex, setDocIndex] = useState<number | null>(null);
  const [lastDoc, setLastDoc] = useState(0);
  const docButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const openDoc = (i: number) => {
    setLastDoc(i);
    setDocIndex(i);
  };
  // Blocks a second send before the busy state renders.
  const sending = useRef(false);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(moveTimer.current), []);

  const last = queue.length - 1;
  const front = queue[Math.min(index, last)]!;
  // The front card first, then the cards after it.
  const openIds = () => queue.slice(Math.min(index, last)).map((it) => it.id);
  const snap = sent[front.id];
  const docsQ = useQuery({
    queryKey: ["documents", front.id],
    queryFn: () => listCaseDocuments(front.id),
    enabled: snap === undefined,
  });
  const checksQ = useQuery({
    queryKey: ["checks", front.id],
    queryFn: () => fetchChecks(front.id),
    enabled: snap === undefined,
  });
  const docs = snap?.docs ?? docsQ.data ?? null;
  const checks = snap?.checks ?? checksQ.data?.checks ?? null;
  const docsError = snap === undefined && docsQ.isError ? messageOf(docsQ.error) : null;
  const checksError = snap === undefined && checksQ.isError ? messageOf(checksQ.error) : null;

  const { state, events, version } = front;
  const def = version.definition;
  const node = front.node!;
  const assigneeName = users.find((u) => u.id === state.assignee)?.name ?? state.assignee;
  const lock = lockReason({
    node,
    state,
    userId,
    assigneeName,
    docs,
    events,
    checks,
    checksError,
  });
  const sentDecision = snap?.decision;
  const chain = useChainVerify();
  const canSend = lock === null && sentDecision === undefined && !busy && chain.busy === null;
  const rows = docs === null ? null : documentRows(def, events, node.id, docs);
  // A sent card keeps its snapshot: the events of the answer add one block.
  const extra = snap?.answer.events ?? [];
  const nb = snap === undefined ? null : newBlock(extra, decisionLabel(snap.decision));
  const blocks = appendBlock(chainBlocks(def, events, state), nb);
  // The new block takes 2 places.
  const ghosts = ghostLabels(def, snap?.answer.state ?? state, blocks.length + (nb === null ? 0 : 1));
  const n = events.length + extra.length;
  const verifyFront = () => chain.verify(front.id, n);

  async function send(decision: string) {
    if (sending.current) return;
    sending.current = true;
    const id = front.id;
    const at = Math.min(index, last);
    const label = decisionLabel(decision);
    const shot = { decision, docs: docs ?? [], checks: checks ?? [] };
    setBusy(true);
    try {
      const cmds = sendCommands(def, node, state, shot.docs, decision);
      const answer = await sendDecision(id, userId, cmds, runCommand);
      const nb = newBlock(answer.events, label);
      const result = sendResultText(answer, def, label, nb === null ? "" : blockText(nb));
      if (result.ok) {
        toast.success(result.text);
        onSent(id, { ...shot, answer });
        chain.reset(id);
        void queryClient.invalidateQueries({ queryKey: ["inbox", userId] });
        clearTimeout(moveTimer.current);
        moveTimer.current = setTimeout(() => setIndex((i) => moveAfterSend(i, at, last)), MOVE_MS);
      } else {
        toast.error(result.text);
        void queryClient.invalidateQueries({ queryKey: ["checks", id] });
      }
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  // The window listener calls the handler of the last render.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (e) => {
      if (docIndex !== null || e.defaultPrevented) return;
      const action = triageAction(
        e.key,
        e.ctrlKey || e.metaKey || e.altKey,
        editableTarget(e.target as HTMLElement | null),
      );
      if (action === null) return;
      if (action === "verify") {
        e.preventDefault();
        verifyFront();
        return;
      }
      if (action === "docs") {
        const first = rows === null ? null : firstDocIndex(rows);
        if (first !== null) {
          e.preventDefault();
          openDoc(first);
        }
        return;
      }
      e.preventDefault();
      if (action === "prev") setIndex((i) => Math.max(i - 1, 0));
      else if (action === "next") setIndex((i) => Math.min(i + 1, last));
      else if (action === "exit") onExit();
      else if (action === "open") onOpenCase(openIds());
      else {
        const decision = node.decisions[action === "first" ? 0 : 1];
        if (decision !== undefined && canSend) void send(decision);
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const next = queue[index + 1];
  const strings = def.fields.filter((f) => f.type === "string");
  const second = strings[1] === undefined ? undefined : state.data[strings[1].name];
  const assigned =
    state.assignee === userId ? "Assigned to you" : state.assignee === "" ? "Not taken" : `Assigned to ${assigneeName}`;
  const sub = [typeof second === "string" ? second : "", `${def.name} v${version.number}`, assigned]
    .filter((s) => s !== "")
    .join(" · ");
  const months = state.data.duration_months;
  const rate = state.data.annual_rate;
  const terms =
    typeof months === "number" && typeof rate === "number"
      ? `${months} months at ${Number((rate * 100).toFixed(2))}%`
      : null;
  const due = dueText(msLeft(enteredAt(events, node.id), node.deadline_hours, now));
  const figures = keyFigures(def, node, state);
  const share = shareOfIncome(state);
  const over = share !== null && share > SHARE_LIMIT;
  const passCount = (checks ?? []).filter((c) => c.passed && c.error === null).length;
  const keyClass =
    "inline-flex h-[34px] items-center gap-2 rounded-lg border bg-white pr-3 pl-2 text-[13px] font-medium whitespace-nowrap text-zinc-700 shadow-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <div className="min-h-full flex-1 bg-[#f1f1ef] px-7 pt-3.5 pb-5">
      <div className="mb-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">{`Triage: ${node.name}`}</h1>
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            Rules and humans decide. The AI only checks.
          </p>
        </div>
        <div className="grid justify-items-center gap-1.5">
          <b className="text-[13px] font-semibold">{`Case ${index + 1} of ${queue.length}`}</b>
          <div className="flex gap-1">
            {queue.map((it, i) => (
              <i
                key={it.id}
                className={`h-[5px] w-[30px] rounded-full transition-colors ${
                  i < index ? "bg-primary/40" : i === index ? "bg-primary" : "bg-zinc-300"
                }`}
              />
            ))}
          </div>
          <small className="text-xs text-muted-foreground">
            {next === undefined ? "Last case" : `Next: ${clientOf(next)}, ${amountOf(next)}`}
          </small>
        </div>
        <Button variant="outline" className="justify-self-end bg-white" onClick={onExit}>
          Exit triage
          <Kbd>Esc</Kbd>
        </Button>
      </div>

      <div className="relative mx-auto w-[800px]">
        {queue.slice(index + 1, index + 3).map((it, i) => (
          <div
            key={it.id}
            aria-hidden
            className={`absolute inset-0 origin-bottom rounded-xl border bg-white shadow-sm ${
              i === 0 ? "z-[2] translate-y-[13px] scale-[.955] opacity-95" : "z-[1] translate-y-[26px] scale-[.91] opacity-80"
            }`}
          />
        ))}
        <article
          key={front.id}
          className="relative z-[3] animate-in rounded-xl border bg-white shadow-[0_1px_3px_rgba(12,10,9,.06),0_12px_32px_rgba(12,10,9,.08)] duration-300 fade-in slide-in-from-right-4"
        >
          {snap !== undefined && (
            <SignedStamp label={decisionLabel(snap.decision)} first={snap.decision === node.decisions[0]} />
          )}
          <header className="flex items-start justify-between gap-4 border-b px-[22px] pt-3.5 pb-3">
            <div className="min-w-0">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{front.row.reference}</span>
                <Pill tone="none" text={receivedText(front.row.created_at, now)} />
              </div>
              <h2 className="truncate text-[20px] font-semibold tracking-tight">{clientOf(front)}</h2>
              <p className="text-[12.5px] text-muted-foreground">{sub}</p>
            </div>
            <div className="text-right">
              <b className="block text-[24px] font-semibold tracking-tight">{amountOf(front)}</b>
              <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                {terms !== null && <span>{terms}</span>}
                {terms !== null && due !== null && <span>·</span>}
                {due !== null && <Pill tone={due.tone} text={due.text} />}
              </div>
            </div>
          </header>

          <div className="grid gap-[11px] px-[22px] pt-3 pb-2.5">
            {figures.length > 0 && (
              <div className="grid grid-cols-4 gap-2.5">
                {figures.map((f) => (
                  <div key={f.label} className="rounded-[7px] border border-zinc-100 bg-stone-50 px-2.5 py-1.5">
                    <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                      {f.source && <Link className="size-3" />}
                      {f.label}
                    </span>
                    <b className="text-[15px] font-semibold tabular-nums">{f.value}</b>
                  </div>
                ))}
              </div>
            )}

            {share !== null && (
              <div className="grid gap-1.5">
                <div className="flex justify-between text-[12.5px]">
                  <span>Share of income for all loans</span>
                  <span>
                    <b className={`font-semibold ${over ? "text-red-700" : ""}`}>{`${(share * 100).toFixed(1)}%`}</b>
                    <span className="text-muted-foreground">{` of ${Math.round(SHARE_LIMIT * 100)}% limit`}</span>
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-zinc-100">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-red-600" : "bg-primary"}`}
                    style={{ width: `${Math.min(share / 0.5, 1) * 100}%` }}
                  />
                  <div className="absolute -inset-y-1 w-0.5 bg-zinc-700" style={{ left: `${(SHARE_LIMIT / 0.5) * 100}%` }} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-[22px]">
              <section>
                <h3 className="mb-0.5 flex h-5 items-center justify-between text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Rules
                  {checks !== null && checks.length > 0 && (
                    <span className="font-medium normal-case tracking-normal">{`${passCount} of ${checks.length} pass`}</span>
                  )}
                </h3>
                {checksError !== null ? (
                  <p className="text-[12.5px] text-red-700">{`The checks did not load: ${checksError}`}</p>
                ) : checks === null ? (
                  <p className="text-[12.5px] text-muted-foreground">Loading the checks.</p>
                ) : checks.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">No rule on this step.</p>
                ) : (
                  <ul>
                    {checks.map((c) => {
                      const ok = c.passed && c.error === null;
                      return (
                        <li key={c.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 border-b border-zinc-100 py-1.5 text-[12.5px] leading-snug last:border-b-0">
                          {ok ? (
                            <CircleCheck className="mt-px size-4 text-green-600" />
                          ) : (
                            <CircleX className="mt-px size-4 text-red-600" />
                          )}
                          <div className="min-w-0">
                            <b className="block font-mono text-xs font-medium">{c.id}</b>
                            <small className={`block text-[11.5px] ${ok ? "text-muted-foreground" : "text-red-700"}`}>
                              {c.passed ? c.expression : (c.error ?? c.message)}
                            </small>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="mb-0.5 flex h-5 items-center justify-between text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Documents
                  {rows !== null && rows.length > 0 && (
                    <span className="flex items-center gap-1.5 font-medium normal-case tracking-normal">
                      {`${rows.filter((r) => r.scan !== null).length} of ${rows.length} attached`}
                      <Kbd>D</Kbd>
                    </span>
                  )}
                </h3>
                {docsError !== null ? (
                  <p className="text-[12.5px] text-red-700">{`The documents did not load: ${docsError}`}</p>
                ) : rows === null ? (
                  <p className="text-[12.5px] text-muted-foreground">Loading the documents.</p>
                ) : rows.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">No document on this case path.</p>
                ) : (
                  <ul>
                    {rows.map((r, i) => (
                      <li key={r.name}>
                        <button
                          type="button"
                          data-doc={i}
                          ref={(el) => {
                            docButtons.current[i] = el;
                          }}
                          onClick={() => openDoc(i)}
                          className={`group grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 rounded-md border-b border-zinc-100 px-1.5 py-1 text-left text-[12.5px] leading-snug ${
                            i === rows.length - 1 ? "border-b-transparent" : ""
                          } ${r.scan === null ? "bg-red-50" : "hover:bg-stone-50"}`}
                        >
                          {r.scan !== null ? (
                            <CircleCheck className="mt-px size-4 text-green-600" />
                          ) : (
                            <CircleX className="mt-px size-4 text-red-600" />
                          )}
                          <div className="min-w-0">
                            <b className="block font-medium">{r.name}</b>
                            <small className={`block text-[11.5px] ${r.scan !== null ? "text-muted-foreground" : "text-red-700"}`}>
                              {r.scan !== null ? `Attached: ${r.scan.name}` : "Missing"}
                            </small>
                          </div>
                          <span
                            className={`flex items-center gap-0.5 self-center text-[11.5px] ${
                              r.scan === null
                                ? "text-red-700"
                                : "text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                            }`}
                          >
                            View
                            <ChevronRight className="size-[13px]" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
          <ChainStrip
            reference={front.row.reference}
            blocks={blocks}
            ghosts={ghosts}
            run={chain.runs[front.id] ?? null}
            n={n}
            error={chain.errors[front.id] ?? null}
            busy={chain.busy !== null}
            onVerify={verifyFront}
          />
        </article>
      </div>

      <div className="mt-9 flex justify-center gap-2">
        <button type="button" className={keyClass} disabled={index === 0} onClick={() => setIndex((i) => Math.max(i - 1, 0))}>
          <Kbd>K</Kbd>
          Previous
        </button>
        <button type="button" className={keyClass} disabled={index >= last} onClick={() => setIndex((i) => Math.min(i + 1, last))}>
          <Kbd>J</Kbd>
          Next
        </button>
        {node.decisions.map((d, i) => (
          <button
            key={d}
            type="button"
            disabled={!canSend}
            aria-keyshortcuts={i === 0 ? "F" : i === 1 ? "U" : undefined}
            onClick={() => void send(d)}
            className={cn(keyClass, i === 0 && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
          >
            {i < 2 && <Kbd light={i === 0}>{i === 0 ? "F" : "U"}</Kbd>}
            {decisionLabel(d)}
          </button>
        ))}
        <button
          type="button"
          className={keyClass}
          disabled={rows === null || rows.length === 0}
          onClick={() => {
            const first = rows === null ? null : firstDocIndex(rows);
            if (first !== null) openDoc(first);
          }}
        >
          <Kbd>D</Kbd>
          Documents
        </button>
        <button type="button" aria-keyshortcuts="O" className={keyClass} onClick={() => onOpenCase(openIds())}>
          <Kbd>O</Kbd>
          Open the case
        </button>
        <button
          type="button"
          aria-keyshortcuts="V"
          className={keyClass}
          disabled={chain.busy !== null}
          onClick={verifyFront}
        >
          <Kbd>V</Kbd>
          Verify chain
        </button>
      </div>
      {rows !== null && rows.length > 0 && (
        <TriageDocuments
          key={front.id}
          reference={front.row.reference}
          client={clientOf(front)}
          node={node}
          events={events}
          rows={rows}
          index={Math.min(docIndex ?? lastDoc, rows.length - 1)}
          onIndex={openDoc}
          open={docIndex !== null}
          onOpenChange={(open) => {
            if (!open) setDocIndex(null);
          }}
          onCloseFocus={() => docButtons.current[lastDoc]?.focus()}
        />
      )}
      <p
        role="status"
        className={`mt-2.5 flex min-h-[18px] items-center justify-center gap-1.5 text-[12.5px] ${
          sentDecision === undefined && lock !== null ? "text-red-700" : "text-muted-foreground"
        }`}
      >
        {sentDecision !== undefined ? (
          <>
            <CircleCheck className="size-3.5 text-green-600" />
            {`You sent ${decisionLabel(sentDecision)}. The case left your step.`}
          </>
        ) : lock !== null ? (
          <>
            <Lock className="size-3.5" />
            {lock}
          </>
        ) : (
          <>
            <CircleCheck className="size-3.5 text-green-600" />
            No blocker. All rules pass.
          </>
        )}
      </p>
    </div>
  );
}
