// The horizontal timeline of the test screen, with the player
// controls. One point stands for one step of the case: the raw events
// of the step (submit, checks, decision, links) group under it, and a
// tooltip lists them. The steps the case still has to take show in
// grey after the current point. A click on a past point moves the
// replay position; TestScreen owns the position.

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
} from "lucide-react";
import { Button } from "@/ui/button";
import { Hint } from "@/ui/hint";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";
import type { CaseEvent, CaseState } from "./case-api";
import { diagramEdgeText } from "./layout";
import { eventLabel } from "./Timeline";
import type { ProcessDefinition } from "./types";

// Milestone is one point of the timeline: the events from one step
// entry (or the case creation) up to the next one.
export interface Milestone {
  label: string; // the step name, or "Case created"
  detail: string; // who acted, the decision or the link taken
  firstSeq: number;
  lastSeq: number;
  at: string; // time of the first event
  failed: boolean; // a check of the step failed and did not pass after
  events: CaseEvent[];
}

// milestonesOf groups the events into milestones. A step_entered or a
// case_closed event opens a new point; every other event joins the
// open point.
export function milestonesOf(
  def: ProcessDefinition,
  events: CaseEvent[],
  userName: (id: string) => string,
): Milestone[] {
  const nodeName = (id: unknown) =>
    def.nodes.find((n) => n.id === id)?.name ?? String(id ?? "");
  const out: Milestone[] = [];
  for (const e of events) {
    const opens =
      out.length === 0 || e.type === "step_entered" || e.type === "case_closed";
    if (opens) {
      const label =
        e.type === "step_entered"
          ? nodeName(e.payload.node_id)
          : e.type === "case_closed"
            ? `Closed: ${String(e.payload.result ?? "")}`
            : e.type === "case_created"
              ? (def.nodes.find((n) => n.type === "start")?.name ?? "Case created")
              : eventLabel(def, e);
      out.push({
        label,
        detail: "",
        firstSeq: e.seq,
        lastSeq: e.seq,
        at: e.at,
        failed: false,
        events: [e],
      });
    } else {
      const m = out[out.length - 1]!;
      m.lastSeq = e.seq;
      m.events.push(e);
    }
  }
  // The detail line: the decision, else the link text of a gateway,
  // else the person who submitted or created.
  for (const m of out) {
    const last = new Map<string, boolean>();
    let actor: string | null = null;
    let decision: string | null = null;
    let link: string | null = null;
    for (const e of m.events) {
      if (e.type === "check_evaluated") {
        last.set(String(e.payload.check_id), e.payload.result === true);
      } else if (e.type === "decision_made") {
        decision = String(e.payload.decision ?? "");
      } else if (e.type === "edge_taken") {
        const edge = def.edges.find((ed) => ed.id === e.payload.edge_id);
        link = edge === undefined ? null : diagramEdgeText(edge, def);
      } else if (
        (e.type === "data_submitted" || e.type === "case_created") &&
        e.actor !== "system"
      ) {
        actor = userName(e.actor);
      }
    }
    m.failed = [...last.values()].some((ok) => !ok);
    m.detail =
      decision !== null
        ? `Decision: ${decision}`
        : actor !== null
          ? `by ${actor}`
          : (link ?? "");
  }
  return out;
}

// upcomingOf gives the names of the steps the case still has to take
// on the shortest path to an approved end, current step excluded. A
// closed case has none.
export function upcomingOf(def: ProcessDefinition, state: CaseState): string[] {
  if (state.status === "closed" || state.node_id === null) {
    return [];
  }
  const prev = new Map<string, string>();
  const seen = new Set([state.node_id]);
  const queue = [state.node_id];
  let goal: string | null = null;
  while (queue.length > 0 && goal === null) {
    const id = queue.shift()!;
    for (const edge of def.edges.filter((e) => e.from === id)) {
      if (seen.has(edge.to)) {
        continue;
      }
      seen.add(edge.to);
      prev.set(edge.to, id);
      const to = def.nodes.find((n) => n.id === edge.to);
      if (to?.type === "end" && to.end_result === "approved") {
        goal = edge.to;
        break;
      }
      queue.push(edge.to);
    }
  }
  const path: string[] = [];
  for (let id = goal; id !== null && id !== state.node_id; id = prev.get(id) ?? null) {
    path.unshift(def.nodes.find((n) => n.id === id)?.name ?? id);
  }
  return path;
}

const SPEEDS = [1, 2, 4] as const;

function timeText(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function TimelineBar({ def, events, state, at, onSelect, userName }: {
  def: ProcessDefinition;
  events: CaseEvent[];
  state: CaseState; // the present state, for the upcoming steps
  at: number | null; // replay position (event count), null = present
  onSelect: (at: number | null) => void;
  userName: (id: string) => string;
}) {
  const points = milestonesOf(def, events, userName);
  const upcoming = upcomingOf(def, state);
  const count = events.length;
  const n = at ?? count;
  const lastIndex = points.length - 1;
  // The point that holds the position.
  const current = Math.max(
    0,
    points.findIndex((m) => m.firstSeq <= n && n <= m.lastSeq),
  );
  // seek moves to the end of one point; the last point is the
  // present.
  const seek = (i: number) => onSelect(i >= lastIndex ? null : points[i]!.lastSeq);

  // Play walks the points from the position to the present.
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  // The play stops by itself at the present.
  const isPlaying = playing && at !== null;
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const timer = setTimeout(() => seek(current + 1), 1400 / speed);
    return () => clearTimeout(timer);
  });

  // The current point stays in view when the line scrolls.
  const listRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-current="true"]');
    if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  }, [current, points.length]);

  // A cut side of the line shows a scroll control.
  const [sides, setSides] = useState({ left: false, right: false });
  function measure() {
    const el = listRef.current;
    if (el) {
      setSides(overflowSides(el.scrollLeft, el.scrollWidth, el.clientWidth));
    }
  }
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [points.length, upcoming.length]);
  // One page is the column width less one point, so one point stays visible.
  function scrollPage(dir: 1 | -1) {
    const el = listRef.current;
    if (el) {
      el.scrollBy({ left: dir * Math.max(132, el.clientWidth - 132), behavior: "smooth" });
    }
  }

  const atStart = points.length === 0 || (at !== null && current === 0);

  return (
    <div className="flex min-w-0 shrink-0 flex-col border-t bg-background [contain:inline-size]">
      <div className="flex items-center gap-1 px-3 pt-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Go to the start"
          disabled={atStart}
          onClick={() => seek(0)}
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Step back"
          disabled={atStart}
          onClick={() => seek(current - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={points.length < 2}
          onClick={() => {
            if (isPlaying) {
              setPlaying(false);
              return;
            }
            if (at === null) {
              seek(0);
            }
            setPlaying(true);
          }}
        >
          {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Step forward"
          disabled={at === null}
          onClick={() => seek(current + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Go to the end"
          disabled={at === null}
          onClick={() => {
            setPlaying(false);
            onSelect(null);
          }}
        >
          <ChevronsRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-10 px-0 text-[12px]"
          aria-label={`Speed ${speed}x`}
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}
        >
          {`${speed}x`}
        </Button>
        <span className="ml-2 truncate text-[13px]">
          {points.length === 0 ? (
            "No events yet."
          ) : (
            <>
              Event <b>{current + 1}</b> of <b>{points.length}</b>
              {` · ${points[current]!.label}`}
            </>
          )}
        </span>
        <span className="ml-1 font-mono text-[11px] text-muted-foreground">{`(${n} of ${count})`}</span>
        <span className="flex-1" />
        <span className="hidden text-[12.5px] text-muted-foreground lg:inline">
          Click a past event to replay from it.
        </span>
        <Hint label="About the timeline" side="top">
          One point stands for one step of the case. Hover a point to see
          its events. The grey points are the steps still to come on the
          path to approval.
        </Hint>
      </div>
      <TooltipProvider delayDuration={200}>
        <div className="relative">
          <ol
            ref={listRef}
            aria-label="Timeline"
            onScroll={measure}
            className="flex overflow-x-auto px-3 pt-3 pb-2"
          >
            {points.map((m, i) => {
              const isCurrent = i === current;
              const done = i < current;
              const dot = m.failed
                ? "border-red-500 bg-red-500"
                : isCurrent
                  ? "border-blue-600 bg-blue-600 ring-4 ring-blue-100"
                  : "border-emerald-600 bg-emerald-600";
              const line = done ? "bg-emerald-600" : "bg-border";
              return (
                <li key={m.firstSeq} className="relative flex w-[132px] shrink-0 flex-col items-center">
                  {i > 0 && <span aria-hidden className={`absolute top-[5px] right-1/2 left-0 h-0.5 ${i <= current ? "bg-emerald-600" : "bg-border"}`} />}
                  <span aria-hidden className={`absolute top-[5px] right-0 left-1/2 h-0.5 ${i < lastIndex || upcoming.length > 0 ? line : "bg-transparent"}`} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-current={isCurrent ? "true" : undefined}
                        aria-label={`${m.label}${m.detail === "" ? "" : `, ${m.detail}`}`}
                        onClick={() => {
                          setPlaying(false);
                          seek(i);
                        }}
                        className="group flex flex-col items-center gap-1 rounded-md px-1 text-center focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span className={`relative z-10 size-3 rounded-full border-2 ${dot}`} />
                        <span
                          className={`line-clamp-2 text-[12px] leading-tight ${
                            isCurrent ? "font-semibold text-blue-700" : "text-foreground group-hover:underline"
                          }`}
                        >
                          {m.label}
                        </span>
                        <span className={`line-clamp-1 text-[11px] ${m.failed ? "text-red-600" : "text-muted-foreground"}`}>
                          {m.failed ? "Check failed" : m.detail}
                        </span>
                        <span className={`font-mono text-[10.5px] ${isCurrent ? "text-blue-700" : "text-muted-foreground"}`}>
                          {timeText(m.at)}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[280px]">
                      <ol className="flex flex-col gap-0.5">
                        {m.events.map((e) => (
                          <li key={e.seq}>
                            <span className="mr-1.5 font-mono opacity-70">{e.seq}</span>
                            {eventLabel(def, e, userName)}
                          </li>
                        ))}
                      </ol>
                    </TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
            {upcoming.map((name, i) => (
              <li key={`up-${name}-${i}`} className="relative flex w-[132px] shrink-0 flex-col items-center">
                <span aria-hidden className="absolute top-[5px] right-1/2 left-0 h-0.5 bg-border" />
                {i < upcoming.length - 1 && (
                  <span aria-hidden className="absolute top-[5px] right-0 left-1/2 h-0.5 bg-border" />
                )}
                <span className="relative z-10 size-3 rounded-full border-2 border-border bg-background" />
                <span className="mt-1 line-clamp-2 text-center text-[12px] leading-tight text-muted-foreground">
                  {name}
                </span>
                <span className="text-[11px] text-muted-foreground">upcoming</span>
              </li>
            ))}
          </ol>
          {sides.left && <ScrollEdge side="left" onClick={() => scrollPage(-1)} />}
          {sides.right && <ScrollEdge side="right" onClick={() => scrollPage(1)} />}
        </div>
      </TooltipProvider>
    </div>
  );
}

// overflowSides tells which sides of a scrolled list hide content. The
// 1 px margin absorbs the fractional scrollLeft of a zoomed page.
export function overflowSides(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): { left: boolean; right: boolean } {
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 };
}

// ScrollEdge is the fade and the scroll button on one cut side.
export function ScrollEdge({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const left = side === "left";
  return (
    <div
      className={`pointer-events-none absolute inset-y-0 flex w-12 items-center ${
        left
          ? "left-0 justify-start bg-gradient-to-r from-background"
          : "right-0 justify-end bg-gradient-to-l from-background"
      }`}
    >
      <Button
        variant="outline"
        size="icon-sm"
        className="pointer-events-auto"
        aria-label={left ? "Scroll the timeline left" : "Scroll the timeline right"}
        onClick={onClick}
      >
        {left ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </Button>
    </div>
  );
}
