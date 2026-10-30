// Manual structure edits of a draft: pure functions that return a
// new definition, and the toolbar of the diagram. The shell saves
// each result at once, so the undo of the top bar reverts it.

import { CircleDot, Diamond, Square } from "lucide-react";
import { Button } from "@/ui/button";
import type { EndResult, ProcessDefinition, ProcessEdge } from "./types";

export type AddType = "task" | "gateway" | "end";

const NEW_NAME: Record<AddType, string> = {
  task: "New task",
  gateway: "New gateway",
  end: "New end",
};

// newNodeId returns "<type>_<n>" with the smallest n >= 1 that no
// node id holds.
export function newNodeId(def: ProcessDefinition, type: AddType): string {
  const ids = new Set(def.nodes.map((n) => n.id));
  let n = 1;
  while (ids.has(`${type}_${n}`)) n++;
  return `${type}_${n}`;
}

// newEdgeId returns "e<n>" with the smallest n >= 1 that no edge id
// holds as "e<n>" or "e0<n>" (the seed uses e01 to e14).
export function newEdgeId(def: ProcessDefinition): string {
  const ids = new Set(def.edges.map((e) => e.id));
  let n = 1;
  while (ids.has(`e${n}`) || ids.has(`e0${n}`)) n++;
  return `e${n}`;
}

export function addNode(
  def: ProcessDefinition,
  type: AddType,
): { def: ProcessDefinition; id: string } {
  const id = newNodeId(def, type);
  const node = {
    id,
    type,
    name: NEW_NAME[type],
    role: null,
    deadline_hours: null,
    documents: [],
    signature: false,
    checks: [],
    decisions: [],
    end_result: type === "end" ? ("approved" as const) : null,
    scope_overrides: [],
    source_ids: [],
    citations: [],
  };
  return { def: { ...def, nodes: [...def.nodes, node] }, id };
}

// connect appends one edge from -> to, or returns null when the link
// is refused: a loop on one node, an unknown id (source cards
// included), a link out of an end, a link into the start, or a
// duplicate.
export function connect(
  def: ProcessDefinition,
  from: string,
  to: string,
): ProcessDefinition | null {
  const source = def.nodes.find((n) => n.id === from);
  const target = def.nodes.find((n) => n.id === to);
  if (
    from === to ||
    source === undefined ||
    target === undefined ||
    source.type === "end" ||
    target.type === "start" ||
    def.edges.some((e) => e.from === from && e.to === to)
  ) {
    return null;
  }
  const outgoing = def.edges.filter((e) => e.from === from);
  const decision =
    source.type === "task"
      ? source.decisions.find((d) => !outgoing.some((e) => e.decision === d)) ?? null
      : null;
  const isDefault =
    source.type === "gateway" && !outgoing.some((e) => e.is_default);
  const edge = {
    id: newEdgeId(def),
    from,
    to,
    label: null,
    decision,
    condition: null,
    is_default: isDefault,
  };
  return { ...def, edges: [...def.edges, edge] };
}

export function removeEdge(def: ProcessDefinition, edgeId: string): ProcessDefinition {
  return { ...def, edges: def.edges.filter((e) => e.id !== edgeId) };
}

// removeNode drops the node and each edge that touches it. The start
// node and an unknown id give null.
export function removeNode(
  def: ProcessDefinition,
  nodeId: string,
): ProcessDefinition | null {
  const node = def.nodes.find((n) => n.id === nodeId);
  if (node === undefined || node.type === "start") {
    return null;
  }
  return {
    ...def,
    nodes: def.nodes.filter((n) => n.id !== nodeId),
    edges: def.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
  };
}

// The link and end details. Each function returns a new definition;
// an unknown id, or a node of the wrong type, gives an equal copy.

// mapEdge applies f to the edge edgeId only.
function mapEdge(
  def: ProcessDefinition,
  edgeId: string,
  f: (e: ProcessEdge) => ProcessEdge,
): ProcessDefinition {
  return { ...def, edges: def.edges.map((e) => (e.id === edgeId ? f(e) : e)) };
}

// setDefaultLink makes edgeId the one default link of its gateway.
// A default link has no condition.
export function setDefaultLink(def: ProcessDefinition, edgeId: string): ProcessDefinition {
  const edge = def.edges.find((e) => e.id === edgeId);
  const from = def.nodes.find((n) => n.id === edge?.from);
  if (edge === undefined || from?.type !== "gateway") {
    return { ...def };
  }
  return {
    ...def,
    edges: def.edges.map((e) => {
      if (e.id === edgeId) return { ...e, is_default: true, condition: null };
      if (e.from === edge.from) return { ...e, is_default: false };
      return e;
    }),
  };
}

export function setLinkCondition(
  def: ProcessDefinition,
  edgeId: string,
  text: string,
): ProcessDefinition {
  const condition = text.trim();
  return mapEdge(def, edgeId, (e) => ({ ...e, condition: condition === "" ? null : condition }));
}

export function setLinkDecision(
  def: ProcessDefinition,
  edgeId: string,
  decision: string | null,
): ProcessDefinition {
  return mapEdge(def, edgeId, (e) => ({ ...e, decision }));
}

export function setEndResult(
  def: ProcessDefinition,
  nodeId: string,
  result: EndResult,
): ProcessDefinition {
  return {
    ...def,
    nodes: def.nodes.map((n) =>
      n.id === nodeId && n.type === "end" ? { ...n, end_result: result } : n,
    ),
  };
}

const BUTTONS: { type: AddType; label: string; Icon: typeof Square }[] = [
  { type: "task", label: "Task", Icon: Square },
  { type: "gateway", label: "Gateway", Icon: Diamond },
  { type: "end", label: "End", Icon: CircleDot },
];

export function EditToolbar({ onAdd }: { onAdd: (type: AddType) => void }) {
  return (
    <div
      role="toolbar"
      aria-label="Edit the diagram"
      className="flex h-9 items-center gap-0.5 rounded-[10px] border border-[#e4e4e7] bg-white p-1 shadow-sm"
    >
      <span className="px-1.5 text-[11.5px] font-medium text-muted-foreground">Add</span>
      {BUTTONS.map(({ type, label, Icon }) => (
        <Button
          key={type}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12.5px]"
          onClick={() => onAdd(type)}
        >
          <Icon aria-hidden="true" />
          {label}
        </Button>
      ))}
    </div>
  );
}
