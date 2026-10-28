// The process diagram: node shapes, ELK-routed edges, and the canvas
// furniture (legend, status line, zoom, mini map).

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  Position,
  type EdgeProps,
  type EdgeTypes,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { FileText, ListChecks, Maximize, PenLine, ZoomIn, ZoomOut } from "lucide-react";
import {
  layoutProcess,
  pathMidpoint,
  type DiagramEdgeData,
  type DiagramNodeData,
  type DiagramPoint,
  type FlowNode,
} from "./layout";
import type { ProcessDefinition, ProcessNode } from "./types";

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

type GhostNodeData = DiagramNodeData & {
  ghost?: boolean;
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

export function TaskCard({ node, color, roleName, selected, ghost = false, onCitationClick }: {
  node: ProcessNode;
  color: string | null;
  roleName: string | null;
  selected: boolean;
  ghost?: boolean;
  onCitationClick?: (id: string) => void;
}) {
  const cited =
    node.citations.length > 0 ||
    node.checks.some((check) => check.citations.length > 0);
  return (
    <div
      className={`relative h-[72px] w-[128px] rounded-lg bg-white shadow-sm${
        ghost ? " opacity-70" : ""
      }`}
      data-ghost={ghost ? "true" : "false"}
      style={{
        border: ghost
          ? selected
            ? "2px dashed #7c3aed"
            : "1px dashed #7c3aed"
          : selected
            ? "2px solid #2563eb"
            : "1px solid #d4d4d8",
        boxShadow:
          !ghost && selected ? "0 0 0 3px rgba(37, 99, 235, 0.12)" : undefined,
      }}
    >
      {/* One top band, a column when the node carries citations: the
          name row, then the chip row. A cited name clamps to one
          line, so the chips paint over the card's own empty second
          line only, never over the role pill, the deadline or
          anything outside the card. The chips wrap inside a fixed
          14 px clip: one visible line of whole chips, the span with
          the rest always visible. */}
      <div className="absolute inset-x-0 top-0 flex flex-col gap-0.5 p-[10px]">
        <div className="flex items-start gap-1">
          <div
            className={`min-w-0 flex-1 break-words text-[11.5px] leading-tight font-semibold text-zinc-800 ${
              cited ? "line-clamp-1" : "line-clamp-2"
            }`}
          >
            {node.name}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500">
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
      <div className="pointer-events-none absolute bottom-0 left-0 p-[10px]">
        {roleName === null ? (
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-500">
            Automatic
          </span>
        ) : (
          <span
            className="flex max-w-[80px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium truncate"
            style={{ color: color!, backgroundColor: `${color}1a` }}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: color! }}
            />
            {roleName}
          </span>
        )}
      </div>
      {node.deadline_hours !== null && (
        <div className="pointer-events-none absolute right-0 bottom-0 p-[10px] text-[10.5px] text-zinc-500">
          {`${node.deadline_hours} h`}
        </div>
      )}
    </div>
  );
}

const NODE_LABEL_CLASS =
  "absolute top-full left-1/2 -translate-x-1/2 mt-1 w-max max-w-[120px] text-center text-[11.5px] text-zinc-600";

export function EventShape({ node, selected, ghost = false, onCitationClick }: {
  node: ProcessNode;
  selected: boolean;
  ghost?: boolean;
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
  const stroke = ghost ? "#7c3aed" : selected ? "#2563eb" : baseStroke;
  const width = (isStart ? 1.5 : 3.5) + (selected ? 0.5 : 0);
  const radius = isStart ? 18 : 17;
  const cited =
    node.citations.length > 0 ||
    node.checks.some((check) => check.citations.length > 0);
  return (
    <div
      className={`relative flex h-[40px] w-[40px] items-center justify-center${
        ghost ? " opacity-70" : ""
      }`}
      data-ghost={ghost ? "true" : "false"}
    >
      <svg width="40" height="40">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="#ffffff"
          stroke={stroke}
          strokeWidth={width}
          strokeDasharray={ghost ? "5 4" : undefined}
        />
      </svg>
      <div className={NODE_LABEL_CLASS}>
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

export function GatewayNode({ node, selected, ghost = false, onCitationClick }: {
  node: ProcessNode;
  selected: boolean;
  ghost?: boolean;
  onCitationClick?: (id: string) => void;
}) {
  const stroke = ghost ? "#7c3aed" : selected ? "#2563eb" : "#a1a1aa";
  const cited =
    node.citations.length > 0 ||
    node.checks.some((check) => check.citations.length > 0);
  return (
    <div
      className={`relative flex h-[52px] w-[52px] items-center justify-center${
        ghost ? " opacity-70" : ""
      }`}
      data-ghost={ghost ? "true" : "false"}
    >
      <svg width="52" height="52">
        <polygon
          points="26,0 52,26 26,52 0,26"
          fill="#ffffff"
          stroke={stroke}
          strokeWidth={selected ? 2 : 1.5}
          strokeDasharray={ghost ? "5 4" : undefined}
        />
        <path
          d="M20 20 L32 32 M32 20 L20 32"
          stroke="#52525b"
          strokeWidth="2"
          fill="none"
        />
      </svg>
      <div className={NODE_LABEL_CLASS}>
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
export function EdgePill({ text, anchor }: {
  text: string;
  anchor: DiagramPoint;
}) {
  return (
    <div
      className="nodrag nopan absolute rounded-md border border-[#e4e4e7] bg-white px-1.5 text-[11px] font-medium text-zinc-700 max-w-[160px] truncate"
      style={{
        transform: `translate(-50%, -50%) translate(${anchor.x}px, ${anchor.y}px)`,
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}

export function ElkEdge({ markerEnd, data }: EdgeProps) {
  const { points, pill, anchor, ghost } = data as DiagramEdgeData & {
    ghost?: boolean;
  };
  const path = roundedPath(points);
  const resolved = edgeAnchor({ anchor }, points);
  return (
    <>
      <BaseEdge
        path={path}
        stroke="#a1a1aa"
        strokeWidth={1.5}
        style={
          ghost
            ? { stroke: "#7c3aed", strokeWidth: 1.5, strokeDasharray: "5 4" }
            : undefined
        }
        markerEnd={markerEnd}
      />
      {pill !== null && resolved !== null && (
        <EdgeLabelRenderer>
          <EdgePill text={pill} anchor={resolved} />
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
          onCitationClick={d.onCitationClick}
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
          onCitationClick={d.onCitationClick}
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
          onCitationClick={d.onCitationClick}
        />
      </>
    );
  },
};

const edgeTypes: EdgeTypes = { elk: ElkEdge };

function minimapColor(node: FlowNode): string {
  const d = node.data as DiagramNodeData;
  if (d.node.type === "task" && d.color !== null) {
    return d.color;
  }
  if (d.node.type === "end" && d.node.end_result === "approved") {
    return "#16a34a";
  }
  if (d.node.type === "end" && d.node.end_result === "refused") {
    return "#dc2626";
  }
  return "#d4d4d8";
}

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
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
          onClick={() => fitView()}
        >
          <Maximize size={14} />
        </button>
      </div>
    </Panel>
  );
}

function Legend() {
  const rowClass = "flex items-center gap-1.5 text-[11px] text-zinc-600";
  return (
    <Panel position="top-left">
      <div className="rounded-md border border-[#e4e4e7] bg-white p-2 shadow-sm">
        <div className="mb-1 text-[11px] font-medium text-zinc-500">Legend</div>
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
    </Panel>
  );
}

export function ProcessDiagram({
  def,
  selectedNodeId,
  onNodeSelect,
  ghost,
  onCitationClick,
  minimap = true,
}: {
  def: ProcessDefinition;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  ghost: boolean;
  onCitationClick: (id: string) => void;
  minimap?: boolean;
}) {
  const [layout, setLayout] = useState<Awaited<ReturnType<typeof layoutProcess>> | null>(null);
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
    return layout.nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        selected: n.id === selectedNodeId,
        ghost,
        onCitationClick,
      },
    }));
  }, [layout, selectedNodeId, ghost, onCitationClick]);

  const edges = useMemo(() => {
    if (layout === null) {
      return [];
    }
    return layout.edges.map((e) => ({
      ...e,
      data: { ...e.data, ghost },
      markerEnd:
        ghost && typeof e.markerEnd === "object"
          ? { ...e.markerEnd, color: "#7c3aed" }
          : e.markerEnd,
    }));
  }, [layout, ghost]);

  if (layout === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Laying out the diagram
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Process diagram"
      className="h-full w-full"
      style={{ backgroundColor: "var(--canvas)" }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.2}
        maxZoom={2}
        onNodeClick={(_, n) => onNodeSelect(n.id)}
        onPaneClick={() => onNodeSelect(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#d4d4d8" />
        {minimap && <MiniMap position="bottom-right" pannable zoomable nodeColor={minimapColor} />}
        <ZoomControls />
        <Legend />
        <Panel position="top-right">
          <div className="text-[12px] text-zinc-500">
            {`${layout.nodes.length} steps, ${layout.edges.length} links`}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
