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

// The point at half of the total path length, interpolated inside the
// segment that crosses it. One rule for every point count.
function pillAnchor(points: DiagramPoint[]): DiagramPoint {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    const length = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (walked + length >= total / 2 || i === points.length - 1) {
      const t = length === 0 ? 0 : (total / 2 - walked) / length;
      return { x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t };
    }
    walked += length;
  }
  return points[0]!;
}

export function TaskCard({ node, color, roleName, selected }: {
  node: ProcessNode;
  color: string | null;
  roleName: string | null;
  selected: boolean;
}) {
  return (
    <div
      className="relative h-[72px] w-[128px] rounded-lg bg-white shadow-sm"
      style={{
        border: selected ? "2px solid #2563eb" : "1px solid #d4d4d8",
        boxShadow: selected ? "0 0 0 3px rgba(37, 99, 235, 0.12)" : undefined,
      }}
    >
      {/* One top band: the name reserves the indicator width, so the
          two never paint over each other. The padding sits on the
          wrapper and the clamp on the inner div, so a clamped line
          never paints into the padding band. */}
      <div className="absolute inset-x-0 top-0 flex items-start gap-1 p-[10px]">
        <div className="min-w-0 flex-1 break-words text-[11.5px] leading-tight font-semibold text-zinc-800 line-clamp-2">
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
      <div className="absolute bottom-0 left-0 p-[10px]">
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
        <div className="absolute right-0 bottom-0 p-[10px] text-[10.5px] text-zinc-500">
          {`${node.deadline_hours} h`}
        </div>
      )}
    </div>
  );
}

const NODE_LABEL_CLASS =
  "absolute top-full left-1/2 -translate-x-1/2 mt-1 w-max max-w-[120px] text-center text-[11.5px] text-zinc-600";

export function EventShape({ node, selected }: { node: ProcessNode; selected: boolean }) {
  const isStart = node.type === "start";
  const endStroke =
    node.end_result === "approved"
      ? "#16a34a"
      : node.end_result === "refused"
        ? "#dc2626"
        : "#71717a";
  const baseStroke = isStart ? "#71717a" : endStroke;
  const stroke = selected ? "#2563eb" : baseStroke;
  const width = (isStart ? 1.5 : 3.5) + (selected ? 0.5 : 0);
  const radius = isStart ? 18 : 17;
  return (
    <div className="relative flex h-[40px] w-[40px] items-center justify-center">
      <svg width="40" height="40">
        <circle cx="20" cy="20" r={radius} fill="#ffffff" stroke={stroke} strokeWidth={width} />
      </svg>
      <div className={NODE_LABEL_CLASS}>{node.name}</div>
    </div>
  );
}

export function GatewayNode({ node, selected }: { node: ProcessNode; selected: boolean }) {
  const stroke = selected ? "#2563eb" : "#a1a1aa";
  return (
    <div className="relative flex h-[52px] w-[52px] items-center justify-center">
      <svg width="52" height="52">
        <polygon
          points="26,0 52,26 26,52 0,26"
          fill="#ffffff"
          stroke={stroke}
          strokeWidth={selected ? 2 : 1.5}
        />
        <path
          d="M20 20 L32 32 M32 20 L20 32"
          stroke="#52525b"
          strokeWidth="2"
          fill="none"
        />
      </svg>
      <div className={NODE_LABEL_CLASS}>{node.name}</div>
    </div>
  );
}

function ElkEdge({ markerEnd, data }: EdgeProps) {
  const { points, pill } = data as DiagramEdgeData;
  const path = roundedPath(points);
  const anchor = pillAnchor(points);
  return (
    <>
      <BaseEdge path={path} stroke="#a1a1aa" strokeWidth={1.5} markerEnd={markerEnd} />
      {pill !== null && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-md border border-[#e4e4e7] bg-white px-1.5 text-[11px] font-medium text-zinc-700 max-w-[160px] truncate"
            style={{
              transform: `translate(-50%, -50%) translate(${anchor.x}px, ${anchor.y}px)`,
              pointerEvents: "all",
            }}
          >
            {pill}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes: NodeTypes = {
  task: ({ data }: NodeProps) => {
    const d = data as DiagramNodeData;
    return (
      <>
        <NodeHandles />
        <TaskCard node={d.node} color={d.color} roleName={d.roleName} selected={d.selected} />
      </>
    );
  },
  gateway: ({ data }: NodeProps) => {
    const d = data as DiagramNodeData;
    return (
      <>
        <NodeHandles />
        <GatewayNode node={d.node} selected={d.selected} />
      </>
    );
  },
  start: ({ data }: NodeProps) => {
    const d = data as DiagramNodeData;
    return (
      <>
        <NodeHandles />
        <EventShape node={d.node} selected={d.selected} />
      </>
    );
  },
  end: ({ data }: NodeProps) => {
    const d = data as DiagramNodeData;
    return (
      <>
        <NodeHandles />
        <EventShape node={d.node} selected={d.selected} />
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
}: {
  def: ProcessDefinition;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
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
      data: { ...n.data, selected: n.id === selectedNodeId },
    }));
  }, [layout, selectedNodeId]);

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
        edges={layout.edges}
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
        <MiniMap position="bottom-right" pannable zoomable nodeColor={minimapColor} />
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
