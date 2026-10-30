// The process diagram: node shapes, ELK-routed edges, and the canvas
// furniture (legend, status line, zoom, mini map).

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Panel,
  ReactFlow,
  getViewportForBounds,
  useReactFlow,
  useStore,
  Position,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import {
  FileText,
  Info,
  ListChecks,
  Maximize,
  PenLine,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  layoutProcess,
  pathMidpoint,
  type DiagramEdgeData,
  type DiagramNodeData,
  type DiagramPoint,
  type FlowNode,
  type LabelPos,
} from "./layout";
import { initials, type CaseView } from "./case-view";
import type { CoverageReport } from "./case-api";
import type { NodeType, ProcessDefinition, ProcessNode } from "./types";

// React Flow renders an edge only when both of its nodes carry
// handle bounds. ELK gives the exact edge points, so the handles
// carry no geometry of their own: they stay invisible and
// unconnectable. They sit in the nodeTypes wrappers, because a
// Handle reads the React Flow store and cannot render outside it.
function NodeHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
    </>
  );
}

// The corner rule of the mockup path() function: cut each corner at
// 8 px, or half of the shorter adjacent segment, with one quadratic
// curve through the corner point.
function roundedPath(points: DiagramPoint[]): string {
  const r = 8;
  let d = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    const next = points[i + 1]!;
    const a = Math.min(r, Math.hypot(p.x - prev.x, p.y - prev.y) / 2);
    const b = Math.min(r, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const ux = Math.sign(p.x - prev.x);
    const uy = Math.sign(p.y - prev.y);
    const vx = Math.sign(next.x - p.x);
    const vy = Math.sign(next.y - p.y);
    d += ` L${p.x - ux * a} ${p.y - uy * a} Q${p.x} ${p.y} ${p.x + vx * b} ${p.y + vy * b}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${last.x} ${last.y}`;
}

// The case-view state of one node: done is the past, current is the
// node the case rests on, failed is the current node after a failed
// check.
type NodeState = "done" | "current" | "failed";

type GhostNodeData = DiagramNodeData & {
  ghost?: boolean;
  proposed?: boolean;
  nodeState?: NodeState | null;
  onCitationClick?: (id: string) => void;
};

// The citation ids of a node, in order: the node citations, then the
// citations of each check.
function citationIdsOf(node: ProcessNode): string[] {
  return [
    ...node.citations,
    ...node.checks.flatMap((check) => check.citations),
  ];
}

// The chip row of one node: one button per citation, at most four,
// then a span with the count of the rest. The row keeps one visible
// line: the chips wrap inside a fixed 14 px clip, so no chip paints
// over a card, an edge label or other text. The span sits outside
// the clip and stays visible. The focus path runs the click path, so
// a keyboard user gets the same highlight.
function CitationChips({ ids, onCitationClick, className }: {
  ids: string[];
  onCitationClick?: (id: string) => void;
  className: string;
}) {
  if (ids.length === 0) {
    return null;
  }
  const shown = ids.slice(0, 4);
  const rest = ids.length - shown.length;
  return (
    <div className={`flex max-w-full items-center gap-1 ${className}`}>
      <div className="flex h-[14px] min-w-0 flex-1 flex-wrap items-start overflow-hidden gap-1">
        {shown.map((id, i) => (
          <button
            key={`${id}-${i}`}
            type="button"
            className="nodrag nopan shrink-0 rounded-full bg-white px-1 text-[10px] leading-[12px]"
            style={{ border: "1px solid #7c3aed" }}
            aria-label={`Show ${id} in the policy`}
            onClick={(e) => {
              e.stopPropagation();
              onCitationClick?.(id);
            }}
            onFocus={() => onCitationClick?.(id)}
          >
            {id}
          </button>
        ))}
      </div>
      {rest > 0 && (
        <span className="shrink-0 text-[10px] leading-[12px] text-zinc-500">
          {`+${rest}`}
        </span>
      )}
    </div>
  );
}

// The ring of the current or failed node: 4 px around the node
// bounds, a 2 px border, one corner radius for every node kind. The
// class carries the animation; reduced motion turns it off in CSS.
function StateRing({ color, className }: {
  color: string;
  className: string;
}) {
  return (
    <div
      className={className}
      style={{
        position: "absolute",
        top: -4,
        left: -4,
        right: -4,
        bottom: -4,
        border: `2px solid ${color}`,
        borderRadius: 12,
        pointerEvents: "none",
      }}
    />
  );
}

// The badge of one proposed element: 11 px, white text on violet,
// rounded, above the top left corner of the card or shape.
function ProposedBadge() {
  return (
    <span
      className="absolute -top-2.5 left-0 rounded px-1 text-[11px] font-medium leading-[14px] text-white"
      style={{ backgroundColor: "#7c3aed" }}
    >
      Proposed
    </span>
  );
}

export function TaskCard({ node, color, roleName, selected, ghost = false, proposed = false, nodeState = null, onCitationClick }: {
  node: ProcessNode;
  color: string | null;
  roleName: string | null;
  selected: boolean;
  ghost?: boolean;
  proposed?: boolean;
  nodeState?: NodeState | null;
  onCitationClick?: (id: string) => void;
}) {
  const cited =
    node.citations.length > 0 ||
    node.checks.some((check) => check.citations.length > 0);
  return (
    <div
      className="relative h-[72px] w-[152px] rounded-lg bg-white shadow-sm"
      data-ghost={ghost || proposed ? "true" : "false"}
      style={{
        // The violet dashed rect below is the only outline of a ghost
        // or proposed card: the own border steps aside, the selected
        // case included.
        border: proposed || ghost
          ? "1.5px solid transparent"
          : nodeState === "failed"
            ? "1px solid #dc2626"
            : selected
              ? "2px solid #2563eb"
              : nodeState === "done"
                ? "1px solid #2563eb"
                : "1px solid #d4d4d8",
        boxShadow:
          !ghost && selected ? "0 0 0 3px rgba(37, 99, 235, 0.12)" : undefined,
      }}
    >
      {(proposed || ghost) && (
        <>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            width="152"
            height="72"
          >
            <rect
              x="0.75"
              y="0.75"
              width="150.5"
              height="70.5"
              rx="8"
              fill="none"
              stroke="#7c3aed"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          </svg>
          {proposed && <ProposedBadge />}
        </>
      )}
      {nodeState === "current" && (
        <StateRing color="#2563eb" className="zpulse" />
      )}
      {nodeState === "failed" && (
        <>
          <StateRing color="#dc2626" className="zshake" />
          <div
            role="img"
            aria-label="Check failed"
            className="absolute -top-2 -right-2 flex size-[18px] items-center justify-center rounded-full"
            style={{ backgroundColor: "#dc2626" }}
          >
            <TriangleAlert size={12} color="#ffffff" />
          </div>
        </>
      )}
      {/* One top band, a column when the node carries citations: the
          name row, then the chip row. A cited name clamps to one
          line, so the chips paint over the card's own empty second
          line only, never over the role pill, the deadline or
          anything outside the card. The chips wrap inside a fixed
          14 px clip: one visible line of whole chips, the span with
          the rest always visible. */}
      <div className="absolute inset-x-0 top-0 flex flex-col gap-0.5 px-[10px] pt-[9px]">
        <div className="flex items-start gap-1.5">
          <div
            className={`min-w-0 flex-1 text-[11.5px] leading-[14px] font-semibold text-zinc-950 ${
              cited ? "line-clamp-1" : "line-clamp-2"
            }`}
          >
            {node.name}
          </div>
          <div className="mt-px flex shrink-0 items-center gap-1 text-[10px] text-zinc-400">
            {node.documents.length > 0 && (
              <span className="flex items-center gap-0.5">
                <FileText size={12} />
                {node.documents.length}
              </span>
            )}
            {node.signature && <PenLine size={12} />}
            {node.checks.length > 0 && (
              <span className="flex items-center gap-0.5">
                <ListChecks size={12} />
                {node.checks.length}
              </span>
            )}
          </div>
        </div>
        <CitationChips
          ids={citationIdsOf(node)}
          onCitationClick={onCitationClick}
          className=""
        />
      </div>
      {/* The role and deadline bands are informative only: they
          ignore pointer events, so a click on a chip row that
          overlaps them reaches the chip, and a click on them bubbles
          to the node selection. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1.5 px-[10px] pb-[9px]">
        {roleName === null ? (
          <span className="rounded-full bg-zinc-100 px-1.5 py-px text-[10.5px] font-semibold text-zinc-500">
            Automatic
          </span>
        ) : (
          <span
            className="flex min-w-0 items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-semibold"
            style={{ color: color!, backgroundColor: `${color}1a` }}
          >
            <span
              className="size-[5px] shrink-0 rounded-full"
              style={{ backgroundColor: color! }}
            />
            <span className="truncate">{roleName}</span>
          </span>
        )}
        {node.deadline_hours !== null && (
          <span className="shrink-0 text-[10.5px] text-zinc-500">
            {`${node.deadline_hours} h`}
          </span>
        )}
      </div>
    </div>
  );
}

// The name of a start, gateway or end node: below the shape, above
// it, or at its left (right aligned) when links use the top and the
// bottom. layout.ts nodeLabelBox mirrors these boxes.
const NODE_LABEL_BASE =
  "absolute w-max max-w-[120px] text-[11.5px] leading-[15px] font-medium text-zinc-700";
const NODE_LABEL_CLASS: Record<LabelPos, string> = {
  below: `${NODE_LABEL_BASE} top-full left-1/2 -translate-x-1/2 mt-1 text-center`,
  above: `${NODE_LABEL_BASE} bottom-full left-1/2 -translate-x-1/2 mb-1 text-center`,
  left: `${NODE_LABEL_BASE} top-full right-1/2 mt-1 mr-2 text-right`,
};

export function EventShape({ node, selected, ghost = false, proposed = false, nodeState = null, onCitationClick, labelPos = "below" }: {
  node: ProcessNode;
  labelPos?: LabelPos;
  selected: boolean;
  ghost?: boolean;
  proposed?: boolean;
  nodeState?: NodeState | null;
  onCitationClick?: (id: string) => void;
}) {
  const isStart = node.type === "start";
  const endStroke =
    node.end_result === "approved"
      ? "#16a34a"
      : node.end_result === "refused"
        ? "#dc2626"
        : "#71717a";
  const baseStroke = isStart ? "#71717a" : endStroke;
  const stroke =
    proposed || ghost
      ? "#7c3aed"
      : selected || nodeState === "done"
        ? "#2563eb"
        : baseStroke;
  const width = proposed || ghost ? 1.5 : (isStart ? 1.5 : 3.5) + (selected ? 0.5 : 0);
  const radius = isStart ? 18 : 17;
  const cited =
    node.citations.length > 0 ||
    node.checks.some((check) => check.citations.length > 0);
  return (
    <div
      className="relative flex h-[40px] w-[40px] items-center justify-center"
      data-ghost={ghost || proposed ? "true" : "false"}
    >
      {proposed && <ProposedBadge />}
      {nodeState === "current" && (
        <StateRing color="#2563eb" className="zpulse" />
      )}
      <svg width="40" height="40">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="#ffffff"
          stroke={stroke}
          strokeWidth={width}
          strokeDasharray={proposed || ghost ? "5 4" : undefined}
        />
      </svg>
      <div className={NODE_LABEL_CLASS[labelPos]}>
        <div className={cited ? "truncate" : undefined}>{node.name}</div>
        <CitationChips
          ids={citationIdsOf(node)}
          onCitationClick={onCitationClick}
          className="mt-1 justify-center"
        />
      </div>
    </div>
  );
}

export function GatewayNode({ node, selected, ghost = false, proposed = false, nodeState = null, onCitationClick, labelPos = "below" }: {
  node: ProcessNode;
  labelPos?: LabelPos;
  selected: boolean;
  ghost?: boolean;
  proposed?: boolean;
  nodeState?: NodeState | null;
  onCitationClick?: (id: string) => void;
}) {
  const stroke =
    proposed || ghost
      ? "#7c3aed"
      : selected || nodeState === "done"
        ? "#2563eb"
        : "#a1a1aa";
  const cited =
    node.citations.length > 0 ||
    node.checks.some((check) => check.citations.length > 0);
  return (
    <div
      className="relative flex h-[52px] w-[52px] items-center justify-center"
      data-ghost={ghost || proposed ? "true" : "false"}
    >
      {proposed && <ProposedBadge />}
      {nodeState === "current" && (
        <StateRing color="#2563eb" className="zpulse" />
      )}
      <svg width="52" height="52">
        <polygon
          points="26,0 52,26 26,52 0,26"
          fill="#ffffff"
          stroke={stroke}
          strokeWidth={proposed || ghost ? 1.5 : selected ? 2 : 1.5}
          strokeDasharray={proposed || ghost ? "5 4" : undefined}
        />
        <path
          d="M20 20 L32 32 M32 20 L20 32"
          stroke="#52525b"
          strokeWidth="2"
          fill="none"
        />
      </svg>
      <div className={NODE_LABEL_CLASS[labelPos]}>
        <div className={cited ? "truncate" : undefined}>{node.name}</div>
        <CitationChips
          ids={citationIdsOf(node)}
          onCitationClick={onCitationClick}
          className="mt-1 justify-center"
        />
      </div>
    </div>
  );
}

// The anchor of one edge: data.anchor when the producer set it,
// null when the producer dropped the pill, the path midpoint for
// legacy data that carries no anchor key. A `??` chain is wrong
// here: `data.anchor ?? pathMidpoint(points)` also falls back on
// null, and null must mean "no pill".
export function edgeAnchor(
  data: { anchor?: DiagramPoint | null },
  points: DiagramPoint[],
): DiagramPoint | null {
  return data.anchor === undefined ? pathMidpoint(points) : data.anchor;
}

// Informative only: the pill ignores pointer events, so a click on
// what it covers (a node card, a chip) goes to that element.
export function EdgePill({ text, anchor, dimmed = false }: {
  text: string;
  anchor: DiagramPoint;
  dimmed?: boolean;
}) {
  return (
    <div
      className="nodrag nopan absolute rounded px-1 text-[11.5px] leading-[16px] font-medium text-zinc-700 max-w-[160px] truncate"
      style={{
        transform: `translate(-50%, -50%) translate(${anchor.x}px, ${anchor.y}px)`,
        pointerEvents: "none",
        backgroundColor: "var(--canvas)",
        opacity: dimmed ? 0.25 : 1,
        transition: "opacity 150ms",
      }}
    >
      {text}
    </div>
  );
}

export function ElkEdge({ markerEnd, data }: EdgeProps) {
  const { points, pill, anchor, ghost, proposed, traversed, coverage, lit, dimmed } = data as DiagramEdgeData & {
    ghost?: boolean;
    proposed?: boolean;
    traversed?: boolean;
    coverage?: "red" | "green" | null;
    lit?: boolean;
    dimmed?: boolean;
  };
  const path = roundedPath(points);
  const resolved = edgeAnchor({ anchor }, points);
  return (
    <>
      <BaseEdge
        path={path}
        stroke="#a1a1aa"
        strokeWidth={1.5}
        className="zcov"
        data-ghost={ghost || proposed ? "true" : "false"}
        style={{
          transition: "opacity 150ms, stroke 150ms",
          opacity: dimmed ? 0.2 : 1,
          ...(proposed || ghost
            ? { stroke: "#7c3aed", strokeWidth: 1.5, strokeDasharray: "5 4" }
            : coverage
              ? {
                  stroke: coverage === "green" ? "#16a34a" : "#dc2626",
                  strokeWidth: 2,
                }
              : traversed
                ? { stroke: "#2563eb", strokeWidth: 2 }
                : lit
                  ? { stroke: "#52525b", strokeWidth: 2 }
                  : {}),
        }}
        markerEnd={markerEnd}
      />
      {pill !== null && resolved !== null && (
        <EdgeLabelRenderer>
          <EdgePill text={pill} anchor={resolved} dimmed={dimmed} />
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes: NodeTypes = {
  task: ({ data }: NodeProps) => {
    const d = data as GhostNodeData;
    return (
      <>
        <NodeHandles />
        <TaskCard
          node={d.node}
          color={d.color}
          roleName={d.roleName}
          selected={d.selected}
          ghost={d.ghost}
          proposed={d.proposed}
          nodeState={d.nodeState ?? null}
          onCitationClick={d.onCitationClick}
        />
      </>
    );
  },
  gateway: ({ data }: NodeProps) => {
    const d = data as GhostNodeData;
    return (
      <>
        <NodeHandles />
        <GatewayNode
          node={d.node}
          selected={d.selected}
          ghost={d.ghost}
          proposed={d.proposed}
          nodeState={d.nodeState ?? null}
          onCitationClick={d.onCitationClick}
          labelPos={d.labelPos}
        />
      </>
    );
  },
  start: ({ data }: NodeProps) => {
    const d = data as GhostNodeData;
    return (
      <>
        <NodeHandles />
        <EventShape
          node={d.node}
          selected={d.selected}
          ghost={d.ghost}
          proposed={d.proposed}
          nodeState={d.nodeState ?? null}
          onCitationClick={d.onCitationClick}
          labelPos={d.labelPos}
        />
      </>
    );
  },
  end: ({ data }: NodeProps) => {
    const d = data as GhostNodeData;
    return (
      <>
        <NodeHandles />
        <EventShape
          node={d.node}
          selected={d.selected}
          ghost={d.ghost}
          proposed={d.proposed}
          nodeState={d.nodeState ?? null}
          onCitationClick={d.onCitationClick}
          labelPos={d.labelPos}
        />
      </>
    );
  },
  token: ({ data }: NodeProps) => {
    return <TokenBadge data={data as { label: string; name: string }} />;
  },
};

const edgeTypes: EdgeTypes = { elk: ElkEdge };

// The token of the case view: the actor initials beside the current
// node. The node carries the ztoken class, so the CSS transform
// transition animates the move; reduced motion turns it off.
export function TokenBadge({ data }: {
  data: { label: string; name: string };
}) {
  return (
    <div
      role="img"
      aria-label={`Token ${data.name}`}
      className="flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{
        backgroundColor: "#2563eb",
        border: "2px solid #ffffff",
        pointerEvents: "none",
      }}
    >
      {data.label}
    </div>
  );
}

// The viewport that shows the full layout box (nodes, links, link
// texts and node labels) in the canvas box, at 100 % or less.
export function fitViewport(
  layout: { width: number; height: number },
  box: { width: number; height: number },
): Viewport {
  return getViewportForBounds(
    { x: 0, y: 0, width: layout.width, height: layout.height },
    box.width, box.height, 0.2, 1, 0.1,
  );
}

type LayoutSize = { width: number; height: number };

function ZoomControls({ box, layout }: { box: RefObject<HTMLDivElement | null>; layout: LayoutSize }) {
  const { zoomIn, zoomOut, setViewport } = useReactFlow();
  const percent = useStore((s) => Math.round(s.transform[2] * 100));
  return (
    <Panel position="bottom-left">
      <div className="flex items-center gap-1 rounded-md border border-[#e4e4e7] bg-white p-1 shadow-sm">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          className="rounded p-1 text-zinc-600 hover:bg-zinc-100"
          onClick={() => zoomOut()}
        >
          <ZoomOut size={14} />
        </button>
        <span className="min-w-[46px] text-center text-[12px] font-medium text-zinc-700 tabular-nums">
          {percent}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          className="rounded p-1 text-zinc-600 hover:bg-zinc-100"
          onClick={() => zoomIn()}
        >
          <ZoomIn size={14} />
        </button>
        <span className="mx-0.5 h-5 w-px bg-[#e4e4e7]" />
        <button
          type="button"
          aria-label="Fit to view"
          title="Fit to view"
          className="rounded p-1 text-zinc-600 hover:bg-zinc-100"
          onClick={() => {
            const el = box.current;
            if (el !== null) {
              void setViewport(fitViewport(layout, { width: el.clientWidth, height: el.clientHeight }));
            }
          }}
        >
          <Maximize size={14} />
        </button>
      </div>
    </Panel>
  );
}

// The canvas holds the whole diagram: a fresh fit when the layout has
// landed (the observer reports the box on mount), when the layout size
// changes, and each time the canvas box changes after that (the policy
// drawer takes a band of the column when it opens). The fit covers the
// full layout box, not only the nodes, so no link text leaves the
// canvas. The frame delay lets React Flow paint the new box first.
function AutoFit({ box, layout }: { box: RefObject<HTMLDivElement | null>; layout: LayoutSize }) {
  const { setViewport } = useReactFlow();
  const { width, height } = layout;
  useEffect(() => {
    const el = box.current;
    if (el === null || typeof ResizeObserver === "undefined") {
      return;
    }
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        void setViewport(fitViewport({ width, height }, { width: el.clientWidth, height: el.clientHeight }));
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [box, setViewport, width, height]);
  return null;
}

// The coverage legend row: one plain child of the Legend panel (no
// Panel, no store access, no props), so the rows render it directly.
export function CoverageLegendRow() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-zinc-600">
      Coverage:
      <svg width="16" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="15" y2="4" stroke="#16a34a" strokeWidth="2" />
      </svg>
      green taken,
      <svg width="16" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="15" y2="4" stroke="#dc2626" strokeWidth="2" />
      </svg>
      red never taken
    </div>
  );
}

// The legend stays folded: one small button that opens the list of
// shapes, so it never covers the diagram. The coverage row sits
// under the button, always visible while a report is on: the
// coverage state rests on colors only, so its label must not hide
// behind a click.
function Legend({ coverage }: { coverage: CoverageReport | null }) {
  const [open, setOpen] = useState(false);
  const rowClass = "flex items-center gap-1.5 text-[11px] text-zinc-600";
  return (
    <Panel position="top-left">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md border border-[#e4e4e7] bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 shadow-sm hover:bg-zinc-50"
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={12} />
        Legend
      </button>
      {coverage !== null && (
        <div className="mt-1 rounded-md border border-[#e4e4e7] bg-white p-2 shadow-sm">
          <CoverageLegendRow />
        </div>
      )}
      {open && (
      <div className="mt-1 rounded-md border border-[#e4e4e7] bg-white p-2 shadow-sm">
        <div className={rowClass}>
          <svg width="16" height="16">
            <circle cx="8" cy="8" r="6" fill="#ffffff" stroke="#71717a" strokeWidth="1.5" />
          </svg>
          Start
        </div>
        <div className={rowClass}>
          <svg width="16" height="16">
            <rect x="1" y="3" width="14" height="10" rx="2" fill="#ffffff" stroke="#d4d4d8" />
          </svg>
          Task
        </div>
        <div className={rowClass}>
          <svg width="16" height="16">
            <polygon points="8,1 15,8 8,15 1,8" fill="#ffffff" stroke="#a1a1aa" strokeWidth="1.5" />
          </svg>
          Gateway
        </div>
        <div className={rowClass}>
          <svg width="16" height="16">
            <circle cx="8" cy="8" r="5.5" fill="#ffffff" stroke="#16a34a" strokeWidth="2.5" />
          </svg>
          End: approved
        </div>
        <div className={rowClass}>
          <svg width="16" height="16">
            <circle cx="8" cy="8" r="5.5" fill="#ffffff" stroke="#dc2626" strokeWidth="2.5" />
          </svg>
          End: refused
        </div>
        <div className={rowClass}>The dot on a task is the role color.</div>
      </div>
      )}
    </Panel>
  );
}

// The animation styles of the case view. The classes go on the ring
// (zpulse, zshake) and on the token node (ztoken). The media query
// turns every movement into a plain state change, so no JS branch
// needs the reduced motion setting.
const ANIMATION_CSS = `
@keyframes zpulse { from { opacity: .5; transform: scale(1); }
                    to { opacity: 0; transform: scale(1.25); } }
.zpulse { animation: zpulse 2s ease-out infinite; }
@keyframes zshake { 0%, 100% { translate: 0; }
                    25% { translate: -3px 0; } 75% { translate: 3px 0; } }
.zshake { animation: zshake .4s ease-in-out 1; }
.ztoken { transition: transform 600ms ease; }
.zcov { transition: stroke .6s ease; }
.react-flow .react-flow__node:focus { outline: none; }
.react-flow .react-flow__node.selectable:focus-visible { outline: 2px solid #2563eb; outline-offset: 5px; border-radius: 10px; }
@media (prefers-reduced-motion: reduce) {
  .zpulse, .zshake { animation: none; }
  .ztoken, .zcov { transition: none; }
}
`;

// The step id of a focused React Flow node element, or null.
function stepIdOf(target: EventTarget): string | null {
  if (!(target instanceof HTMLElement) || !target.classList.contains("react-flow__node")) {
    return null;
  }
  const id = target.dataset.id ?? null;
  return id === "zotra-token" ? null : id;
}

// The nearest step in the direction of an arrow key, from the centers
// of the laid-out steps. A step off the axis counts double, so the
// move follows the row or the column first.
export function neighborIn(nodes: FlowNode[], fromId: string, key: string): string | null {
  const center = (n: FlowNode) => ({
    x: n.position.x + (n.width ?? 0) / 2,
    y: n.position.y + (n.height ?? 0) / 2,
  });
  const from = nodes.find((n) => n.id === fromId);
  if (from === undefined) {
    return null;
  }
  const a = center(from);
  let best: string | null = null;
  let bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === fromId) {
      continue;
    }
    const b = center(n);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const [along, across] =
      key === "ArrowRight" ? [dx, dy] :
      key === "ArrowLeft" ? [-dx, dy] :
      key === "ArrowDown" ? [dy, dx] :
      key === "ArrowUp" ? [-dy, dx] : [0, 0];
    if (along <= 1) {
      continue;
    }
    const score = along + 2 * Math.abs(across);
    if (score < bestScore) {
      bestScore = score;
      best = n.id;
    }
  }
  return best;
}

// The state of one node in the case view: failed on the current node
// after a failed check, else current on the current node, else done
// on a traversed node.
function nodeStateOf(nodeId: string, caseView: CaseView): NodeState | null {
  if (nodeId === caseView.currentNodeId) {
    return caseView.failedCheck ? "failed" : "current";
  }
  return caseView.traversedNodeIds.includes(nodeId) ? "done" : null;
}

// The token rests left of the current node, vertically centered on
// its shape: the card (72 px), the diamond (52 px), the circle
// (40 px). The token is 24 px.
function tokenOffsetY(type: NodeType): number {
  if (type === "task") {
    return 24;
  }
  if (type === "gateway") {
    return 14;
  }
  return 8;
}

export function ProcessDiagram({
  def,
  selectedNodeId,
  onNodeSelect,
  ghost,
  ghostIds,
  onCitationClick,
  minimap = true,
  caseView = null,
  coverage = null,
  highlightNodeIds = null,
}: {
  def: ProcessDefinition;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  ghost: boolean;
  // The ids the assistant chat draws as proposed. The whole-diagram
  // ghost prop keeps its own style.
  ghostIds?: { nodes: Set<string>; edges: Set<string> };
  onCitationClick: (id: string) => void;
  minimap?: boolean;
  caseView?: CaseView | null;
  coverage?: CoverageReport | null;
  // Steps to light from outside (a role row of the process panel);
  // every other step dims.
  highlightNodeIds?: string[] | null;
}) {
  const [layout, setLayout] = useState<Awaited<ReturnType<typeof layoutProcess>> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // The step under the pointer, else the step with keyboard focus:
  // its links light up and the steps it does not touch dim.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const active = hoverId ?? focusId;
  const lightSet = useMemo(() => {
    if (active !== null) {
      const ids = new Set([active]);
      for (const e of def.edges) {
        if (e.from === active) ids.add(e.to);
        if (e.to === active) ids.add(e.from);
      }
      return ids;
    }
    return highlightNodeIds !== null && highlightNodeIds.length > 0
      ? new Set(highlightNodeIds)
      : null;
  }, [active, def, highlightNodeIds]);
  useEffect(() => {
    let ignore = false;
    layoutProcess(def).then((result) => {
      if (!ignore) {
        setLayout(result);
      }
    });
    return () => {
      ignore = true;
    };
  }, [def]);

  const nodes = useMemo(() => {
    if (layout === null) {
      return [];
    }
    const flowNodes: Node[] = layout.nodes.map((n) => ({
      ...n,
      style: {
        opacity: lightSet !== null && !lightSet.has(n.id) ? 0.3 : 1,
        transition: "opacity 150ms",
      },
      data: {
        ...n.data,
        selected: n.id === selectedNodeId,
        ghost,
        proposed: ghostIds !== undefined && ghostIds.nodes.has(n.id),
        onCitationClick,
        ...(caseView ? { nodeState: nodeStateOf(n.id, caseView) } : {}),
      },
    }));
    if (
      caseView === null ||
      caseView.actorName === null ||
      caseView.currentNodeId === null
    ) {
      return flowNodes;
    }
    const current = layout.nodes.find((n) => n.id === caseView.currentNodeId);
    if (!current) {
      return flowNodes;
    }
    // The token is not part of the layout: ELK lays out the
    // definition nodes only, the token joins after it.
    return [
      ...flowNodes,
      {
        id: "zotra-token",
        type: "token",
        draggable: false,
        selectable: false,
        className: "ztoken",
        position: {
          x: current.position.x - 30,
          y: current.position.y + tokenOffsetY(current.data.node.type),
        },
        data: { label: initials(caseView.actorName), name: caseView.actorName },
      },
    ];
  }, [layout, selectedNodeId, ghost, ghostIds, onCitationClick, caseView, lightSet]);

  const edges = useMemo(() => {
    if (layout === null) {
      return [];
    }
    // The take count of each edge, from the report. An edge id
    // outside the report counts as 0, red; OfCases lists every
    // definition edge, so this is a guard only.
    const counts = new Map(
      (coverage?.edges ?? []).map((edge) => [edge.edge_id, edge.count]),
    );
    return layout.edges.map((e) => {
      const proposed = ghostIds !== undefined && ghostIds.edges.has(e.id);
      const traversed =
        caseView !== null && caseView.traversedEdgeIds.includes(e.id);
      const cov =
        coverage === null ? null : (counts.get(e.id) ?? 0) > 0 ? "green" : "red";
      const touches = (id: string | null) => id !== null && (e.source === id || e.target === id);
      const lit = touches(active) || (active === null && touches(selectedNodeId));
      const dimmed =
        lightSet !== null &&
        (active !== null ? !touches(active) : !(lightSet.has(e.source) && lightSet.has(e.target)));
      return {
        ...e,
        data: {
          ...e.data,
          ghost,
          proposed,
          coverage: cov,
          lit,
          dimmed,
          ...(caseView !== null ? { traversed } : {}),
        },
        markerEnd:
          (ghost || proposed) && typeof e.markerEnd === "object"
            ? { ...e.markerEnd, color: "#7c3aed" }
            : coverage !== null && typeof e.markerEnd === "object"
              ? {
                  ...e.markerEnd,
                  color: cov === "green" ? "#16a34a" : "#dc2626",
                }
              : !ghost && traversed && typeof e.markerEnd === "object"
                ? { ...e.markerEnd, color: "#2563eb" }
                : e.markerEnd,
      };
    });
  }, [layout, ghost, ghostIds, caseView, coverage, active, lightSet, selectedNodeId]);

  if (layout === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <style>{ANIMATION_CSS}</style>
        Laying out the diagram
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      role="region"
      aria-label="Process diagram. Tab to reach a step, arrow keys to move to the next step, Enter to select it, Escape to clear the selection."
      className="h-full w-full"
      style={{ backgroundColor: "var(--canvas)" }}
      onFocus={(e) => setFocusId(stepIdOf(e.target))}
      onBlur={() => setFocusId(null)}
      onKeyDown={(e) => {
        const id = stepIdOf(e.target);
        if (id === null) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNodeSelect(id);
        } else if (e.key === "Escape") {
          onNodeSelect(null);
        } else if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          const next = neighborIn(layout.nodes, id, e.key);
          if (next !== null) {
            document
              .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(next)}"]`)
              ?.focus();
          }
        }
      }}
    >
      <style>{ANIMATION_CSS}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.2}
        maxZoom={2}
        onNodeClick={(_, n) => onNodeSelect(n.id)}
        onNodeMouseEnter={(_, n) => n.type !== "token" && setHoverId(n.id)}
        onNodeMouseLeave={() => setHoverId(null)}
        onPaneClick={() => onNodeSelect(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#d4d4d8" />
        <AutoFit box={wrapRef} layout={layout} />
        {minimap && (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor="#ffffff"
            nodeStrokeColor="#a1a1aa"
            nodeStrokeWidth={3}
            nodeBorderRadius={6}
            maskColor="rgba(244, 244, 245, 0.55)"
            style={{ width: 168, height: 84, border: "1px solid #e4e4e7", borderRadius: 8 }}
          />
        )}
        <ZoomControls box={wrapRef} layout={layout} />
        <Legend coverage={coverage} />
      </ReactFlow>
    </div>
  );
}
