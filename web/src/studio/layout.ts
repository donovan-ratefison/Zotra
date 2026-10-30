// Bridge from a process definition to laid-out React Flow nodes and
// edges. ELK computes every position: the definition carries none.

import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";
import { MarkerType, Position } from "@xyflow/react";
import type { NodeType, ProcessDefinition, ProcessEdge, ProcessNode, SourceRow } from "./types";

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
  task: { width: 152, height: 72 },
  gateway: { width: 52, height: 52 },
  end: { width: 40, height: 40 },
};

// The text of one edge on the canvas. A gateway with one condition
// edge and one default edge asks a yes or no question (its name), so
// its edges read "Yes" and "No", as in the design mockup. The raw
// condition shows only when the gateway has more branches. The node
// panel keeps edgePillText, with the full condition.
export function diagramEdgeText(edge: ProcessEdge, def: ProcessDefinition): string | null {
  if (edge.label !== null || edge.decision !== null) {
    return edge.label ?? edge.decision;
  }
  const siblings = def.edges.filter((e) => e.from === edge.from);
  const yesNo =
    siblings.length === 2 &&
    siblings.filter((e) => e.condition !== null).length === 1 &&
    siblings.some((e) => e.is_default);
  if (edge.condition !== null) {
    return yesNo ? "Yes" : edge.condition;
  }
  if (edge.is_default) {
    return yesNo ? "No" : "Otherwise";
  }
  return null;
}

// Where the name of a start, gateway or end node sits: below the
// shape by default, above it or at its left when a link uses that
// side.
export type LabelPos = "below" | "above" | "left";

// The grid layout of the design mockup. The main path (start to the
// first approved end, fewest steps) runs on one row. Every other node
// sits below the right-most node that leads to it. Links are
// orthogonal: straight along the row, down to a lower row, up into
// the bottom of a node, and over the row for a link that goes back.
// The layout returns null when a link would cross a node; the caller
// then uses ELK.
const GRID_GAP = 36;
const ROW_PITCH = 140;
const LANE_GAP = 26;
const LANE_STEP = 14;
const LABEL_CHAR = 6.4;
const LABEL_H = 16;
// The right-edge budget of one spine row: a row that stays under it
// keeps the fit zoom at 80 % or more at 1366 x 768. The seed row 0,
// the widest mockup row, ends at 1200.8 px.
const ROW_BUDGET = 1360;

function labelWidth(text: string): number {
  return text.length * LABEL_CHAR + 8;
}

interface Cell {
  cx: number;
  cy: number;
  w: number;
  h: number;
  row: number;
}

type Side = "N" | "S" | "E" | "W";

interface Route {
  edge: ProcessEdge;
  from: Side;
  to: Side;
  // The fixed points between the two ports, filled after the ports.
  build: (a: DiagramPoint, b: DiagramPoint) => DiagramPoint[];
  // The corridor of this link. `corridor` is the y of the band at the
  // source end, `corridor2` the y of the band at the target end. Set
  // for a turn to the next spine row, for a return to an upper row,
  // and for a cross-row link whose direct way hits a node. The two ys
  // differ when the two rows lie two or more apart: the link then
  // also runs down the outer margin (`marginX`) between the bands
  // (R6). Undefined for every other link.
  corridor?: number;
  corridor2?: number;
  marginX?: number;
}

export interface GridLayout {
  cells: Map<string, Cell>;
  points: Map<string, DiagramPoint[]>;
  anchors: Map<string, DiagramPoint | null>;
  labelPos: Map<string, LabelPos>;
}

// The main path: breadth-first from the start, so the fewest steps,
// to the first approved end (else the first end).
export function mainPath(def: ProcessDefinition): string[] | null {
  const start = def.nodes.find((n) => n.type === "start");
  if (start === undefined) {
    return null;
  }
  const prev = new Map<string, string | null>([[start.id, null]]);
  const queue = [start.id];
  let firstEnd: string | null = null;
  let approved: string | null = null;
  while (queue.length > 0 && approved === null) {
    const id = queue.shift()!;
    const node = def.nodes.find((n) => n.id === id)!;
    if (node.type === "end") {
      firstEnd ??= id;
      if (node.end_result === "approved") {
        approved = id;
      }
      continue;
    }
    for (const e of def.edges) {
      if (e.from === id && !prev.has(e.to)) {
        prev.set(e.to, id);
        queue.push(e.to);
      }
    }
  }
  const id = approved ?? firstEnd;
  if (id === null) {
    return null;
  }
  const path: string[] = [];
  for (let cur: string | null = id; cur !== null; cur = prev.get(cur) ?? null) {
    path.unshift(cur);
  }
  return path;
}

// A depth-first walk from the start: the back links (to a node on
// the walk stack, so a loop) and a topological order of the other
// links, so every node comes after the nodes that lead to it.
function walk(def: ProcessDefinition, startId: string): { order: string[]; back: Set<string> } {
  const back = new Set<string>();
  const state = new Map<string, "open" | "done">();
  const post: string[] = [];
  const visit = (id: string) => {
    state.set(id, "open");
    for (const e of def.edges) {
      if (e.from !== id) {
        continue;
      }
      const st = state.get(e.to);
      if (st === "open") {
        back.add(e.id);
      } else if (st === undefined) {
        visit(e.to);
      }
    }
    state.set(id, "done");
    post.push(id);
  };
  visit(startId);
  const order = [...post].reverse();
  // The nodes that the start does not reach continue the walk, so
  // their back links follow the same rule.
  for (const n of def.nodes) {
    if (!state.has(n.id)) {
      visit(n.id);
    }
  }
  return { order, back };
}

function port(c: Cell, side: Side, offset: number): DiagramPoint {
  switch (side) {
    case "N":
      return { x: c.cx + offset, y: c.cy - c.h / 2 };
    case "S":
      return { x: c.cx + offset, y: c.cy + c.h / 2 };
    case "E":
      return { x: c.cx + c.w / 2, y: c.cy };
    case "W":
      return { x: c.cx - c.w / 2, y: c.cy };
  }
}

// The offset key of one end of a link. The two ends of a link to
// itself sit on the same side, so they need two keys.
function portKey(e: ProcessEdge, end: "from" | "to"): string {
  return `${e.id}:${e[end]}${end === "to" && e.from === e.to ? ":in" : ""}`;
}

function boxOf(c: Cell): Box {
  return { x: c.cx - c.w / 2, y: c.cy - c.h / 2, w: c.w, h: c.h };
}

// True when the axis-aligned segment a-b crosses the inside of box b.
function segmentHits(a: DiagramPoint, p: DiagramPoint, b: Box): boolean {
  const x1 = Math.min(a.x, p.x);
  const x2 = Math.max(a.x, p.x);
  const y1 = Math.min(a.y, p.y);
  const y2 = Math.max(a.y, p.y);
  return x2 > b.x + 1 && x1 < b.x + b.w - 1 && y2 > b.y + 1 && y1 < b.y + b.h - 1;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return overlapArea(a.x, a.y, a.w, a.h, b) > 0;
}

// The box of the name of a start, gateway or end node.
function nodeLabelBox(node: ProcessNode, c: Cell, pos: LabelPos): Box {
  const w = Math.min(120, labelWidth(node.name));
  const h = Math.max(1, Math.ceil(labelWidth(node.name) / 120)) * 15;
  if (pos === "above") {
    return { x: c.cx - w / 2, y: c.cy - c.h / 2 - 4 - h, w, h };
  }
  if (pos === "left") {
    return { x: c.cx - 8 - w, y: c.cy + c.h / 2 + 4, w, h };
  }
  return { x: c.cx - w / 2, y: c.cy + c.h / 2 + 4, w, h };
}

export function gridLayout(def: ProcessDefinition): GridLayout | null {
  const spine = mainPath(def);
  if (spine === null) {
    return null;
  }
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  // A link to itself is drawn only on a task; the fallback draws the
  // other ones.
  if (def.edges.some((e) => e.from === e.to && byId.get(e.from)?.type !== "task")) {
    return null;
  }
  const { order, back } = walk(def, spine[0]!);
  const sizeOf = (id: string) => NODE_SIZE[byId.get(id)!.type];
  const cells = new Map<string, Cell>();
  const labelOf = (from: string, to: string) => {
    const e = def.edges.find((x) => x.from === from && x.to === to);
    const text = e === undefined ? null : diagramEdgeText(e, def);
    return text === null ? 0 : labelWidth(text) + 12;
  };

  // 1. The main path. A row holds spine nodes until the next node
  // would push the row right edge past ROW_BUDGET, and the rest
  // continues on the row below, again from the left, so every row
  // reads left to right. The gap between two nodes still holds the
  // text of their link.
  let x = 0;
  let row = 0;
  spine.forEach((id, i) => {
    const s = sizeOf(id);
    if (i === 0) {
      x = s.width / 2;
    } else {
      const p = cells.get(spine[i - 1]!)!;
      const next = p.cx + p.w / 2 + Math.max(GRID_GAP, labelOf(spine[i - 1]!, id)) + s.width / 2;
      if (next + s.width / 2 > ROW_BUDGET) {
        row++;
        x = s.width / 2;
      } else {
        x = next;
      }
    }
    cells.set(id, { cx: x, cy: row * ROW_PITCH, w: s.width, h: s.height, row });
  });
  // The final end of the main path sits under the task before it, as
  // in the mockup: the row stays short enough to read at full size.
  const last = spine[spine.length - 1]!;
  const beforeLast = spine[spine.length - 2];
  if (beforeLast !== undefined && byId.get(beforeLast)!.type === "task") {
    const p = cells.get(beforeLast)!;
    const c = cells.get(last)!;
    cells.set(last, { ...c, cx: p.cx, cy: p.cy + ROW_PITCH, row: p.row + 1 });
  }

  // 2. Every other node, in topological order: below the right-most
  // node that leads to it, in the first free row.
  const free = (c: Cell) =>
    [...cells.values()].every(
      (o) => o.row !== c.row ||
        c.cx + c.w / 2 + GRID_GAP / 2 <= o.cx - o.w / 2 ||
        o.cx + o.w / 2 + GRID_GAP / 2 <= c.cx - c.w / 2,
    );
  for (const id of order) {
    if (cells.has(id)) {
      continue;
    }
    const anchors = def.edges
      .filter((e) => e.to === id && !back.has(e.id) && cells.has(e.from))
      .map((e) => cells.get(e.from)!)
      .sort((a, b) => b.cx - a.cx || b.row - a.row);
    const anchor = anchors[0]!;
    const s = sizeOf(id);
    let row = anchor.row + 1;
    let cell: Cell = { cx: anchor.cx, cy: row * ROW_PITCH, w: s.width, h: s.height, row };
    while (!free(cell)) {
      row++;
      cell = { ...cell, cy: row * ROW_PITCH, row };
    }
    cells.set(id, cell);
  }

  // 2b. Each node that the start does not reach (a new step with no
  // link yet) goes on a parking row under the diagram, left to right,
  // so the reached nodes keep their place.
  let parkRow = Math.max(...[...cells.values()].map((c) => c.row)) + 1;
  let parkRight = 0;
  for (const n of def.nodes) {
    if (cells.has(n.id)) {
      continue;
    }
    const s = NODE_SIZE[n.type];
    let cx = parkRight === 0 ? s.width / 2 : parkRight + GRID_GAP + s.width / 2;
    if (parkRight !== 0 && cx + s.width / 2 > ROW_BUDGET) {
      parkRow++;
      cx = s.width / 2;
    }
    cells.set(n.id, { cx, cy: parkRow * ROW_PITCH, w: s.width, h: s.height, row: parkRow });
    parkRight = cx + s.width / 2;
  }

  // 3. The route kind of every link. Spine steps on their row run
  // left to right and take the straight link. A leftward link on one
  // row takes a lane over the row, as before. A cross-row link takes
  // the corridor between its rows when it turns to the next spine
  // row (R3), when it returns to an upper row (R5), or, as step 5
  // finds, when its direct way down hits a node (R6).
  const spinePos = new Map(spine.map((id, i) => [id, i] as const));
  const rowTop = (row: number) =>
    Math.min(...[...cells.values()].filter((c) => c.row === row).map((c) => c.cy - c.h / 2));
  const lanes: ProcessEdge[] = [];
  const corridor: Route[] = [];
  const downs: Route[] = [];
  const routes: Route[] = def.edges.map((edge) => {
    const s = cells.get(edge.from)!;
    const t = cells.get(edge.to)!;
    if (s.row === t.row) {
      const between = [...cells.values()].some(
        (c) => c.row === s.row && c !== s && c !== t &&
          c.cx > Math.min(s.cx, t.cx) && c.cx < Math.max(s.cx, t.cx),
      );
      if (!between && t.cx > s.cx) {
        return { edge, from: "E", to: "W", build: (a, b) => [a, b] };
      }
      lanes.push(edge);
      // A lane over the row: step 8 sets its points.
      return { edge, from: "N", to: "N", build: (a, b) => [a, b] };
    }
    if (Math.abs(s.cx - t.cx) < 1) {
      // The straight drop; step 5 moves it to the corridor when a
      // node of a row between blocks it (R6).
      const r: Route = t.row > s.row
        ? { edge, from: "S", to: "N", build: (a, b) => [a, { x: a.x, y: b.y }] }
        : { edge, from: "N", to: "S", build: (a, b) => [a, { x: a.x, y: b.y }] };
      downs.push(r);
      return r;
    }
    if (t.row > s.row && spinePos.get(edge.to) === (spinePos.get(edge.from) ?? -2) + 1) {
      // The turn to the next spine row: S, corridor, N (R3).
      const r: Route = { edge, from: "S", to: "N", build: (a, b) => [a, b] };
      corridor.push(r);
      return r;
    }
    if (t.row < s.row) {
      // The return to an upper row: N, corridor, S (R5).
      const r: Route = { edge, from: "N", to: "S", build: (a, b) => [a, b] };
      corridor.push(r);
      return r;
    }
    // The direct way down to a lower row; step 5 moves it to the
    // corridor when a node blocks it (R6).
    const r: Route = {
      edge, from: "S", to: t.cx > s.cx ? "W" : "E",
      build: (a, b) => [a, { x: a.x, y: b.y }, b],
    };
    downs.push(r);
    return r;
  });

  // 4. Port offsets on the top and bottom of a task: links that turn
  // left sit left, links that turn right sit right, and a deeper link
  // sits further out, so no two links cross.
  const offsets = new Map<string, number>();
  const attach = new Map<string, Array<{ key: string; dir: number; depth: number }>>();
  for (const r of routes) {
    for (const [end, side, other, which] of [
      [r.edge.from, r.from, r.edge.to, "from"],
      [r.edge.to, r.to, r.edge.from, "to"],
    ] as const) {
      if (side !== "N" && side !== "S") {
        continue;
      }
      const c = cells.get(end)!;
      const o = cells.get(other)!;
      const dir = Math.abs(o.cx - c.cx) < 1 ? 0 : Math.sign(o.cx - c.cx);
      const list = attach.get(`${end}:${side}`) ?? [];
      list.push({ key: portKey(r.edge, which), dir, depth: Math.abs(o.row - c.row) });
      attach.set(`${end}:${side}`, list);
    }
  }
  for (const [k, list] of attach) {
    const c = cells.get(k.split(":")[0]!)!;
    if (c.w !== NODE_SIZE.task.width || list.length < 2) {
      continue;
    }
    list.sort((a, b) =>
      a.dir - b.dir || (a.dir < 0 ? a.depth - b.depth : b.depth - a.depth));
    const step = Math.min(32, (c.w - 40) / (list.length - 1));
    list.forEach((a, i) => offsets.set(a.key, (i - (list.length - 1) / 2) * step));
  }

  // 5. A cross-row link keeps its direct way when no node and no
  // node label sits in the way; else it joins the corridor of its
  // rows (R6). The corridor way enters the end face of the other
  // node, not its side. The check reads the label sides of the links
  // as they point now; a rerouted link enters an end face, which can
  // still move the label of its target afterwards.
  const labelSides = (rs: Route[]) => {
    const used = new Set(
      rs.flatMap((r) => [`${r.edge.from}:${r.from}`, `${r.edge.to}:${r.to}`]),
    );
    const pos = new Map<string, LabelPos>();
    for (const [id] of cells) {
      if (byId.get(id)!.type === "task") {
        continue;
      }
      pos.set(
        id,
        !used.has(`${id}:S`) ? "below" : !used.has(`${id}:N`) ? "above" : "left",
      );
    }
    return pos;
  };
  const sidesNow = labelSides(routes);
  const labelsNow: Box[] = [];
  for (const [id, c] of cells) {
    const side = sidesNow.get(id);
    if (side !== undefined) {
      labelsNow.push(nodeLabelBox(byId.get(id)!, c, side));
    }
  }
  for (const r of downs) {
    const s = cells.get(r.edge.from)!;
    const t = cells.get(r.edge.to)!;
    const a = port(s, r.from, offsets.get(`${r.edge.id}:${r.edge.from}`) ?? 0);
    const b = port(t, r.to, 0);
    const pts = r.build(a, b);
    const blocked = pts.some(
      (p, i) =>
        i > 0 &&
        ([...cells].some(
          ([id, c]) =>
            id !== r.edge.from && id !== r.edge.to &&
            segmentHits(pts[i - 1]!, p, boxOf(c)),
        ) ||
          labelsNow.some((b) => segmentHits(pts[i - 1]!, p, b))),
    );
    if (blocked) {
      if (r.to !== "N" && r.to !== "S") {
        r.to = "N";
      }
      corridor.push(r);
    }
  }

  // 6. The node labels: below, else above, else at the left. The
  // sides of the final routes decide.
  const labelPos = labelSides(routes);
  const obstacles: Box[] = [...cells.values()].map(boxOf);
  for (const [id, c] of cells) {
    const pos = labelPos.get(id);
    if (pos !== undefined) {
      obstacles.push(nodeLabelBox(byId.get(id)!, c, pos));
    }
  }

  // 7. The corridor of every corridor link (R7). The link runs in the
  // band between its two rows. When the rows lie two or more apart,
  // it runs in the band at each end and down the outer margin between
  // them, so no band of a row in between is crossed (R6). A band y
  // sits between the lowest obstacle of the band's upper row (its
  // label boxes included, at every label position) and the highest
  // obstacle of its lower row, minus the space of the lanes over it,
  // shared out in edge order.
  const bands = new Map<string, Route[]>();
  for (const r of corridor) {
    const s = cells.get(r.edge.from)!;
    const t = cells.get(r.edge.to)!;
    const down = t.row > s.row;
    const near = down ? `${s.row}:${s.row + 1}` : `${s.row - 1}:${s.row}`;
    const far = down ? `${t.row - 1}:${t.row}` : `${t.row}:${t.row + 1}`;
    for (const key of new Set([near, far])) {
      bands.set(key, [...(bands.get(key) ?? []), r]);
    }
  }
  const ys = new Map<string, Map<Route, number>>();
  for (const [key, list] of bands) {
    const upper = Number(key.split(":")[0]);
    const lower = Number(key.split(":")[1]);
    // The band obstacles: the cell of each row node united with its
    // label box, so a label below, at the left, or above also counts.
    const boxes = (row: number) =>
      [...cells].filter(([, c]) => c.row === row).map(([id, c]) => {
        const pos = labelPos.get(id);
        return pos === undefined
          ? boxOf(c)
          : unionBox(boxOf(c), nodeLabelBox(byId.get(id)!, c, pos));
      });
    const lo = Math.max(...boxes(upper).map((b) => b.y + b.h));
    const laneCount = lanes.filter((l) => cells.get(l.from)!.row === lower).length;
    const hi = Math.min(...boxes(lower).map((b) => b.y)) - LANE_GAP - laneCount * LANE_STEP;
    const m = new Map<Route, number>();
    list.forEach((r, i) => {
      m.set(r, lo + ((hi - lo) * (i + 1)) / (list.length + 1));
    });
    ys.set(key, m);
  }
  // The outer margin: 24 px clear of every shape and label, on the
  // side with the shorter run. Each weave link steps 12 px further
  // out, so the margin lines stay apart.
  const margin = {
    left: Math.min(...obstacles.map((b) => b.x)) - 24,
    right: Math.max(...obstacles.map((b) => b.x + b.w)) + 24,
  };
  let weaves = 0;
  for (const r of corridor) {
    const s = cells.get(r.edge.from)!;
    const t = cells.get(r.edge.to)!;
    const down = t.row > s.row;
    const near = down ? `${s.row}:${s.row + 1}` : `${s.row - 1}:${s.row}`;
    const far = down ? `${t.row - 1}:${t.row}` : `${t.row}:${t.row + 1}`;
    r.corridor = ys.get(near)!.get(r)!;
    if (far !== near) {
      r.corridor2 = ys.get(far)!.get(r)!;
      const a = port(s, r.from, offsets.get(`${r.edge.id}:${r.edge.from}`) ?? 0);
      const b = port(t, r.to, offsets.get(portKey(r.edge, "to")) ?? 0);
      const useLeft = a.x + b.x <= margin.left + margin.right;
      r.marginX = useLeft ? margin.left - 12 * weaves : margin.right + 12 * weaves;
      weaves++;
    }
  }

  // 8. The points. Lanes: the shortest span runs nearest the row.
  const points = new Map<string, DiagramPoint[]>();
  const laneOrder = [...lanes].sort((a, b) =>
    Math.abs(cells.get(a.from)!.cx - cells.get(a.to)!.cx) -
    Math.abs(cells.get(b.from)!.cx - cells.get(b.to)!.cx));
  for (const r of routes) {
    const s = cells.get(r.edge.from)!;
    const t = cells.get(r.edge.to)!;
    const a = port(s, r.from, offsets.get(`${r.edge.id}:${r.edge.from}`) ?? 0);
    const b = port(t, r.to, offsets.get(portKey(r.edge, "to")) ?? 0);
    if (r.edge.from === r.edge.to && Math.abs(a.x - b.x) < 32) {
      return null;
    }
    const lane = laneOrder.indexOf(r.edge);
    if (r.corridor !== undefined) {
      if (r.corridor2 === undefined) {
        // S or N, through the corridor, into N or S; one straight
        // drop when the two ports share the x.
        points.set(r.edge.id, Math.abs(a.x - b.x) < 1
          ? [a, { x: a.x, y: b.y }]
          : [a, { x: a.x, y: r.corridor }, { x: b.x, y: r.corridor }, b]);
      } else {
        // The band at each end and the outer margin between, so no
        // band of a row between is crossed (R6).
        points.set(r.edge.id, [
          a,
          { x: a.x, y: r.corridor },
          { x: r.marginX!, y: r.corridor },
          { x: r.marginX!, y: r.corridor2! },
          { x: b.x, y: r.corridor2! },
          b,
        ]);
      }
    } else if (lane >= 0) {
      const y = rowTop(s.row) - LANE_GAP - lane * LANE_STEP;
      points.set(r.edge.id, [a, { x: a.x, y }, { x: b.x, y }, b]);
    } else {
      points.set(r.edge.id, r.build(a, b));
    }
  }

  // 9. Check: no link crosses a node or a node label.
  for (const r of routes) {
    const pts = points.get(r.edge.id)!;
    for (let i = 1; i < pts.length; i++) {
      for (const [id, c] of cells) {
        if (id === r.edge.from || id === r.edge.to) {
          continue;
        }
        if (segmentHits(pts[i - 1]!, pts[i]!, boxOf(c))) {
          return null;
        }
      }
      for (const b of obstacles.slice(cells.size)) {
        if (segmentHits(pts[i - 1]!, pts[i]!, b)) {
          return null;
        }
      }
    }
  }

  // 10. The link texts: on the first horizontal stretch that holds
  // the text, at its middle, then at its quarters, else beside the
  // first vertical stretch long enough, at the same three positions,
  // never on a node, a node label or another text.
  const anchors = new Map<string, DiagramPoint | null>();
  const SPOTS = [0.5, 0.25, 0.75];
  for (const r of routes) {
    const text = diagramEdgeText(r.edge, def);
    if (text === null) {
      anchors.set(r.edge.id, null);
      continue;
    }
    const w = labelWidth(text);
    const pts = points.get(r.edge.id)!;
    const tries: Box[] = [];
    if (r.edge.from === r.edge.to) {
      // The text of a link to itself sits over the middle of its lane.
      const p = pts[1]!;
      const q = pts[2]!;
      tries.push({ x: (p.x + q.x) / 2 - w / 2, y: p.y - 4 - LABEL_H, w, h: LABEL_H });
    }
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!;
      const q = pts[i]!;
      if (Math.abs(p.y - q.y) < 1 && Math.abs(q.x - p.x) >= w + 8) {
        for (const t of SPOTS) {
          tries.push({
            x: p.x + (q.x - p.x) * t - w / 2,
            y: p.y - 4 - LABEL_H,
            w,
            h: LABEL_H,
          });
        }
      }
    }
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!;
      const q = pts[i]!;
      if (Math.abs(p.x - q.x) < 1 && Math.abs(q.y - p.y) >= LABEL_H + 12) {
        for (const t of SPOTS) {
          tries.push({
            x: p.x + 6,
            y: p.y + (q.y - p.y) * t - LABEL_H / 2,
            w,
            h: LABEL_H,
          });
        }
      }
    }
    const spot = tries.find((b) => !obstacles.some((o) => boxesOverlap(b, o)));
    if (spot === undefined) {
      return null;
    }
    obstacles.push(spot);
    anchors.set(r.edge.id, { x: spot.x + w / 2, y: spot.y + LABEL_H / 2 });
  }
  return { cells, points, anchors, labelPos };
}

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

// The obstacle box of the node label text that the diagram renders
// below every start, gateway and end shape. It mirrors
// NODE_LABEL_CLASS of diagram.tsx: the label sits below the shape
// (top-full), mt-1 is 4 px, centered, w-max with max-w-[120px], text
// 11.5 px, so one line is 15 px and the text wraps at 120 px. The
// estimatePillWidth padding of 14 px is pill padding that the label
// has not, so the box overestimates: safe. Task cards carry the name
// inside the card, so they add no label box.
export function labelBox(node: ProcessNode, nodeBox: Box): Box {
  const est = estimatePillWidth(node.name);
  const w = Math.min(120, est);
  const lines = Math.max(1, Math.ceil(est / 120));
  const h = lines * 15;
  return {
    x: nodeBox.x + nodeBox.w / 2 - w / 2,
    y: nodeBox.y + nodeBox.h + 4,
    w,
    h,
  };
}

export interface DiagramNodeData {
  node: ProcessNode;
  color: string | null;
  roleName: string | null;
  selected: boolean;
  labelPos?: LabelPos;
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
      // DEPTH_FIRST breaks the seed process feedback loops by their
      // reverse edge, so every other node stays in one left-to-right
      // band (scratch sweep.mjs, feedback item 0001).
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
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

// The measured size and the two handles of a node. With them, React
// Flow keeps the handle bounds when a new node object replaces the
// old one, so the links always render (feedback item 0006).
function nodeFrame(width: number, height: number) {
  return {
    measured: { width, height },
    handles: [
      { type: "target" as const, position: Position.Left, x: 0, y: height / 2, width: 1, height: 1, id: null },
      { type: "source" as const, position: Position.Right, x: width, y: height / 2, width: 1, height: 1, id: null },
    ],
  };
}

// The React Flow nodes and edges of a grid layout, moved so that
// every shape, link and text has a positive position.
function fromGrid(def: ProcessDefinition, grid: GridLayout) {
  const byId = new Map(def.nodes.map((node) => [node.id, node]));
  const boxes: Box[] = [...grid.cells].map(([id, c]) => {
    const box = boxOf(c);
    const pos = grid.labelPos.get(id);
    return pos === undefined ? box : unionBox(box, nodeLabelBox(byId.get(id)!, c, pos));
  });
  for (const pts of grid.points.values()) {
    for (const p of pts) {
      boxes.push({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  }
  for (const [id, a] of grid.anchors) {
    if (a !== null) {
      const w = labelWidth(diagramEdgeText(def.edges.find((e) => e.id === id)!, def)!);
      boxes.push({ x: a.x - w / 2, y: a.y - LABEL_H / 2, w, h: LABEL_H });
    }
  }
  const all = boxes.reduce(unionBox);
  const margin = 8;
  const move = (p: DiagramPoint) => ({ x: p.x - all.x + margin, y: p.y - all.y + margin });
  const nodes: FlowNode[] = [...grid.cells].map(([id, c]) => {
    const node = byId.get(id)!;
    return {
      id,
      type: node.type,
      position: move({ x: c.cx - c.w / 2, y: c.cy - c.h / 2 }),
      width: c.w,
      height: c.h,
      ...nodeFrame(c.w, c.h),
      draggable: false,
      selectable: true,
      ariaLabel: `${node.name}, ${node.type}`,
      data: {
        node,
        color: roleColor(def, node.role),
        roleName: roleNameOf(def, node),
        selected: false,
        labelPos: grid.labelPos.get(id) ?? "below",
      },
    };
  });
  const edges: FlowEdge[] = def.edges.map((edge) => {
    const a = grid.anchors.get(edge.id) ?? null;
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: "elk",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a", width: 14, height: 14 },
      data: {
        points: grid.points.get(edge.id)!.map(move),
        pill: diagramEdgeText(edge, def),
        anchor: a === null ? null : move(a),
      },
    };
  });
  return { nodes, edges, width: all.w + 2 * margin, height: all.h + 2 * margin };
}

function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
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
  const grid = gridLayout(def);
  if (grid !== null) {
    return fromGrid(def, grid);
  }
  const graph = toElkGraph(def);
  let laidOut = await new ELK().layout(graph);
  if ((laidOut.width ?? 0) > ROW_BUDGET) {
    // A wide fallback wraps into several bands, so that it never draws
    // one band wider than the canvas (feedback item 0017).
    laidOut = await new ELK().layout({
      ...graph,
      layoutOptions: {
        ...graph.layoutOptions,
        "elk.layered.wrapping.strategy": "MULTI_EDGE",
        "elk.aspectRatio": "2.0",
      },
    });
  }
  const byId = new Map(def.nodes.map((node) => [node.id, node]));
  const boxes: Box[] = (laidOut.children ?? []).map((child) => ({
    x: child.x ?? 0,
    y: child.y ?? 0,
    w: child.width ?? 0,
    h: child.height ?? 0,
  }));
  // The pill obstacles are the node boxes, then the label boxes of
  // every start, gateway and end node, so no pill renders on a node
  // label (feedback item 0001).
  const obstacles: Box[] = [...boxes];
  (laidOut.children ?? []).forEach((child, index) => {
    const node = byId.get(child.id) as ProcessNode;
    if (node.type !== "task") {
      obstacles.push(labelBox(node, boxes[index]!));
    }
  });
  const nodes: FlowNode[] = (laidOut.children ?? []).map((child) => {
    const node = byId.get(child.id) as ProcessNode;
    return {
      id: child.id,
      type: node.type,
      position: { x: child.x ?? 0, y: child.y ?? 0 },
      width: child.width,
      height: child.height,
      ...nodeFrame(child.width ?? 0, child.height ?? 0),
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
    const anchor = pill === null ? null : pillPlacement(points, obstacles, pill);
    return {
      id: elkEdge.id,
      source: edge.from,
      target: edge.to,
      type: "elk",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a", width: 14, height: 14 },
      data: { points, pill, anchor },
    };
  });
  return { nodes, edges, width: laidOut.width ?? 0, height: laidOut.height ?? 0 };
}

// The external source cards of the diagram. They sit outside the
// layout of the steps: withSources adds them to a finished layout, so
// layoutProcess keeps its output.
export const SOURCE_SIZE = { width: 150, height: 36 };

export type SourceFlowNode = Node<{ source: SourceRow }, "source">;

type Layout = Awaited<ReturnType<typeof layoutProcess>>;

// The source cards and their dotted links. Each source that a task
// lists gets one card, in one row centered above the first task that
// lists it, and one link to each task that lists it. The input stays
// unchanged.
// shortcut: a source that a later task also lists keeps its card
// above the first task, and its link can cross other shapes; upgrade
// when a process shares one source between two tasks.
export function withSources(
  def: ProcessDefinition,
  layout: Layout,
): Layout & { sources: { nodes: SourceFlowNode[]; edges: FlowEdge[] } } {
  const byId = new Map(def.sources.map((s) => [s.id, s]));
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const placed = new Set<string>();
  const cards: SourceFlowNode[] = [];
  const links: FlowEdge[] = [];
  const { width: W, height: H } = SOURCE_SIZE;
  for (const node of def.nodes) {
    if (node.type !== "task") {
      continue;
    }
    const task = layout.nodes.find((n) => n.id === node.id)!;
    const tx = task.position.x;
    const ty = task.position.y;
    const tw = task.width ?? 0;
    // A missing source, a source id that collides with a node id, and
    // a repeat in the same list are skipped.
    const linked = [...new Set(node.source_ids)]
      .map((id) => byId.get(id))
      .filter((s): s is SourceRow => s !== undefined && !nodeIds.has(`source:${s.id}`));
    const row = linked.filter((s) => !placed.has(s.id));
    const rowW = row.length * W + (row.length - 1) * 12;
    row.forEach((source, i) => {
      placed.add(source.id);
      cards.push({
        id: `source:${source.id}`,
        type: "source",
        position: { x: tx + tw / 2 - rowW / 2 + i * (W + 12), y: ty - 40 - H },
        width: W,
        height: H,
        draggable: false,
        selectable: false,
        focusable: false,
        ariaLabel: `${source.name}, external source`,
        data: { source },
      });
    });
    linked.forEach((source, k) => {
      const card = cards.find((c) => c.id === `source:${source.id}`)!;
      const cx = card.position.x + W / 2;
      const cy = card.position.y + H;
      const xk = tx + (tw * (k + 1)) / (linked.length + 1);
      const points =
        cx >= tx && cx <= tx + tw
          ? [{ x: cx, y: cy }, { x: cx, y: ty }]
          : [{ x: cx, y: cy }, { x: cx, y: ty - 20 }, { x: xk, y: ty - 20 }, { x: xk, y: ty }];
      links.push({
        id: `source-link:${node.id}:${source.id}`,
        source: `source:${source.id}`,
        target: node.id,
        type: "elk",
        data: { points, pill: null, anchor: null },
      });
    });
  }
  if (cards.length === 0) {
    return { ...layout, sources: { nodes: [], edges: [] } };
  }
  const dy = Math.max(0, 8 - Math.min(...cards.map((c) => c.position.y)));
  const down = (p: DiagramPoint) => ({ x: p.x, y: p.y + dy });
  const moveNode = <T extends Node>(n: T): T => ({ ...n, position: down(n.position) });
  const moveEdge = (e: FlowEdge): FlowEdge => ({
    ...e,
    data: {
      ...e.data!,
      points: e.data!.points.map(down),
      anchor: e.data!.anchor ? down(e.data!.anchor) : e.data!.anchor,
    },
  });
  return {
    nodes: layout.nodes.map(moveNode),
    edges: layout.edges.map(moveEdge),
    width: Math.max(layout.width, ...cards.map((c) => c.position.x + W + 8)),
    height: layout.height + dy,
    sources: { nodes: cards.map(moveNode), edges: links.map(moveEdge) },
  };
}
