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
import { changeProcess } from "./ai-api";
import { diffChips, diffDefinitions, type DiffRow } from "./diff";
import { Button } from "@/ui/button";
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

// ChatTurn is one message of the thread: the user text, or the main
// text of one AI state, with the diff of a proposal and the details
// of a validation error.
export interface ChatTurn {
  kind: "user" | "waiting" | "proposal" | "none" | "accepted" | "rejected" | "error";
  text: string;
  chips: string[];
  rows: DiffRow[];
  details: string[];
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
  | { type: "reject" };

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
function ChatTurnView({ turn, accepting, onAccept, onReject }: {
  turn: ChatTurn;
  accepting: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}) {
  if (turn.kind === "user") {
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[80%] rounded-lg bg-zinc-100 px-3 py-1.5 text-[13px] text-zinc-800">
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
  listHeight?: number;
  draft?: string;
  onDraftChange?: (text: string) => void;
  onSend?: () => void;
  onToggle?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  accepting?: boolean;
}): ReactElement {
  const { state, version, collapsed, listHeight = 220 } = props;
  const last = state.turns[state.turns.length - 1] ?? null;
  const pending = last !== null && last.kind === "proposal";
  const waiting = last !== null && last.kind === "waiting";
  const threadRef = useRef<HTMLDivElement | null>(null);
  // After each new message, the thread shows the last message.
  useEffect(() => {
    const el = threadRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.turns.length]);
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
                accepting={props.accepting ?? false}
                onAccept={props.onAccept}
                onReject={props.onReject}
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
              className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-[13px] outline-none"
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
// only the current request, no history.
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

  function send() {
    const text = draft.trim();
    if (text === "" || accepting) {
      return;
    }
    // The def of the send is the snapshot of the accept guard.
    const snapshot = def;
    setState((current) => chatEvent(current, { type: "send", text }));
    setDraft("");
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
      listHeight={listHeight}
      draft={draft}
      onDraftChange={setDraft}
      onSend={send}
      onToggle={() => setCollapsed((v) => !v)}
      onAccept={() => void accept()}
      onReject={reject}
      accepting={accepting}
    />
  );
}
