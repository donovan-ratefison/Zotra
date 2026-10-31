// The case flow of the supervision: the passes of the last days as a
// flow diagram from the start to the ends. Each step is one bar, each
// forward link is one band, and the band width shows its passes.

import { diagramEdgeText, walk } from "../studio/layout";
import type { ProcessDefinition, ProcessEdge } from "../studio/types";
import { edgeKind } from "./LiveFlow";
import type { Flow } from "./sup-api";
import { decisionLabel } from "./triage";

export interface FlowBar { nodeId: string; name: string; column: number; value: number }
export interface FlowBand { edgeId: string; from: string; to: string; value: number; refused: boolean; label: string | null }

// bandLabel gives the text of one band: the decision, the gateway
// question with its answer, or the edge text, with the passes. It
// gives null when the edge has no text.
export function bandLabel(
  def: ProcessDefinition,
  edge: ProcessEdge,
  value: number,
): string | null {
  if (edge.decision !== null) {
    return `${decisionLabel(edge.decision)}: ${value}`;
  }
  const t = diagramEdgeText(edge, def);
  if (t === null) {
    return null;
  }
  const source = def.nodes.find((n) => n.id === edge.from);
  return source?.type === "gateway"
    ? `${source.name} ${t}: ${value}`
    : `${t}: ${value}`;
}

// graph gives the walk of the definition: the back links, the forward
// links, and the collapse of a gateway with one way in. `origin` of a
// collapsed gateway is its source step.
function graph(def: ProcessDefinition) {
  const startId = def.nodes.find((n) => n.type === "start")?.id ?? "";
  const { back } = walk(def, startId);
  const forward = def.edges.filter((e) => !back.has(e.id));
  const nodeOf = (id: string) => def.nodes.find((n) => n.id === id);
  const collapsed = (id: string) =>
    nodeOf(id)?.type === "gateway" &&
    forward.filter((e) => e.to === id).length === 1;
  const origin = (id: string): string =>
    collapsed(id) ? origin(forward.find((e) => e.to === id)!.from) : id;
  return { startId, back, forward, nodeOf, collapsed, origin };
}

const passesOf = (flow: Flow, id: string) =>
  flow.edges.find((p) => p.edge_id === id)?.passes ?? 0;

export interface LimitPath {
  condition: string;
  targetId: string;
  targetName: string;
  passes: number;
  total: number;
  decisions: { label: string; value: number; kind: "forward" | "back" | "refused" }[];
}

// limitPath gives the gateway path above the amount limit: the first
// gateway condition that names a money field. It gives null when no
// condition names a money field.
export function limitPath(def: ProcessDefinition, flow: Flow): LimitPath | null {
  const { back, nodeOf } = graph(def);
  const money = def.fields.filter((f) => f.type === "money");
  const edge = def.edges.find(
    (e) =>
      nodeOf(e.from)?.type === "gateway" &&
      e.condition !== null &&
      !e.is_default &&
      !back.has(e.id) &&
      money.some((f) => new RegExp(`\\b${f.name}\\b`).test(e.condition!)),
  );
  const target = edge && nodeOf(edge.to);
  if (!edge || !target) {
    return null;
  }
  const out = (id: string) => def.edges.filter((e) => e.from === id);
  const decisions =
    target.type !== "task"
      ? []
      : target.decisions.map((d) => {
          const e = out(target.id).find((x) => x.decision === d);
          const kind = e ? edgeKind(def, e, back) : "forward";
          const label = decisionLabel(d) + (kind === "back" ? ` to ${nodeOf(e!.to)?.name}` : "");
          return { label, value: e ? passesOf(flow, e.id) : 0, kind };
        });
  return {
    condition: edge.condition!,
    targetId: target.id,
    targetName: target.name,
    passes: passesOf(flow, edge.id),
    total: out(edge.from).reduce((s, e) => s + passesOf(flow, e.id), 0),
    decisions,
  };
}

// leadRows gives one row for each end: its cases, its average lead
// time in days, and the bar width against the longest lead time.
export function leadRows(def: ProcessDefinition, flow: Flow) {
  const rows = def.nodes
    .filter((n) => n.type === "end")
    .map((n) => {
      const end = flow.ends.find((e) => e.node_id === n.id);
      const cases = end?.cases ?? 0;
      return { n, cases, hours: cases === 0 ? 0 : (end?.avg_lead_hours ?? 0) };
    });
  const maxHours = Math.max(0, ...rows.map((r) => r.hours));
  return rows.map(({ n, cases, hours }) => ({
    nodeId: n.id,
    name: n.name,
    cases,
    days: cases === 0 ? "-" : `${(hours / 24).toFixed(1)} d`,
    width: maxHours === 0 ? 0 : (hours / maxHours) * 100,
    refused: n.end_result === "refused",
  }));
}

// returnsText says how many cases went back on each back link.
export function returnsText(def: ProcessDefinition, flow: Flow): string {
  const { back, nodeOf, origin } = graph(def);
  const parts = def.edges
    .filter((e) => back.has(e.id) && passesOf(flow, e.id) > 0)
    .map((e) => {
      const n = passesOf(flow, e.id);
      const from = origin(e.from) === e.to ? "" : ` from ${nodeOf(origin(e.from))?.name}`;
      return `${n === 1 ? "1 case" : `${n} cases`} went back to ${nodeOf(e.to)?.name}${from}.`;
    });
  return parts.length === 0 ? "No case went back." : parts.join(" ");
}

// rateText gives the return rate of the closed cases.
export function rateText(flow: Flow): string {
  if (flow.closed === 0) {
    return `No closed case in ${flow.days} days.`;
  }
  const r = flow.returns;
  return `Return rate: ${r === 1 ? "1 return" : `${r} returns`} on ${flow.closed} closed cases, ${Math.round((r / flow.closed) * 100)} percent.`;
}

// caseFlow gives the columns, the bars and the bands of the flow. A
// gateway with one way in folds into its bands, so each column is a
// step. Back links draw no band.
export function caseFlow(
  def: ProcessDefinition,
  flow: Flow,
): { columns: number; bars: FlowBar[]; bands: FlowBand[] } {
  const { startId, forward, nodeOf, collapsed, origin } = graph(def);
  const passes = new Map(flow.edges.map((p) => [p.edge_id, p.passes]));
  const links = forward
    .filter((e) => !collapsed(e.to))
    .map((e) => ({ edge: e, from: origin(e.from), to: e.to, value: passes.get(e.id) ?? 0 }));

  const kept = def.nodes.filter((n) => !collapsed(n.id));
  const isEnd = (id: string) => nodeOf(id)?.type === "end";
  const col = new Map<string, number>([[startId, 0]]);
  // Longest path: the forward graph has no loop, so this stops.
  for (let changed = true; changed; ) {
    changed = false;
    for (const l of links) {
      const c = col.get(l.from);
      if (c !== undefined && !isEnd(l.to) && (col.get(l.to) ?? -1) < c + 1) {
        col.set(l.to, c + 1);
        changed = true;
      }
    }
  }
  const last =
    Math.max(0, ...kept.filter((n) => n.type !== "end").map((n) => col.get(n.id) ?? 0)) + 1;

  const bands: FlowBand[] = links
    .filter((l) => l.value > 0)
    .map((l) => {
      const to = nodeOf(l.to);
      return {
        edgeId: l.edge.id,
        from: l.from,
        to: l.to,
        value: l.value,
        refused: to?.type === "end" && to.end_result === "refused",
        label: bandLabel(def, l.edge, l.value),
      };
    });
  const sum = (list: FlowBand[]) => list.reduce((s, b) => s + b.value, 0);
  const bars = kept.map((n) => ({
    nodeId: n.id,
    name: n.name,
    column: n.type === "end" ? last : (col.get(n.id) ?? 0),
    value: Math.max(
      sum(bands.filter((b) => b.to === n.id)),
      sum(bands.filter((b) => b.from === n.id)),
    ),
  }));
  return { columns: last + 1, bars, bands };
}

// spaceLabels sorts the labels by y, top first, and moves each label
// down only, so that it starts at least `gap` units below the one
// above it.
export function spaceLabels<T extends { y: number }>(labels: T[], gap: number): T[] {
  const out = [...labels].sort((a, b) => a.y - b.y).map((l) => ({ ...l }));
  for (let i = 1; i < out.length; i++) {
    out[i]!.y = Math.max(out[i]!.y, out[i - 1]!.y + gap);
  }
  return out;
}

// placeBandLabels places the band labels of one column gap: 14 units
// apart at least, and each ends 6 units before gapRight (the left
// edge of the next column of bars). The width is an estimate, 6.2
// units for each character. A long label loses the end of its name,
// never its count. A gateway label "<question>? <answer>" loses the
// end of its question first, and keeps its answer when it can.
export function placeBandLabels(
  labels: { id: string; x: number; y: number; text: string }[],
  gapRight: number,
): { id: string; x: number; y: number; text: string }[] {
  return spaceLabels(labels, 14).map((l) => {
    const room = Math.floor((gapRight - 6 - l.x) / 6.2);
    if (l.text.length <= room) {
      return l;
    }
    const cut = l.text.lastIndexOf(": ");
    const count = l.text.slice(cut);
    const full = l.text.slice(0, cut);
    const q = full.indexOf("? ");
    const tail = `…${full.slice(q)}${count}`;
    if (q >= 0 && tail.length <= room) {
      return { ...l, text: `${full.slice(0, room - tail.length).trimEnd()}${tail}` };
    }
    const name = full.slice(0, Math.max(0, room - count.length - 1));
    return { ...l, text: `${name.trimEnd()}…${count}` };
  });
}

const W = 930;
const H = 460;
const TOP = 44;
const BW = 12;
const GAP = 22;
const LEFT = 20;
const RIGHT = 170;

const END_FILL: Record<string, string> = { approved: "#0f766e", refused: "#b91c1c" };

// CaseFlowCard is the card of the "Case flow" tab: the head and the
// flow diagram, and the side column that explains the flow.
export function CaseFlowCard({ def, flow }: { def: ProcessDefinition; flow: Flow }) {
  const { columns, bars, bands } = caseFlow(def, flow);
  const limit = limitPath(def, flow);
  const bandFill = (b: FlowBand) =>
    b.refused ? "#ef4444" : limit && (b.from === limit.targetId || b.to === limit.targetId) ? "#2563eb" : "#0f766e";
  const step = (W - LEFT - RIGHT - BW) / Math.max(1, columns - 1);
  const X = (c: number) => LEFT + c * step;
  const cols = Array.from({ length: columns }, (_, c) => bars.filter((b) => b.column === c));
  const maxBars = Math.max(...cols.map((list) => list.length));
  const maxSum = Math.max(...cols.map((list) => list.reduce((s, b) => s + b.value, 0)));
  const K = maxSum === 0 ? 6 : Math.min(6, (H - TOP - 10 - GAP * (maxBars - 1)) / maxSum);

  const barY = new Map<string, number>();
  for (const list of cols) {
    let y = TOP;
    for (const b of list) {
      barY.set(b.nodeId, y);
      y += b.value * K + GAP;
    }
  }
  // The bands out of a bar, and into a bar, stack from the bar top.
  const outY = new Map(barY);
  const inY = new Map(barY);
  const paths = bands.map((b) => {
    const y0 = outY.get(b.from)!;
    const y1 = inY.get(b.to)!;
    const h = b.value * K;
    outY.set(b.from, y0 + h);
    inY.set(b.to, y1 + h);
    const col = bars.find((r) => r.nodeId === b.from)!.column;
    const xa = X(col) + BW;
    const xb = X(bars.find((r) => r.nodeId === b.to)!.column);
    return { b, col, y0, y1, h, xa, xb, mx: (xa + xb) / 2 };
  });
  const last = columns - 1;
  // One call for each column gap: the labels of the bands that leave
  // the bars of column c.
  const labels = Array.from({ length: columns }, (_, c) =>
    placeBandLabels(
      paths
        .filter((p) => p.b.label !== null && p.col === c)
        .map((p) => ({ id: p.b.edgeId, x: p.xa + 6, y: p.y0 + p.h / 2 + 4, text: p.b.label! })),
      X(c + 1),
    ),
  ).flat();
  const endOf = (id: string) => def.nodes.find((n) => n.id === id);

  return (
    <div className="mb-4 rounded-lg border bg-card">
      <div className="flex h-10 items-center justify-between gap-4 border-b px-4">
        <h2 className="truncate text-[13.5px] font-semibold">
          {`Case flow, last ${flow.days} days`}
        </h2>
        <p className="truncate text-xs text-muted-foreground">
          {`${flow.closed} cases closed in ${flow.days} days. The band width shows the passes on each link.`}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_310px]">
        {bands.length === 0 ? (
          <p className="p-4 text-[13px] text-muted-foreground">
            {`No case passed a link in ${flow.days} days.`}
          </p>
        ) : (
          <div className="min-w-0 pt-2.5 pr-2 pl-4">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full"
              role="img"
              aria-label={`Case flow of ${def.name}, last ${flow.days} days`}
            >
              {cols.map((list, c) => (
                <foreignObject key={c} x={X(c)} y={0} width={c === last ? 160 : step - 6} height={40}>
                  <div className="line-clamp-2 text-[11px] leading-[13px] font-medium text-muted-foreground">
                    {c === last ? "Outcome" : list.map((b) => b.name).join(" / ")}
                  </div>
                </foreignObject>
              ))}
              {paths.map(({ b, y0, y1, h, xa, xb, mx }) => (
                <path
                  key={b.edgeId}
                  d={`M${xa},${y0} C${mx},${y0} ${mx},${y1} ${xb},${y1} L${xb},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${xa},${y0 + h} Z`}
                  fill={bandFill(b)}
                  opacity={0.42}
                >
                  <title>{b.label ?? `${b.value}`}</title>
                </path>
              ))}
              {bars.map((b) => (
                <rect
                  key={b.nodeId}
                  x={X(b.column)}
                  y={barY.get(b.nodeId)}
                  width={BW}
                  height={Math.max(2, b.value * K)}
                  rx={2}
                  fill="#71717a"
                />
              ))}
              {labels.map((l) => (
                <text
                  key={l.id}
                  x={l.x}
                  y={l.y}
                  textAnchor="start"
                  fontSize={11}
                  fontWeight={500}
                  fill="#18181b"
                  paintOrder="stroke"
                  stroke="#fff"
                  strokeWidth={3}
                  strokeLinejoin="round"
                >
                  {l.text}
                </text>
              ))}
              {spaceLabels(
                bars
                  .filter((b) => endOf(b.nodeId)?.type === "end")
                  .map((b) => ({ b, y: barY.get(b.nodeId)! + Math.max(2, b.value * K) / 2 - 6 })),
                30,
              ).map(({ b, y }) => {
                const x = X(last) + BW + 10;
                const cases = flow.ends.find((e) => e.node_id === b.nodeId)?.cases ?? 0;
                const pct = flow.closed === 0 ? 0 : Math.round((cases / flow.closed) * 100);
                return (
                  <text
                    key={b.nodeId}
                    x={x}
                    y={y}
                    fontSize={11}
                    fontWeight={600}
                    fill={END_FILL[endOf(b.nodeId)?.end_result ?? ""] ?? "#18181b"}
                  >
                    {b.name}
                    <tspan x={x} dy={15} fontSize={11} fontWeight={400} fill="#71717a">
                      {`${cases} cases, ${pct}%`}
                    </tspan>
                  </text>
                );
              })}
            </svg>
          </div>
        )}
        <SideColumn def={def} flow={flow} limit={limit} />
      </div>
    </div>
  );
}

const H3 = "mb-1.5 text-[11.5px] font-medium text-muted-foreground";
const KIND_COLOR = { forward: "#2563eb", refused: "#dc2626", back: "#d97706" };

// SideColumn explains the flow: the share of the limit path, the
// decisions on that path, the lead time per end and the returns.
function SideColumn({ def, flow, limit }: { def: ProcessDefinition; flow: Flow; limit: LimitPath | null }) {
  return (
    <div className="grid content-start gap-3.5 border-l px-4 py-3.5">
      {limit && (
        <div>
          <h3 className={H3}>{`Cases that go to ${limit.targetName}`}</h3>
          <div className="flex items-baseline gap-2.5">
            <b className="text-[30px] leading-tight font-semibold tracking-tight text-[#2563eb]">
              {limit.total === 0 ? "-" : `${Math.round((limit.passes / limit.total) * 100)}%`}
            </b>
            <span className="text-[12.5px] text-[#3f3f46]">
              {limit.total === 0
                ? `No case passed the gateway in ${flow.days} days`
                : `${limit.passes} of ${limit.total} cases`}
            </span>
          </div>
          <span className="mt-1.5 inline-block rounded-[5px] border bg-zinc-100 px-1.5 font-mono text-[11.5px] text-[#3f3f46]">
            {limit.condition}
          </span>
          <span className="ml-1.5 text-[11.5px] text-muted-foreground">rule of the gateway</span>
        </div>
      )}
      {limit && limit.decisions.length > 0 && (
        <div>
          <h3 className={H3}>{`Decisions at ${limit.targetName}`}</h3>
          <div className="my-1 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
            {limit.decisions
              .filter((d) => d.value > 0)
              .map((d) => (
                <i key={d.label} style={{ flex: d.value, background: KIND_COLOR[d.kind] }} />
              ))}
          </div>
          {limit.decisions.map((d) => (
            <div key={d.label} className="mt-[3px] flex justify-between text-xs text-[#3f3f46]">
              <span>
                <i className="mr-[7px] inline-block size-2 rounded-sm" style={{ background: KIND_COLOR[d.kind] }} />
                {d.label}
              </span>
              <b className="font-semibold text-foreground">{d.value}</b>
            </div>
          ))}
        </div>
      )}
      <div>
        <h3 className={H3}>Average lead time by end, first event to end</h3>
        {leadRows(def, flow).map((r) => (
          <div key={r.nodeId} className="mt-[7px] grid grid-cols-[140px_minmax(0,1fr)_60px] items-center gap-2.5 text-xs">
            <span>
              {r.name}
              <small className="block text-[11px] text-muted-foreground">{`${r.cases} cases`}</small>
            </span>
            <div className="h-2 overflow-hidden rounded bg-[#f0f0f1]">
              <i className={`block h-full ${r.refused ? "bg-[#dc2626]" : "bg-primary"}`} style={{ width: `${r.width}%` }} />
            </div>
            <b className="text-right font-semibold">{r.days}</b>
          </div>
        ))}
      </div>
      <div>
        <h3 className={H3}>Returns</h3>
        <p className="text-xs leading-normal text-[#3f3f46]">{returnsText(def, flow)}</p>
        <small className="mt-1 block text-[11px] text-muted-foreground">{rateText(flow)}</small>
      </div>
    </div>
  );
}
