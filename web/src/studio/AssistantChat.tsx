// The AI assistant chat: the designer types a change of the process
// in plain words, the server proposes one changed definition, and the
// designer accepts or rejects it. The state and the transition are
// pure exports, so the node tests run them without a DOM. The async
// helpers take their IO as a parameter, so the tests stub it.

import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { ApiError, updateDraft } from "./api";
import {
  changeProcess,
  restateChange,
  type RestateQuestion,
} from "./ai-api";
import { diffChips, diffDefinitions, type DiffRow } from "./diff";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Switch } from "@/ui/switch";
import type { ProcessDefinition, Version } from "./types";

const VIOLET = "#7c3aed";

const ROW_PREFIX = { add: "+", remove: "-", modify: "~" } as const;
const ROW_COLOR = {
  add: "#16a34a",
  remove: "#dc2626",
  modify: "#d97706",
} as const;

const WAITING_TEXT = "Thinking...";
const PROPOSAL_TEXT = "Proposal ready, in dashed violet on the diagram.";
const NO_CHANGE_TEXT = "The AI found no change to make.";
const AI_OFF_TEXT =
  "The AI is not available. You can still edit the process by hand.";
const INVALID_OUTPUT_TEXT =
  "The AI could not propose a valid process. Try another wording.";
const STALE_TEXT = "The draft changed since the request. Ask again.";
const REJECTED_TEXT = "Rejected. The diagram is back to its previous state.";
const SAVE_FAILED_TEXT = "The draft did not save.";
const HINT_TITLE =
  "Describe a change of the process, for example: add a 12 h deadline to the legal officer";
const CLOSED_TITLE = "Open a draft to change the process with the AI.";
const PENDING_TITLE = "Accept or reject the proposal first.";
const CONFIRM_TEXT = "Yes, make the change";
const REPHRASE_TEXT = "Rephrase your request below.";
const RESTATE_TITLE =
  "The assistant restates your request and waits for your OK before it changes the draft.";
const RESTATE_KEY = "zotra.chat.restateFirst";
const CHOICES_TEXT = "Make the change with these choices";
const INPUT_CLASS =
  "min-w-0 flex-1 rounded-md border bg-transparent px-3 text-[13px] outline-none";

// ChatTurn is one message of the thread: the user text, or the main
// text of one AI state, with the diff of a proposal and the details
// of a validation error.
export interface ChatTurn {
  kind:
    | "user" | "waiting" | "restate" | "proposal" | "none" | "accepted" | "rejected"
    | "error";
  text: string;
  chips: string[];
  rows: DiffRow[];
  details: string[];
  questions?: RestateQuestion[];
}

// QuestionAnswer is the choice of the designer for one question.
// other is null while the Other choice is not ticked.
export interface QuestionAnswer {
  picked: string[];
  other: string | null;
}

// Answers holds one answer for each question id.
export type Answers = Record<string, QuestionAnswer>;

// defaultAnswers ticks the default options of each question.
export function defaultAnswers(qs: RestateQuestion[]): Answers {
  const answers: Answers = {};
  for (const q of qs) {
    answers[q.id] = {
      picked: q.options.filter((o) => o.default).map((o) => o.label),
      other: null,
    };
  }
  return answers;
}

function answerOf(answers: Answers, q: RestateQuestion): QuestionAnswer {
  return answers[q.id] ?? { picked: [], other: null };
}

// pickOption ticks (on) or unticks one option. A single question
// keeps only this option, and on plays no role.
export function pickOption(
  answers: Answers,
  q: RestateQuestion,
  label: string,
  on: boolean,
): Answers {
  if (q.kind === "single") {
    return { ...answers, [q.id]: { picked: [label], other: null } };
  }
  const a = answerOf(answers, q);
  const picked = q.options
    .map((o) => o.label)
    .filter((l) => (l === label ? on : a.picked.includes(l)));
  return { ...answers, [q.id]: { picked, other: a.other } };
}

// pickOther sets the Other answer; null unticks it. In a single
// question, Other replaces the picked option.
export function pickOther(
  answers: Answers,
  q: RestateQuestion,
  text: string | null,
): Answers {
  const picked = q.kind === "single" ? [] : answerOf(answers, q).picked;
  return { ...answers, [q.id]: { picked, other: text } };
}

// answerLabels lists the chosen labels in option order, then the
// Other text when it is not empty.
export function answerLabels(q: RestateQuestion, a: QuestionAnswer): string[] {
  const labels = q.options.map((o) => o.label).filter((l) => a.picked.includes(l));
  const other = a.other?.trim() ?? "";
  return other === "" ? labels : [...labels, other];
}

// answersReady tells if each question has one label or more.
export function answersReady(qs: RestateQuestion[], answers: Answers): boolean {
  return qs.every((q) => answerLabels(q, answerOf(answers, q)).length > 0);
}

// answerLines gives one line for each question: the text, then the
// chosen labels.
function answerLines(qs: RestateQuestion[], answers: Answers): string[] {
  return qs.map((q) => `${q.text}: ${answerLabels(q, answerOf(answers, q)).join(", ")}`);
}

// composeMessage is the change request with one line for each answer.
export function composeMessage(
  request: string,
  qs: RestateQuestion[],
  answers: Answers,
): string {
  return [request, ...answerLines(qs, answers)].join("\n");
}

export interface ChatState {
  turns: ChatTurn[];
  notice: string | null;
}

export type ChatEvent =
  | { type: "send"; text: string }
  | { type: "answer"; base: ProcessDefinition; next: ProcessDefinition }
  | { type: "error"; status: number; message: string; details: string[] }
  | { type: "accept-ok"; versionNumber: number }
  | { type: "accept-stale" }
  | { type: "save-failed" }
  | { type: "reject" }
  | { type: "restated"; text: string; questions: RestateQuestion[] }
  | { type: "confirm"; text?: string }
  | { type: "rephrase" };

// chatEvent is the pure transition of the thread. It returns the new
// state and touches nothing else. An event that needs a specific
// last turn applies only on that turn; every event but save-failed
// clears the notice.
export function chatEvent(state: ChatState, event: ChatEvent): ChatState {
  const last = state.turns[state.turns.length - 1];
  const withoutLast = state.turns.slice(0, -1);
  switch (event.type) {
    case "send":
      return {
        notice: null,
        turns: [
          ...state.turns,
          { kind: "user", text: event.text, chips: [], rows: [], details: [] },
          { kind: "waiting", text: WAITING_TEXT, chips: [], rows: [], details: [] },
        ],
      };
    case "restated":
      if (last === undefined || last.kind !== "waiting") {
        return state;
      }
      return {
        notice: null,
        turns: [
          ...withoutLast,
          {
            kind: "restate",
            text: event.text,
            chips: [],
            rows: [],
            details: [],
            ...(event.questions.length > 0 ? { questions: event.questions } : {}),
          },
        ],
      };
    case "confirm":
      if (last === undefined || last.kind !== "restate") {
        return state;
      }
      return {
        notice: null,
        turns: [
          ...state.turns,
          {
            kind: "user",
            text: event.text ?? CONFIRM_TEXT,
            chips: [],
            rows: [],
            details: [],
          },
          { kind: "waiting", text: WAITING_TEXT, chips: [], rows: [], details: [] },
        ],
      };
    case "rephrase":
      if (last === undefined || last.kind !== "restate") {
        return state;
      }
      return {
        notice: null,
        turns: [
          ...state.turns,
          { kind: "none", text: REPHRASE_TEXT, chips: [], rows: [], details: [] },
        ],
      };
    case "answer": {
      if (last === undefined || last.kind !== "waiting") {
        return state;
      }
      const { counts, rows } = diffDefinitions(event.base, event.next);
      const turn: ChatTurn =
        rows.length === 0
          ? { kind: "none", text: NO_CHANGE_TEXT, chips: [], rows: [], details: [] }
          : {
              kind: "proposal",
              text: PROPOSAL_TEXT,
              chips: diffChips(counts),
              rows,
              details: [],
            };
      return { notice: null, turns: [...withoutLast, turn] };
    }
    case "error": {
      if (last === undefined || last.kind !== "waiting") {
        return state;
      }
      const text =
        event.status === 503
          ? AI_OFF_TEXT
          : event.status === 422
            ? INVALID_OUTPUT_TEXT
            : `The request failed: ${event.message}`;
      const details = event.status === 422 ? event.details.slice(0, 3) : [];
      return {
        notice: null,
        turns: [...withoutLast, { kind: "error", text, chips: [], rows: [], details }],
      };
    }
    case "accept-ok": {
      if (last === undefined || last.kind !== "proposal") {
        return state;
      }
      return {
        notice: null,
        turns: [
          ...withoutLast,
          {
            kind: "accepted",
            text: `Accepted. The change is in the draft of v${event.versionNumber}.`,
            chips: [],
            rows: [],
            details: [],
          },
        ],
      };
    }
    case "accept-stale": {
      if (last === undefined || last.kind !== "proposal") {
        return state;
      }
      return {
        notice: null,
        turns: [
          ...withoutLast,
          { kind: "error", text: STALE_TEXT, chips: [], rows: [], details: [] },
        ],
      };
    }
    case "save-failed":
      return { turns: state.turns, notice: SAVE_FAILED_TEXT };
    case "reject": {
      if (last === undefined || last.kind !== "proposal") {
        return state;
      }
      return {
        notice: null,
        turns: [
          ...withoutLast,
          { kind: "rejected", text: REJECTED_TEXT, chips: [], rows: [], details: [] },
        ],
      };
    }
  }
}

// ChatTurnView renders one thread message. An AI message sits left,
// with a round violet avatar and its content in a card with border.
function ChatTurnView({
  turn, isLast, accepting, answers, onAnswersChange, onAccept, onReject, onConfirm,
  onRephrase,
}: {
  turn: ChatTurn;
  isLast: boolean;
  accepting: boolean;
  answers?: Answers;
  onAnswersChange?: (a: Answers) => void;
  onAccept?: () => void;
  onReject?: () => void;
  onConfirm?: () => void;
  onRephrase?: () => void;
}) {
  if (turn.kind === "user") {
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[80%] whitespace-pre-line rounded-lg bg-zinc-100 px-3 py-1.5 text-[13px] text-zinc-800">
          {turn.text}
        </div>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-600">
          ME
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: VIOLET }}
      >
        <Sparkles size={12} aria-hidden="true" />
      </span>
      <div className="max-w-[85%] rounded-lg border px-3 py-2 text-[13px]">
        {turn.kind === "waiting" && (
          <p aria-live="polite" className="flex items-center gap-1.5 text-zinc-500">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            {turn.text}
          </p>
        )}
        {turn.kind === "restate" && turn.questions !== undefined && (
          <>
            <p>{turn.text}</p>
            {isLast ? (
              <QuestionForm
                questions={turn.questions}
                answers={answers ?? defaultAnswers(turn.questions)}
                onAnswersChange={onAnswersChange}
                onConfirm={onConfirm}
                onRephrase={onRephrase}
              />
            ) : (
              turn.questions.map((q) => (
                <p key={q.id} className="mt-1 text-[12px] text-zinc-600">
                  {q.text}{" "}
                  {q.options.filter((o) => o.default).map((o) => o.label).join(", ")}
                </p>
              ))
            )}
          </>
        )}
        {turn.kind === "restate" && turn.questions === undefined && (
          <>
            <p>{turn.text}</p>
            {isLast && (
              <div className="mt-2 flex items-center gap-2">
                <Button size="xs" onClick={() => onConfirm?.()}>
                  {CONFIRM_TEXT}
                </Button>
                <Button variant="outline" size="xs" onClick={() => onRephrase?.()}>
                  No, rephrase
                </Button>
              </div>
            )}
          </>
        )}
        {turn.kind === "proposal" && (
          <>
            <p>{turn.text}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {turn.chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border px-2 py-0.5 text-[11px] text-zinc-600"
                >
                  {chip}
                </span>
              ))}
            </div>
            <DiffRows rows={turn.rows} />
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={accepting}
                onClick={() => onReject?.()}
              >
                <X aria-hidden="true" />
                Reject
              </Button>
              <Button size="sm" disabled={accepting} onClick={() => onAccept?.()}>
                <Check aria-hidden="true" />
                {accepting ? "Accepting..." : "Accept"}
              </Button>
            </div>
          </>
        )}
        {turn.kind === "none" && <p>{turn.text}</p>}
        {turn.kind === "accepted" && (
          <p className="flex items-center gap-1.5 font-medium text-green-600">
            <Check size={14} aria-hidden="true" />
            {turn.text}
          </p>
        )}
        {turn.kind === "rejected" && (
          <p className="flex items-center gap-1.5 text-zinc-500">
            <X size={14} aria-hidden="true" />
            {turn.text}
          </p>
        )}
        {turn.kind === "error" && (
          <>
            <p>{turn.text}</p>
            {turn.details.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-[12px] text-zinc-500">
                {turn.details.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// QuestionForm renders the questions of the last restate turn: one
// fieldset for each question, the defaults ticked, and the two
// buttons.
function QuestionForm({
  questions, answers, onAnswersChange, onConfirm, onRephrase,
}: {
  questions: RestateQuestion[];
  answers: Answers;
  onAnswersChange?: (a: Answers) => void;
  onConfirm?: () => void;
  onRephrase?: () => void;
}) {
  const change = (next: Answers) => onAnswersChange?.(next);
  return (
    <>
      {questions.map((q) => {
        const a = answerOf(answers, q);
        // The row label wraps the control, so the control needs no name.
        const control = (checked: boolean, onPick: (on: boolean) => void) =>
          q.kind === "single" ? (
            <input
              type="radio"
              name={`q-${q.id}`}
              checked={checked}
              onChange={() => onPick(true)}
              className="size-4 accent-primary"
            />
          ) : (
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => onPick(v === true)}
            />
          );
        return (
          <fieldset key={q.id} className="mt-2">
            <legend className="text-[13px] font-medium">{q.text}</legend>
            {q.options.map((o) => (
              <label key={o.label} className="flex items-center gap-1.5 text-[13px]">
                {control(
                  a.picked.includes(o.label),
                  (on) => change(pickOption(answers, q, o.label, on)),
                )}
                {o.label}
                {o.default && o.reason !== "" && (
                  <span className="text-[12px] text-zinc-500">{o.reason}</span>
                )}
              </label>
            ))}
            {q.other && (
              <div className="flex items-center gap-1.5 text-[13px]">
                <label className="flex items-center gap-1.5">
                  {control(
                    a.other !== null,
                    (on) => change(pickOther(answers, q, on ? "" : null)),
                  )}
                  Other
                </label>
                <input
                  type="text"
                  aria-label={`Other answer: ${q.text}`}
                  disabled={a.other === null}
                  value={a.other ?? ""}
                  onChange={(e) => change(pickOther(answers, q, e.target.value))}
                  className={`h-8 ${INPUT_CLASS}`}
                />
              </div>
            )}
          </fieldset>
        );
      })}
      <div className="mt-2 flex gap-2">
        <Button
          size="xs"
          disabled={!answersReady(questions, answers)}
          onClick={() => onConfirm?.()}
        >
          {CHOICES_TEXT}
        </Button>
        <Button variant="outline" size="xs" onClick={() => onRephrase?.()}>
          Rephrase
        </Button>
      </div>
    </>
  );
}

// DiffRows is the toggle and the rows of one proposal. The open flag
// is a view concern, so it stays local to the view.
function DiffRows({ rows }: { rows: DiffRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        className="mt-1.5 rounded px-1.5 py-0.5 text-[12px] font-medium text-zinc-600 hover:bg-zinc-100"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide the changes" : "See the changes"}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-0.5">
          {rows.map((row) => (
            <div key={row.text} className="flex gap-1.5 text-[12px] text-zinc-700">
              <span style={{ color: ROW_COLOR[row.kind] }}>
                {ROW_PREFIX[row.kind]}
              </span>
              <span>{row.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ChatPanelView renders the panel: the header, the thread (when
// expanded), the composer and the notice line. It holds no chat
// state: the wiring comes in as optional props, so the tests can
// call it with the three required props only.
export function ChatPanelView(props: {
  state: ChatState;
  version: Version;
  collapsed: boolean;
  restateFirst?: boolean;
  onRestateFirstChange?: (on: boolean) => void;
  listHeight?: number;
  draft?: string;
  onDraftChange?: (text: string) => void;
  onSend?: () => void;
  onToggle?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onConfirm?: () => void;
  onRephrase?: () => void;
  answers?: Answers;
  onAnswersChange?: (a: Answers) => void;
  accepting?: boolean;
}): ReactElement {
  const { state, version, collapsed, listHeight = 220 } = props;
  const last = state.turns[state.turns.length - 1] ?? null;
  const pending = last !== null && last.kind === "proposal";
  const waiting = last !== null && last.kind === "waiting";
  const threadRef = useRef<HTMLDivElement | null>(null);
  // After each new message, the thread shows the last message. An
  // answer replaces the waiting turn, so the kind of the last turn is
  // a key too.
  useEffect(() => {
    const el = threadRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.turns.length, last?.kind]);
  const disabled = version.status !== "draft" || pending || waiting;
  const title =
    version.status !== "draft"
      ? CLOSED_TITLE
      : pending
        ? PENDING_TITLE
        : HINT_TITLE;
  return (
    <section
      aria-label="AI assistant"
      className="w-full shrink-0 border-t"
      style={{ background: "var(--card)" }}
    >
      <div className="flex h-11 w-full items-center gap-2 px-4">
        <Sparkles size={14} style={{ color: VIOLET }} aria-hidden="true" />
        <span className="text-[13px] font-semibold">AI assistant</span>
        {collapsed && pending && (
          <span
            className="rounded-full border px-2 py-0.5 text-[11px]"
            style={{ borderColor: VIOLET, color: VIOLET }}
          >
            1 proposal pending
          </span>
        )}
        <span className="min-w-0 truncate text-[12px] text-zinc-500">
          Without AI, you can still edit everything by hand.
        </span>
        <span className="flex-1" />
        <Switch
          id="restate-first"
          size="sm"
          checked={props.restateFirst ?? true}
          onCheckedChange={(on) => props.onRestateFirstChange?.(on)}
        />
        <label
          htmlFor="restate-first"
          title={RESTATE_TITLE}
          className="shrink-0 text-[12px] text-zinc-600"
        >
          Restate first
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={!collapsed}
          aria-controls="chat-thread"
          onClick={() => props.onToggle?.()}
        >
          {collapsed ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {collapsed ? "Expand" : "Collapse"}
        </Button>
      </div>
      {!collapsed && (
        <>
          <div
            id="chat-thread"
            ref={threadRef}
            className="flex flex-col gap-2 overflow-y-auto px-4 py-2"
            style={{ maxHeight: listHeight }}
          >
            {state.turns.map((turn, i) => (
              <ChatTurnView
                key={i}
                turn={turn}
                isLast={i === state.turns.length - 1}
                accepting={props.accepting ?? false}
                answers={props.answers}
                onAnswersChange={props.onAnswersChange}
                onAccept={props.onAccept}
                onReject={props.onReject}
                onConfirm={props.onConfirm}
                onRephrase={props.onRephrase}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 px-4 pb-3">
            <input
              type="text"
              aria-label="Message to the AI assistant"
              title={title}
              disabled={disabled}
              value={props.draft ?? ""}
              onChange={(e) => props.onDraftChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !disabled) {
                  props.onSend?.();
                }
              }}
              className={`h-9 ${INPUT_CLASS}`}
            />
            <Button
              size="icon-sm"
              aria-label="Send"
              title="Send"
              disabled={disabled}
              onClick={() => props.onSend?.()}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </>
      )}
      {state.notice !== null && (
        <p role="status" className="px-4 pb-2 text-[12px] text-red-600">
          {state.notice}
        </p>
      )}
    </section>
  );
}

// requestChange calls the AI and maps the answer onto one event.
// def is the snapshot of the accept guard.
export async function requestChange(opts: {
  version: Version;
  def: ProcessDefinition;
  text: string;
  change: typeof changeProcess;
}): Promise<ChatEvent> {
  try {
    const answer = await opts.change(opts.version.id, opts.text);
    return { type: "answer", base: opts.def, next: answer.definition };
  } catch (err) {
    return errorEvent(err);
  }
}

// requestRestate asks the AI to restate the request and maps the
// answer onto one event.
export async function requestRestate(opts: {
  version: Version;
  text: string;
  restate: typeof restateChange;
}): Promise<ChatEvent> {
  try {
    const answer = await opts.restate(opts.version.id, opts.text);
    return { type: "restated", text: answer.restatement, questions: answer.questions };
  } catch (err) {
    return errorEvent(err);
  }
}

// errorEvent maps one failed AI call onto the error event.
function errorEvent(err: unknown): ChatEvent {
  if (err instanceof ApiError) {
    return {
      type: "error",
      status: err.status,
      message: err.message,
      details: err.details.map((detail) => {
        const message = (detail as { message?: unknown } | null)?.message;
        return typeof message === "string" ? message : String(detail);
      }),
    };
  }
  return { type: "error", status: 0, message: String(err), details: [] };
}

// readRestateFirst reads the stored switch value: only "0" turns the
// restate step off.
export function readRestateFirst(raw: string | null): boolean {
  return raw !== "0";
}

// acceptProposal applies the guard, then saves. It returns "stale"
// (the loaded def differs from the snapshot, update not called),
// "ok" (update called with (version.id, proposal)) or "failed"
// (update threw).
export async function acceptProposal(opts: {
  snapshot: ProcessDefinition;
  def: ProcessDefinition;
  proposal: ProcessDefinition;
  version: Version;
  update: typeof updateDraft;
}): Promise<"ok" | "stale" | "failed"> {
  if (JSON.stringify(opts.def) !== JSON.stringify(opts.snapshot)) {
    return "stale";
  }
  try {
    await opts.update(opts.version.id, opts.proposal);
    return "ok";
  } catch {
    return "failed";
  }
}

// AssistantChat holds the thread, the collapse flag and the pending
// proposal, maps its async calls onto chatEvent, and renders the
// view. The thread lives here only: no storage, and the model gets
// only the current request, no history. Only the restate switch is
// stored, in localStorage.
export function AssistantChat({
  version,
  def,
  onProposal,
  onAccepted,
  listHeight,
}: {
  version: Version;
  def: ProcessDefinition;
  onProposal: (next: ProcessDefinition | null) => void;
  onAccepted: () => void;
  listHeight?: number;
}) {
  const [state, setState] = useState<ChatState>({ turns: [], notice: null });
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [pending, setPending] = useState<{
    snapshot: ProcessDefinition;
    proposal: ProcessDefinition;
  } | null>(null);
  const [pendingRequest, setPendingRequest] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [restateFirst, setRestateFirst] = useState(() => {
    if (typeof localStorage === "undefined") {
      return true;
    }
    try {
      return readRestateFirst(localStorage.getItem(RESTATE_KEY));
    } catch {
      return true;
    }
  });

  function changeRestateFirst(on: boolean) {
    setRestateFirst(on);
    try {
      localStorage.setItem(RESTATE_KEY, on ? "1" : "0");
    } catch {
      // The switch still works for this page.
    }
  }

  function send() {
    const text = draft.trim();
    if (text === "" || accepting) {
      return;
    }
    setState((current) => chatEvent(current, { type: "send", text }));
    setDraft("");
    if (!restateFirst) {
      runChange(text);
      return;
    }
    setPendingRequest(text);
    void requestRestate({ version, text, restate: restateChange }).then((event) => {
      setState((current) => chatEvent(current, event));
      if (event.type === "restated") {
        setAnswers(defaultAnswers(event.questions));
      }
    });
  }

  function confirm() {
    const last = state.turns[state.turns.length - 1];
    const questions = last?.kind === "restate" ? (last.questions ?? []) : [];
    if (questions.length === 0) {
      setState((current) => chatEvent(current, { type: "confirm" }));
      runChange(pendingRequest);
      return;
    }
    const text = answerLines(questions, answers).join("\n");
    setState((current) => chatEvent(current, { type: "confirm", text }));
    runChange(composeMessage(pendingRequest, questions, answers));
  }

  function rephrase() {
    setState((current) => chatEvent(current, { type: "rephrase" }));
    setDraft(pendingRequest);
  }

  // runChange asks the AI for the changed process. The last turn is
  // waiting when it starts.
  function runChange(text: string) {
    // The def of the request is the snapshot of the accept guard.
    const snapshot = def;
    void requestChange({ version, def: snapshot, text, change: changeProcess }).then(
      (event) => {
        setState((current) => chatEvent(current, event));
        if (event.type === "answer") {
          const { rows } = diffDefinitions(event.base, event.next);
          if (rows.length > 0) {
            setPending({ snapshot, proposal: event.next });
            onProposal(event.next);
            return;
          }
        }
        setPending(null);
        onProposal(null);
      },
    );
  }

  async function accept() {
    if (pending === null || accepting) {
      return;
    }
    setAccepting(true);
    try {
      const result = await acceptProposal({
        snapshot: pending.snapshot,
        def,
        proposal: pending.proposal,
        version,
        update: updateDraft,
      });
      if (result === "stale") {
        setState((current) => chatEvent(current, { type: "accept-stale" }));
        setPending(null);
        onProposal(null);
      } else if (result === "failed") {
        // The proposal stays, so the designer can retry.
        setState((current) => chatEvent(current, { type: "save-failed" }));
      } else {
        setState((current) =>
          chatEvent(current, { type: "accept-ok", versionNumber: version.number }),
        );
        setPending(null);
        onProposal(null);
        onAccepted();
      }
    } finally {
      setAccepting(false);
    }
  }

  function reject() {
    setState((current) => chatEvent(current, { type: "reject" }));
    setPending(null);
    onProposal(null);
  }

  return (
    <ChatPanelView
      state={state}
      version={version}
      collapsed={collapsed}
      restateFirst={restateFirst}
      onRestateFirstChange={changeRestateFirst}
      listHeight={listHeight}
      draft={draft}
      onDraftChange={setDraft}
      onSend={send}
      onToggle={() => setCollapsed((v) => !v)}
      onAccept={() => void accept()}
      onReject={reject}
      onConfirm={confirm}
      onRephrase={rephrase}
      answers={answers}
      onAnswersChange={setAnswers}
      accepting={accepting}
    />
  );
}
