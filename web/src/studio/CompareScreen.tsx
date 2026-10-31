// The compare screen: the diagram of the compared version with its
// added and changed steps, the open cases of the base version, the
// list of differences and the changelog. The diff is the pure diff
// of the proposal bar.

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowLeftRight, Minus, Pencil, Plus, Sparkles, Users } from "lucide-react";
import { fetchSupervision, type Supervision } from "../app/sup-api";
import { summarizeChanges } from "./ai-api";
import { ApiError, getVersion } from "./api";
import {
  changeLines,
  comparePair,
  impactRows,
  pickPair,
  stageText,
  swapPair,
  versionText,
} from "./compare";
import { ProcessDiagram } from "./diagram";
import { newestPublished } from "./version-actions";
import { changedIds, diffChips, diffDefinitions, type DiffRow } from "./diff";
import { Button } from "@/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import type { ProcessDefinition, VersionSummary } from "./types";

const GREEN = "#16a34a";
const RED = "#dc2626";
const AMBER = "#d97706";

const ROW_ICON: Record<DiffRow["kind"], [typeof Plus, string]> = {
  add: [Plus, GREEN],
  remove: [Minus, RED],
  modify: [Pencil, AMBER],
};

function chipColor(chip: string): string | null {
  if (chip === "No change") {
    return null;
  }
  return chip.startsWith("+") ? GREEN : chip.startsWith("-") ? RED : AMBER;
}

function noop() {}

const NO_SUMMARY = { busy: false, text: null, error: null };

export function CompareScreen({ versions, openId, baseId, onClose }: {
  versions: VersionSummary[];
  openId: string;
  baseId: string | null;
  onClose: () => void;
}) {
  const [pair, setPair] = useState(() => comparePair(versions, openId, baseId));
  const [summary, setSummary] = useState<{
    busy: boolean;
    text: string | null;
    error: string | null;
  }>(NO_SUMMARY);
  // run counts the pair changes: an answer of an older pair is dropped.
  const run = useRef(0);
  const changePair = (next: typeof pair) => {
    run.current += 1;
    setSummary(NO_SUMMARY);
    setPair(next);
  };
  const base = useQuery({
    queryKey: ["version", pair?.base],
    queryFn: () => getVersion(pair!.base),
    enabled: pair !== null,
  });
  const other = useQuery({
    queryKey: ["version", pair?.other],
    queryFn: () => getVersion(pair!.other),
    enabled: pair !== null,
  });
  const sup = useQuery({
    queryKey: ["supervision", pair?.base],
    queryFn: () => fetchSupervision(pair!.base),
    enabled: pair !== null,
  });
  const baseDef = base.data?.definition;
  const otherDef = other.data?.definition;
  // One diff and one id set per pair: a new set at each render would
  // relayout the diagram.
  const diff = useMemo(
    () =>
      baseDef === undefined || otherDef === undefined
        ? null
        : {
            ...diffDefinitions(baseDef, otherDef),
            ids: changedIds(baseDef, otherDef),
          },
    [baseDef, otherDef],
  );

  const back = (
    <Button variant="ghost" size="sm" onClick={onClose}>
      <ArrowLeft aria-hidden="true" />
      Back to the diagram
    </Button>
  );
  if (pair === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">{back}</div>
        <p className="p-6 text-[13px] text-muted-foreground">
          Compare needs two versions.
        </p>
      </div>
    );
  }

  const newest = newestPublished(versions);
  const versionSelect = (side: "base" | "other", label: string) => (
    <Select
      value={pair[side]}
      onValueChange={(id) => changePair(pickPair(pair, side, id, versions))}
    >
      <SelectTrigger aria-label={label} size="sm" className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {versions.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {versionText(v, newest)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const summarize = (rows: DiffRow[]) => {
    const mine = run.current;
    setSummary({ busy: true, text: null, error: null });
    summarizeChanges(changeLines(rows)).then(
      (answer) => {
        if (run.current === mine) {
          setSummary({ busy: false, text: answer.summary, error: null });
        }
      },
      (err: unknown) => {
        if (run.current === mine) {
          const error = err instanceof ApiError ? err.message : "Network error.";
          setSummary({ busy: false, text: null, error });
        }
      },
    );
  };

  const stage = stageText(base, other);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        {back}
        <span className="text-[12.5px] text-muted-foreground">Compare</span>
        {versionSelect("base", "Base version")}
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Swap the versions"
          onClick={() => changePair(swapPair(pair))}
        >
          <ArrowLeftRight aria-hidden="true" />
        </Button>
        {versionSelect("other", "Compared version")}
      </div>
      {stage !== null || diff === null || base.data === undefined || other.data === undefined ? (
        <p className="p-6 text-[13px] text-muted-foreground">{stage}</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <ProcessDiagram
                def={other.data.definition}
                selectedNodeId={null}
                onNodeSelect={noop}
                ghost={false}
                ghostIds={diff.ids}
                onCitationClick={noop}
                minimap={false}
              />
              <p className="absolute top-3 left-3 z-10 rounded-md border bg-card px-3 py-1.5 text-[13px] shadow-xs">
                {`Diagram of v${other.data.number} · ${other.data.label}, differences with v${base.data.number}`}
              </p>
              <p className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[12px] shadow-xs">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-sm border"
                  style={{ borderColor: "#7c3aed", backgroundColor: "#7c3aed1a" }}
                />
                Added or changed
              </p>
            </div>
            <div className="shrink-0 border-t">
              <ImpactBlock
                baseNumber={base.data.number}
                sup={sup.data}
                error={sup.error}
                def={base.data.definition}
              />
            </div>
          </div>
          <aside
            aria-label="Differences"
            className="flex w-[400px] shrink-0 flex-col gap-3 overflow-y-auto border-l p-4"
          >
            <p className="text-[12.5px] text-muted-foreground">
              {`Base v${base.data.number} · target v${other.data.number} · ${diff.rows.length} ${diff.rows.length === 1 ? "change" : "changes"}`}
            </p>
            <h2 className="text-[16px] font-semibold">Differences</h2>
            <div className="flex flex-wrap gap-1.5">
              {diffChips(diff.counts).map((chip) => {
                const color = chipColor(chip);
                return (
                  <span
                    key={chip}
                    className="rounded-full border px-2 py-0.5 text-[12px] font-medium text-muted-foreground"
                    style={
                      color === null
                        ? undefined
                        : { color, borderColor: color, backgroundColor: `${color}14` }
                    }
                  >
                    {chip}
                  </span>
                );
              })}
            </div>
            <ul className="flex flex-col gap-2">
              {diff.rows.map((row, i) => {
                const [Icon, color] = ROW_ICON[row.kind];
                return (
                  <li key={i} className="flex items-center gap-2 text-[13px]">
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded"
                      style={{ color, backgroundColor: `${color}1a` }}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    {row.text}
                  </li>
                );
              })}
            </ul>
            <SummaryBlock
              empty={diff.rows.length === 0}
              {...summary}
              onSummarize={() => summarize(diff.rows)}
            />
            <h2 className="pt-2 text-[16px] font-semibold">Changelog</h2>
            <pre
              aria-label="Changelog"
              className="rounded-md border bg-muted/40 p-3 font-mono text-[12px] whitespace-pre-wrap"
            >
              {diff.rows.length === 0 ? "No change." : changeLines(diff.rows).join("\n")}
            </pre>
          </aside>
        </div>
      )}
    </div>
  );
}

// SummaryBlock shows the AI summary of the differences. The engine
// computes the changes; the AI only summarizes them.
export function SummaryBlock({ empty, busy, text, error, onSummarize }: {
  empty: boolean;
  busy: boolean;
  text: string | null;
  error: string | null;
  onSummarize: () => void;
}) {
  let body;
  if (text !== null) {
    body = <p className="text-[13px]">{text}</p>;
  } else if (error !== null) {
    body = <p className="text-[13px]" style={{ color: RED }}>{`The summary did not load. ${error}`}</p>;
  } else if (!busy) {
    body = (
      <p className="text-[13px] text-muted-foreground">
        The AI writes a short summary of the changes.
      </p>
    );
  }
  return (
    <section aria-label="Summary" className="flex flex-col gap-2">
      <h2 className="pt-2 text-[16px] font-semibold">Summary</h2>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={empty || busy}
        onClick={onSummarize}
      >
        <Sparkles aria-hidden="true" />
        {busy ? "Summarizing…" : "Summarize with AI"}
      </Button>
      {body}
    </section>
  );
}

// ImpactBlock counts the open cases of the base version. They stay on
// it: the engine runs a case on the version where it started.
export function ImpactBlock({ baseNumber, sup, error, def }: {
  baseNumber: number;
  sup: Supervision | undefined;
  error: Error | null;
  def: ProcessDefinition;
}) {
  let body;
  if (error !== null) {
    body = <p className="text-[13px] text-muted-foreground">The open cases did not load.</p>;
  } else if (sup === undefined) {
    body = <p className="text-[13px] text-muted-foreground">Counting the open cases…</p>;
  } else if (sup.total_open === 0) {
    body = <p className="text-[13px] text-muted-foreground">{`No open case on v${baseNumber}.`}</p>;
  } else {
    body = (
      <div className="flex gap-6">
        <div className="flex w-64 shrink-0 flex-col gap-1">
          <p className="flex items-baseline gap-2">
            <span className="text-[28px] leading-none font-semibold">{sup.total_open}</span>
            <span className="text-[13px] text-muted-foreground">{`open cases on v${baseNumber}`}</span>
          </p>
          <p className="text-[13px] text-muted-foreground">
            {`They stay on v${baseNumber} until their end. New cases start on the published version.`}
          </p>
        </div>
        <ul className="grid flex-1 grid-cols-3 content-start gap-x-6 gap-y-2 text-[12.5px]">
          {impactRows(sup, def).map((row) => (
            <li key={row.name} className="flex justify-between gap-2 border-b pb-1">
              <span className="truncate">{row.name}</span>
              <span className="font-medium tabular-nums">{row.open}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <section aria-label="Impact on open cases" className="flex flex-col gap-2 p-4">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        <Users aria-hidden="true" className="size-4" />
        Impact on open cases
      </h2>
      {body}
    </section>
  );
}
