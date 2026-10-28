// Bridge from a process definition to laid-out React Flow nodes and
// edges. ELK computes every position: the definition carries none.

import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { NodeType, ProcessDefinition, ProcessEdge, ProcessNode } from "./types";

export const ROLE_COLORS = [
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#65a30d",
];

export function roleColor(def: ProcessDefinition, roleId: string | null): string | null {
  if (roleId === null) {
    return null;
  }
  const index = def.roles.findIndex((role) => role.id === roleId);
  if (index === -1) {
    return null;
  }
  return ROLE_COLORS[index % ROLE_COLORS.length];
}

export function edgePillText(e: ProcessEdge): string | null {
  return e.label ?? e.decision ?? e.condition ?? (e.is_default ? "Default" : null);
}

export const PILL_HEIGHT = 15;
export const PILL_MARGIN = 2;

// The pill width estimate: 6.6 px per character plus 14 px of
// padding and border. It overestimates every pill string of the
// seed process (scratch measure.mjs).
export function estimatePillWidth(text: string): number {
  return text.length * 6.6 + 14;
}

// The point at half of the total path length, interpolated inside the
// segment that crosses it. One rule for every point count.
export function pathMidpoint(points: DiagramPoint[]): DiagramPoint {
  return pointAtLength(points, pathLengthOf(points) / 2);
}

function pathLengthOf(points: DiagramPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

function pointAtLength(points: DiagramPoint[], target: number): DiagramPoint {
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    const length = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (walked + length >= target || i === points.length - 1) {
      const t = length === 0 ? 0 : (target - walked) / length;
      return { x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t };
    }
    walked += length;
  }
  return points[0]!;
}

// The overlap of two boxes: a positive area, or 0. Edges that touch
// count as free.
function overlapArea(bx: number, by: number, w: number, h: number, b: Box): number {
  const ox = Math.min(bx + w, b.x + b.w) - Math.max(bx, b.x);
  const oy = Math.min(by + h, b.y + b.h) - Math.max(by, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

// True when the pill box of width w at the center (cx, cy), inflated
// by PILL_MARGIN on every side, overlaps no box.
function boxFree(cx: number, cy: number, w: number, boxes: Box[]): boolean {
  const x = cx - w / 2 - PILL_MARGIN;
  const y = cy - PILL_HEIGHT / 2 - PILL_MARGIN;
  return !boxes.some(
    (b) => overlapArea(x, y, w + 2 * PILL_MARGIN, PILL_HEIGHT + 2 * PILL_MARGIN, b) > 0,
  );
}

// One free stretch of one axis-aligned segment: the center range
// [lo, hi] on the segment axis, at path offset lengthBefore.
interface Stretch {
  prev: DiagramPoint;
  lo: number;
  hi: number;
  lengthBefore: number;
  horizontal: boolean;
}

// The free center ranges of every axis-aligned segment. A box blocks
// a center range when the pill band on the perpendicular axis
// overlaps the box range. The box itself is not inflated: the margin
// sits on the pill side only.
function freeStretches(points: DiagramPoint[], boxes: Box[], w: number): Stretch[] {
  const out: Stretch[] = [];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    const segLength = Math.hypot(p.x - prev.x, p.y - prev.y);
    const horizontal = Math.abs(p.y - prev.y) < 1e-9;
    const vertical = Math.abs(p.x - prev.x) < 1e-9;
    if (horizontal || vertical) {
      const bandLow = horizontal
        ? prev.y - PILL_HEIGHT / 2 - PILL_MARGIN
        : prev.x - w / 2 - PILL_MARGIN;
      const bandHigh = horizontal
        ? prev.y + PILL_HEIGHT / 2 + PILL_MARGIN
        : prev.x + w / 2 + PILL_MARGIN;
      const segLow = horizontal ? Math.min(prev.x, p.x) : Math.min(prev.y, p.y);
      const segHigh = horizontal ? Math.max(prev.x, p.x) : Math.max(prev.y, p.y);
      const blocked: Array<[number, number]> = [];
      for (const b of boxes) {
        const boxLow = horizontal ? b.y : b.x;
        const boxHigh = horizontal ? b.y + b.h : b.x + b.w;
        const centerLow = horizontal
          ? b.x - w / 2 - PILL_MARGIN
          : b.y - PILL_HEIGHT / 2 - PILL_MARGIN;
        const centerHigh = horizontal
          ? b.x + b.w + w / 2 + PILL_MARGIN
          : b.y + b.h + PILL_HEIGHT / 2 + PILL_MARGIN;
        if (Math.min(bandHigh, boxHigh) > Math.max(bandLow, boxLow)) {
          const lo = Math.max(centerLow, segLow);
          const hi = Math.min(centerHigh, segHigh);
          if (hi > lo) {
            blocked.push([lo, hi]);
          }
        }
      }
      blocked.sort((a, b) => a[0] - b[0]);
      let cur = segLow;
      for (const [lo, hi] of blocked) {
        if (lo > cur) {
          out.push({ prev, lo: cur, hi: lo, lengthBefore: walked, horizontal });
        }
        cur = Math.max(cur, hi);
        if (cur >= segHigh) {
          break;
        }
      }
      if (cur < segHigh) {
        out.push({ prev, lo: cur, hi: segHigh, lengthBefore: walked, horizontal });
      }
    }
    walked += segLength;
  }
  return out;
}

// The anchor of one pill. Returns null when the pill must not
// render. Rules, in order:
// 1. The estimated pill box (width w, height 15) centered at the
//    path midpoint, inflated by PILL_MARGIN, overlaps no box of
//    boxes: the anchor is the midpoint.
// 2. Else, if some stretch of the path holds a free center: the
//    anchor is the center of the stretch whose center sits nearest
//    the path midpoint. A tie takes the smaller path length.
// 3. Else, the hidden fraction: the sum of the overlap areas of the
//    raw estimated box at the midpoint with every box, divided by
//    w * 15. At 0.2 or more, return null. Below 0.2, return the
//    midpoint.
export function pillPlacement(
  points: DiagramPoint[],
  boxes: Box[],
  text: string,
): DiagramPoint | null {
  const w = estimatePillWidth(text);
  const mid = pathMidpoint(points);
  if (boxFree(mid.x, mid.y, w, boxes)) {
    return mid;
  }
  const stretches = freeStretches(points, boxes, w);
  if (stretches.length > 0) {
    const total = pathLengthOf(points);
    let best: DiagramPoint | null = null;
    let bestDist = Infinity;
    for (const s of stretches) {
      const center = (s.lo + s.hi) / 2;
      const len = s.lengthBefore +
        Math.abs(center - (s.horizontal ? s.prev.x : s.prev.y));
      const dist = Math.abs(len - total / 2);
      // A tie keeps the earlier stretch: the smaller path length.
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        best = pointAtLength(points, len);
      }
    }
    if (best !== null) {
      return best;
    }
  }
  const hidden = boxes.reduce(
    (acc, b) => acc + overlapArea(mid.x - w / 2, mid.y - PILL_HEIGHT / 2, w, PILL_HEIGHT, b),
    0,
  );
  return hidden / (w * PILL_HEIGHT) >= 0.2 ? null : mid;
}

export const NODE_SIZE: Record<NodeType, { width: number; height: number }> = {
  start: { width: 40, height: 40 },
  task: { width: 128, height: 72 },
  gateway: { width: 52, height: 52 },
  end: { width: 40, height: 40 },
};

export interface DiagramPoint {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramNodeData {
  node: ProcessNode;
  color: string | null;
  roleName: string | null;
  selected: boolean;
  [key: string]: unknown;
}

export interface DiagramEdgeData {
  points: DiagramPoint[];
  pill: string | null;
  anchor?: DiagramPoint | null;
  [key: string]: unknown;
}

export type FlowNode = Node<DiagramNodeData>;
export type FlowEdge = Edge<DiagramEdgeData>;

const NODE_TYPES: readonly NodeType[] = ["start", "task", "gateway", "end"];

export function assertDefinition(def: ProcessDefinition): void {
  for (const node of def.nodes) {
    if (!NODE_TYPES.includes(node.type)) {
      throw new Error(`unknown node type: ${node.type} (node ${node.id})`);
    }
  }
  const ids = new Set(def.nodes.map((node) => node.id));
  for (const edge of def.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      const missing = ids.has(edge.from) ? edge.to : edge.from;
      throw new Error(`unknown node id: ${missing} (edge ${edge.id})`);
    }
  }
}

export function toElkGraph(def: ProcessDefinition): ElkNode {
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
    },
    children: def.nodes.map((node) => ({
      id: node.id,
      width: NODE_SIZE[node.type].width,
      height: NODE_SIZE[node.type].height,
    })),
    edges: def.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };
}

function roleNameOf(def: ProcessDefinition, node: ProcessNode): string | null {
  if (node.role === null) {
    return null;
  }
  return def.roles.find((role) => role.id === node.role)?.name ?? null;
}

export async function layoutProcess(def: ProcessDefinition): Promise<{
  nodes: FlowNode[];
  edges: FlowEdge[];
  width: number;
  height: number;
}> {
  assertDefinition(def);
  const graph = toElkGraph(def);
  const laidOut = await new ELK().layout(graph);
  const byId = new Map(def.nodes.map((node) => [node.id, node]));
  const boxes: Box[] = (laidOut.children ?? []).map((child) => ({
    x: child.x ?? 0,
    y: child.y ?? 0,
    w: child.width ?? 0,
    h: child.height ?? 0,
  }));
  const nodes: FlowNode[] = (laidOut.children ?? []).map((child) => {
    const node = byId.get(child.id) as ProcessNode;
    return {
      id: child.id,
      type: node.type,
      position: { x: child.x ?? 0, y: child.y ?? 0 },
      width: child.width,
      height: child.height,
      draggable: false,
      selectable: true,
      ariaLabel: `${node.name}, ${node.type}`,
      data: {
        node,
        color: roleColor(def, node.role),
        roleName: roleNameOf(def, node),
        selected: false,
      },
    };
  });
  const edges: FlowEdge[] = (laidOut.edges ?? []).map((elkEdge) => {
    const edge = def.edges.find((e) => e.id === elkEdge.id) as ProcessEdge;
    const section = elkEdge.sections![0]!;
    const points: DiagramPoint[] = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];
    const pill = edgePillText(edge);
    const anchor = pill === null ? null : pillPlacement(points, boxes, pill);
    return {
      id: elkEdge.id,
      source: edge.from,
      target: edge.to,
      type: "elk",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a", width: 8, height: 8 },
      data: { points, pill, anchor },
    };
  });
  return { nodes, edges, width: laidOut.width ?? 0, height: laidOut.height ?? 0 };
}
