// The live flow diagram of the supervision: the process diagram, read
// only, with the open cases and the deadline halo of each task, and
// dots that move along the edges where cases pass.

import type { Layout } from "../studio/layout";
import { walk } from "../studio/layout";
import type {
  ProcessDefinition,
  ProcessEdge,
  ProcessNode,
} from "../studio/types";
import type { Flow, SupCase, Supervision } from "./sup-api";

export type Halo = "ok" | "near" | "late";
export type EdgeKind = "forward" | "back" | "refused";

// haloOf gives the halo of one step: "late" when one of its cases is
// late, "near" when one case is at 60 percent of the deadline or more,
// else "ok".
export function haloOf(
  node: ProcessNode,
  cases: SupCase[],
): { state: Halo; late: number; near: number } {
  const own = cases.filter((c) => c.node_id === node.id);
  const late = own.filter((c) => c.late).length;
  const deadline = node.deadline_hours;
  // Integer compare: age >= 60 percent of the deadline, no float error.
  const near = own.filter(
    (c) => !c.late && deadline !== null && c.age_hours * 10 >= deadline * 6,
  ).length;
  const state: Halo = late > 0 ? "late" : near > 0 ? "near" : "ok";
  return { state, late, near };
}

// dotCount gives the number of dots of one edge, 1 to 5, from its
// passes against the largest passes of the flow. No pass gives 0.
export function dotCount(passes: number, maxPasses: number): number {
  if (passes <= 0 || maxPasses <= 0) {
    return 0;
  }
  return 1 + Math.round((passes / maxPasses) * 4);
}

// edgeKind gives the kind of one edge: a back link of the walk, a
// link to a refused end, or a forward link.
export function edgeKind(
  def: ProcessDefinition,
  edge: ProcessEdge,
  back: Set<string>,
): EdgeKind {
  if (back.has(edge.id)) {
    return "back";
  }
  const to = def.nodes.find((n) => n.id === edge.to);
  if (to?.type === "end" && to.end_result === "refused") {
    return "refused";
  }
  return "forward";
}

const EDGE_STROKE: Record<EdgeKind, string> = {
  forward: "#a1a1aa",
  back: "#dfae5c",
  refused: "#eba29c",
};
const EDGE_TEXT: Record<EdgeKind, string> = {
  forward: "#71717a",
  back: "#b45309",
  refused: "#b91c1c",
};
const DOT_FILL: Record<EdgeKind, string> = {
  forward: "#0f766e",
  back: "#d97706",
  refused: "#dc2626",
};
const KINDS: EdgeKind[] = ["forward", "back", "refused"];

const HALO_CLASS: Record<Halo, string> = {
  ok: "border-zinc-300",
  near: "border-[#d97706] shadow-[0_0_0_1px_#d97706,0_0_20px_2px_rgba(217,119,6,.22)]",
  late: "border-[#dc2626] shadow-[0_0_0_1px_#dc2626,0_0_24px_4px_rgba(220,38,38,.26)]",
};
const BAR_CLASS: Record<Halo, string> = {
  ok: "bg-primary",
  near: "bg-[#d97706]",
  late: "bg-[#dc2626]",
};

type LayoutNode = Layout["nodes"][number];

// nameBox gives the box of the name of a start, gateway or end node,
// 120 x 48 at most. Another shape in the same band makes the box
// narrower, so the name wraps and no shape hides it.
export function nameBox(
  n: LayoutNode,
  nodes: LayoutNode[],
): { x: number; y: number; w: number } {
  const cx = n.position.x + (n.width ?? 0) / 2;
  const pos = n.data.labelPos ?? "below";
  const y =
    pos === "above" ? n.position.y - 4 - 48 : n.position.y + (n.height ?? 0) + 4;
  const near = nodes.filter(
    (o) => o !== n && o.position.y < y + 48 && o.position.y + (o.height ?? 0) > y,
  );
  if (pos === "left") {
    const right = cx - 8;
    let left = right - 120;
    for (const o of near) {
      const r = o.position.x + (o.width ?? 0);
      if (r <= right) {
        left = Math.max(left, r + 4);
      }
    }
    return { x: left, y, w: Math.max(60, right - left) };
  }
  let half = 60;
  for (const o of near) {
    const l = o.position.x;
    const r = l + (o.width ?? 0);
    if (l >= cx) {
      half = Math.min(half, l - cx - 4);
    } else if (r <= cx) {
      half = Math.min(half, cx - r - 4);
    }
  }
  // A box under 60 px cannot hold one word; it then overlaps.
  half = Math.max(30, half);
  return { x: cx - half, y, w: 2 * half };
}

// NodeName is the name of a start, gateway or end node, with an
// optional second line, in the box of nameBox.
function NodeName({ n, nodes, sub }: {
  n: LayoutNode;
  nodes: LayoutNode[];
  sub: string | null;
}) {
  const pos = n.data.labelPos ?? "below";
  const { x, y, w } = nameBox(n, nodes);
  const align =
    pos === "above"
      ? "items-center justify-end text-center"
      : pos === "left"
        ? "items-end text-right"
        : "items-center text-center";
  return (
    <foreignObject x={x} y={y} width={w} height={48} pointerEvents="none">
      <div className={`flex h-full flex-col ${align}`}>
        <div className="text-[11.5px] leading-[15px] font-medium text-[#3f3f46]">
          {n.data.node.name}
        </div>
        {sub !== null && (
          <div className="text-[11px] text-muted-foreground">{sub}</div>
        )}
      </div>
    </foreignObject>
  );
}

// TaskCard is the button of one task: the open cases, the median
// against the deadline, and the halo.
function TaskCard({ n, sup, selected, onSelect }: {
  n: LayoutNode;
  sup: Supervision;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const node = n.data.node;
  const row = sup.nodes.find((r) => r.node_id === node.id);
  const open = row?.open ?? 0;
  const median = row?.median_hours ?? 0;
  const deadline = node.deadline_hours;
  const halo = haloOf(node, sup.cases);
  const fill = deadline === null ? 0 : Math.min(100, (median / deadline) * 100);
  const w = n.width ?? 0;
  const h = n.height ?? 0;
  return (
    <foreignObject
      x={n.position.x - 32}
      y={n.position.y - 32}
      width={w + 64}
      height={h + 64}
      pointerEvents="none"
    >
      {/* The 32 px padding holds the full halo shadow (28 px). */}
      <div className="p-8">
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${node.name}: ${open} waiting, ${halo.late} late`}
          title={n.data.roleName === null ? node.name : `${node.name}, ${n.data.roleName}`}
          onClick={() => onSelect(node.id)}
          style={{ width: w, height: h }}
          className={`pointer-events-auto relative flex flex-col rounded-lg border bg-card px-2.5 py-1.5 text-left ${HALO_CLASS[halo.state]} ${
            selected ? "outline-2 outline-offset-4 outline-primary" : ""
          }`}
        >
          {halo.state === "late" && (
            <span className="absolute -top-[9px] right-2 rounded bg-[#dc2626] px-1.5 text-[10.5px] font-semibold leading-4 text-white">
              {`${halo.late} late`}
            </span>
          )}
          {halo.state === "near" && (
            <span className="absolute -top-[9px] right-2 rounded bg-[#d97706] px-1.5 text-[10.5px] font-semibold leading-4 text-white">
              {`${halo.near} near the deadline`}
            </span>
          )}
          <span className="w-full truncate text-[12px] font-semibold">{node.name}</span>
          <span className="mt-auto flex items-baseline gap-1">
            <b className="text-[18px] leading-none font-semibold">{open}</b>
            <span className="text-[11px] text-muted-foreground">waiting</span>
          </span>
          <span className="mt-1 mb-0.5 h-[3px] w-full overflow-hidden rounded-sm bg-zinc-100">
            <span
              className={`block h-full ${BAR_CLASS[halo.state]}`}
              style={{ width: `${fill}%` }}
            />
          </span>
          <span className="text-[10.5px] whitespace-nowrap text-muted-foreground">
            {deadline === null
              ? `median ${median} h`
              : `median ${median} h · max ${deadline} h`}
          </span>
        </button>
      </div>
    </foreignObject>
  );
}

export function LiveDiagram({ def, layout, sup, flow, selected, onSelect }: {
  def: ProcessDefinition;
  layout: Layout;
  sup: Supervision;
  flow: Flow;
  selected: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const start = def.nodes.find((n) => n.type === "start");
  const back = start === undefined ? new Set<string>() : walk(def, start.id).back;
  const passesOf = (id: string) =>
    flow.edges.find((e) => e.edge_id === id)?.passes ?? 0;
  const maxPasses = Math.max(0, ...flow.edges.map((e) => e.passes));
  const edges = layout.edges.map((e) => {
    const edge = def.edges.find((d) => d.id === e.id)!;
    const points = e.data?.points ?? [];
    return {
      id: e.id,
      kind: edgeKind(def, edge, back),
      d: points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" "),
      pill: e.data?.pill ?? null,
      anchor: e.data?.anchor ?? null,
      dots: dotCount(passesOf(e.id), maxPasses),
    };
  });
  const subOf = (node: ProcessNode): string | null => {
    if (node.type === "start") {
      const passes = def.edges
        .filter((e) => e.from === node.id)
        .reduce((sum, e) => sum + passesOf(e.id), 0);
      return `${passes} in ${flow.days} days`;
    }
    if (node.type === "end") {
      const cases = flow.ends.find((e) => e.node_id === node.id)?.cases ?? 0;
      return `${cases} in ${flow.days} days`;
    }
    return null;
  };

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="h-auto w-full"
      overflow="visible"
      role="img"
      aria-label={`${def.name}, live flow`}
    >
      <defs>
        {KINDS.map((kind) => (
          <marker
            key={kind}
            id={`sup-arrow-${kind}`}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,1 L9,5 L0,9 Z" fill={EDGE_STROKE[kind]} />
          </marker>
        ))}
      </defs>
      {edges.map((e) => (
        <path
          key={e.id}
          d={e.d}
          fill="none"
          stroke={EDGE_STROKE[e.kind]}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeDasharray={e.kind === "back" ? "5 4" : undefined}
          markerEnd={`url(#sup-arrow-${e.kind})`}
        />
      ))}
      {edges.map(
        (e) =>
          e.pill !== null &&
          e.anchor !== null && (
            <text
              key={e.id}
              x={e.anchor.x}
              y={e.anchor.y}
              dy="0.35em"
              fontSize={10.5}
              textAnchor="middle"
              fill={EDGE_TEXT[e.kind]}
              stroke="#ffffff"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {e.pill}
            </text>
          ),
      )}
      {edges.flatMap((e) =>
        Array.from({ length: e.dots }, (_, i) => {
          const f = (i + 0.5) / e.dots;
          return (
            <circle
              key={`${e.id}-${i}`}
              r={2.8}
              fill={DOT_FILL[e.kind]}
              className="sup-dot"
              style={{
                offsetPath: `path('${e.d}')`,
                offsetDistance: `${f * 100}%`,
                animationDelay: `-${f * 6}s`,
              }}
            />
          );
        }),
      )}
      {layout.nodes.map((n) => {
        const node = n.data.node;
        if (node.type === "task") {
          return (
            <TaskCard
              key={n.id}
              n={n}
              sup={sup}
              selected={selected === node.id}
              onSelect={onSelect}
            />
          );
        }
        const cx = n.position.x + (n.width ?? 0) / 2;
        const cy = n.position.y + (n.height ?? 0) / 2;
        return (
          <g key={n.id}>
            {node.type === "gateway" ? (
              <>
                <path
                  d={`M ${cx},${cy - 26} L ${cx + 26},${cy} L ${cx},${cy + 26} L ${cx - 26},${cy} Z`}
                  fill="#ffffff"
                  stroke="#a1a1aa"
                  strokeWidth={1.5}
                />
                <text
                  x={cx}
                  y={cy}
                  dy="0.35em"
                  fontSize={14}
                  fontWeight={600}
                  textAnchor="middle"
                  fill="#52525b"
                >
                  ?
                </text>
              </>
            ) : node.type === "end" && node.end_result === "approved" ? (
              <circle cx={cx} cy={cy} r={14} fill="#ffffff" className="stroke-primary" strokeWidth={4} />
            ) : node.type === "end" && node.end_result === "refused" ? (
              <circle cx={cx} cy={cy} r={14} fill="#ffffff" stroke="#dc2626" strokeWidth={4} />
            ) : (
              <circle cx={cx} cy={cy} r={14} fill="#ffffff" stroke="#a1a1aa" strokeWidth={2} />
            )}
            <NodeName n={n} nodes={layout.nodes} sub={subOf(node)} />
          </g>
        );
      })}
    </svg>
  );
}

// FlowLegend explains the halos and the dots of the live diagram.
export function FlowLegend() {
  const box = "inline-block h-2.5 w-4 rounded-[3px] border bg-card";
  const dot = "inline-block size-1.5 rounded-full";
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden className={`${box} border-zinc-400`} />
        On time
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden className={`${box} border-[#d97706] shadow-[0_0_5px_rgba(217,119,6,.45)]`} />
        Near the deadline (60 percent)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden className={`${box} border-[#dc2626] shadow-[0_0_5px_rgba(220,38,38,.45)]`} />
        Late
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden className={`${dot} bg-[#0f766e]`} />
        Case moves forward
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden className={`${dot} bg-[#d97706]`} />
        Case goes back
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i aria-hidden className={`${dot} bg-[#dc2626]`} />
        Case refused
      </span>
    </div>
  );
}
