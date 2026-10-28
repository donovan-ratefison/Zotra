// The deterministic diff of two process definitions: the counts, the
// rows and the chips of the proposal bar. Pure functions, no React.

import type {
  Check,
  NodeType,
  ProcessDefinition,
  ProcessEdge,
  ProcessNode,
} from "./types";

export interface DiffCounts {
  addedNodes: number;
  removedNodes: number;
  modifiedNodes: number;
  addedEdges: number;
  removedEdges: number;
  modifiedEdges: number;
  addedRoles: number;
  removedRoles: number;
  addedFields: number;
  removedFields: number;
  addedChecks: number;
}

export interface DiffRow {
  kind: "add" | "remove" | "modify";
  text: string;
}

const TYPE_TEXT: Record<NodeType, string> = {
  start: "Start",
  task: "Task",
  gateway: "Gateway",
  end: "End",
};

// A common check differs when one of its fields differs.
function checkChanged(base: Check, next: Check): boolean {
  return (
    base.expression !== next.expression ||
    base.message !== next.message ||
    base.plain_text !== next.plain_text ||
    base.citations.join("\n") !== next.citations.join("\n")
  );
}

// A common node differs when one of its fields differs, when the set
// of check ids differs, or when a common check differs. source_ids is
// not compared: no writer produces one before the sources lot.
function nodeChanged(base: ProcessNode, next: ProcessNode): boolean {
  if (
    base.name !== next.name ||
    base.type !== next.type ||
    base.role !== next.role ||
    base.deadline_hours !== next.deadline_hours ||
    base.signature !== next.signature ||
    base.documents.join("\n") !== next.documents.join("\n") ||
    base.decisions.join("\n") !== next.decisions.join("\n") ||
    base.end_result !== next.end_result ||
    base.citations.join("\n") !== next.citations.join("\n") ||
    JSON.stringify(base.scope_overrides) !==
      JSON.stringify(next.scope_overrides)
  ) {
    return true;
  }
  const baseIds = new Set(base.checks.map((c) => c.id));
  const nextIds = new Set(next.checks.map((c) => c.id));
  if (baseIds.size !== nextIds.size) {
    return true;
  }
  for (const id of baseIds) {
    if (!nextIds.has(id)) {
      return true;
    }
  }
  return base.checks.some((baseCheck) => {
    const nextCheck = next.checks.find((c) => c.id === baseCheck.id);
    return nextCheck !== undefined && checkChanged(baseCheck, nextCheck);
  });
}

// A common edge differs when one of its fields differs.
function edgeChanged(base: ProcessEdge, next: ProcessEdge): boolean {
  return (
    base.from !== next.from ||
    base.to !== next.to ||
    base.label !== next.label ||
    base.decision !== next.decision ||
    base.condition !== next.condition ||
    base.is_default !== next.is_default
  );
}

export function diffDefinitions(
  base: ProcessDefinition,
  next: ProcessDefinition,
): { counts: DiffCounts; rows: DiffRow[] } {
  const counts: DiffCounts = {
    addedNodes: 0,
    removedNodes: 0,
    modifiedNodes: 0,
    addedEdges: 0,
    removedEdges: 0,
    modifiedEdges: 0,
    addedRoles: 0,
    removedRoles: 0,
    addedFields: 0,
    removedFields: 0,
    addedChecks: 0,
  };
  const rows: DiffRow[] = [];

  const baseRoleIds = new Set(base.roles.map((r) => r.id));
  const nextRoleIds = new Set(next.roles.map((r) => r.id));
  const baseFieldNames = new Set(base.fields.map((f) => f.name));
  const nextFieldNames = new Set(next.fields.map((f) => f.name));
  const baseNodeIds = new Set(base.nodes.map((n) => n.id));
  const nextNodeIds = new Set(next.nodes.map((n) => n.id));
  const baseEdgeIds = new Set(base.edges.map((e) => e.id));
  const nextEdgeIds = new Set(next.edges.map((e) => e.id));
  const baseCheckIds = new Set(
    base.nodes.flatMap((n) => n.checks.map((c) => c.id)),
  );
  const baseNodeById = new Map(base.nodes.map((n) => [n.id, n]));
  const nextNodeById = new Map(next.nodes.map((n) => [n.id, n]));
  // The base name of an endpoint when the node exists in base, else
  // its next name.
  const nameOf = (id: string): string =>
    baseNodeById.get(id)?.name ?? nextNodeById.get(id)?.name ?? id;

  for (const role of next.roles) {
    if (!baseRoleIds.has(role.id)) {
      counts.addedRoles++;
      rows.push({ kind: "add", text: `Role ${role.name}` });
    }
  }
  for (const role of base.roles) {
    if (!nextRoleIds.has(role.id)) {
      counts.removedRoles++;
      rows.push({ kind: "remove", text: `Removed role ${role.name}` });
    }
  }
  for (const field of next.fields) {
    if (!baseFieldNames.has(field.name)) {
      counts.addedFields++;
      rows.push({ kind: "add", text: `Field ${field.label}` });
    }
  }
  for (const field of base.fields) {
    if (!nextFieldNames.has(field.name)) {
      counts.removedFields++;
      rows.push({ kind: "remove", text: `Removed field ${field.label}` });
    }
  }
  for (const node of next.nodes) {
    for (const check of node.checks) {
      if (!baseCheckIds.has(check.id)) {
        counts.addedChecks++;
        rows.push({ kind: "add", text: `Check ${check.id} on ${node.name}` });
      }
    }
  }
  for (const node of next.nodes) {
    if (!baseNodeIds.has(node.id)) {
      counts.addedNodes++;
      rows.push({ kind: "add", text: `${TYPE_TEXT[node.type]} ${node.name}` });
    }
  }
  for (const node of base.nodes) {
    if (!nextNodeIds.has(node.id)) {
      counts.removedNodes++;
      rows.push({
        kind: "remove",
        text: `${TYPE_TEXT[node.type]} ${node.name}`,
      });
    }
  }
  for (const node of base.nodes) {
    const nextNode = nextNodeById.get(node.id);
    if (nextNode !== undefined && nodeChanged(node, nextNode)) {
      counts.modifiedNodes++;
      rows.push({
        kind: "modify",
        text: `${TYPE_TEXT[node.type]} ${node.name} modified`,
      });
    }
  }
  for (const edge of next.edges) {
    if (!baseEdgeIds.has(edge.id)) {
      counts.addedEdges++;
      rows.push({
        kind: "add",
        text: `Link ${nameOf(edge.from)} to ${nameOf(edge.to)}`,
      });
    }
  }
  for (const edge of base.edges) {
    if (!nextEdgeIds.has(edge.id)) {
      counts.removedEdges++;
      rows.push({
        kind: "remove",
        text: `Link ${nameOf(edge.from)} to ${nameOf(edge.to)}`,
      });
    }
  }
  for (const edge of base.edges) {
    const nextEdge = next.edges.find((e) => e.id === edge.id);
    if (nextEdge !== undefined && edgeChanged(edge, nextEdge)) {
      counts.modifiedEdges++;
      rows.push({
        kind: "modify",
        text: `Modified link ${nameOf(nextEdge.from)} to ${nameOf(nextEdge.to)}`,
      });
    }
  }

  return { counts, rows };
}

// One chip per non-zero count, in this order. All zero: the single
// chip No change.
export function diffChips(c: DiffCounts): string[] {
  const plural = (n: number, noun: string) => (n > 1 ? `${noun}s` : noun);
  const chips: string[] = [];
  if (c.addedNodes > 0) {
    chips.push(`+${c.addedNodes} ${plural(c.addedNodes, "step")}`);
  }
  if (c.removedNodes > 0) {
    chips.push(`-${c.removedNodes} ${plural(c.removedNodes, "step")}`);
  }
  if (c.modifiedNodes > 0) {
    chips.push(`${c.modifiedNodes} modified ${plural(c.modifiedNodes, "step")}`);
  }
  if (c.addedEdges > 0) {
    chips.push(`+${c.addedEdges} ${plural(c.addedEdges, "link")}`);
  }
  if (c.removedEdges > 0) {
    chips.push(`-${c.removedEdges} ${plural(c.removedEdges, "link")}`);
  }
  if (c.modifiedEdges > 0) {
    chips.push(`${c.modifiedEdges} modified ${plural(c.modifiedEdges, "link")}`);
  }
  if (c.addedRoles > 0) {
    chips.push(`+${c.addedRoles} ${plural(c.addedRoles, "role")}`);
  }
  if (c.addedFields > 0) {
    chips.push(`+${c.addedFields} ${plural(c.addedFields, "field")}`);
  }
  if (c.addedChecks > 0) {
    chips.push(`+${c.addedChecks} ${plural(c.addedChecks, "check")}`);
  }
  return chips.length === 0 ? ["No change"] : chips;
}
