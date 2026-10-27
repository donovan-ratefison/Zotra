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
    return {
      id: elkEdge.id,
      source: edge.from,
      target: edge.to,
      type: "elk",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a", width: 8, height: 8 },
      data: { points, pill: edgePillText(edge) },
    };
  });
  return { nodes, edges, width: laidOut.width ?? 0, height: laidOut.height ?? 0 };
}
