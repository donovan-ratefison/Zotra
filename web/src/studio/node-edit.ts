// Pure edit functions on a process definition. Each one returns a
// new definition and leaves the input unchanged. Each one throws on
// an unknown id: the panel never edits a node that the definition
// does not hold.

import { ApiError } from "./api";
import type {
  ProcessDefinition,
  ProcessNode,
  ScopeAccess,
} from "./types";

function requireNode(def: ProcessDefinition, nodeId: string): ProcessNode {
  const node = def.nodes.find((n) => n.id === nodeId);
  if (!node) {
    throw new Error(`unknown node id: ${nodeId}`);
  }
  return node;
}

function requireCheck(node: ProcessNode, checkId: string): void {
  if (!node.checks.some((c) => c.id === checkId)) {
    throw new Error(`unknown check id: ${checkId} on node ${node.id}`);
  }
}

// Builds the new definition with one node replaced. The other nodes
// keep their identity, so only the edited node re-renders.
function withNodes(
  def: ProcessDefinition,
  nodeId: string,
  map: (node: ProcessNode) => ProcessNode,
): ProcessDefinition {
  requireNode(def, nodeId);
  return {
    ...def,
    nodes: def.nodes.map((n) => (n.id === nodeId ? map(n) : n)),
  };
}

export function withNodeName(
  def: ProcessDefinition,
  nodeId: string,
  name: string,
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => ({ ...n, name }));
}

export function withNodeRole(
  def: ProcessDefinition,
  nodeId: string,
  roleId: string | null,
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => ({ ...n, role: roleId }));
}

export function withNodeDeadline(
  def: ProcessDefinition,
  nodeId: string,
  hours: number | null,
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => ({ ...n, deadline_hours: hours }));
}

export function withNodeDocuments(
  def: ProcessDefinition,
  nodeId: string,
  documents: string[],
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => ({ ...n, documents }));
}

export function withNodeSignature(
  def: ProcessDefinition,
  nodeId: string,
  signature: boolean,
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => ({ ...n, signature }));
}

export function withCheckExpression(
  def: ProcessDefinition,
  nodeId: string,
  checkId: string,
  expression: string,
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => {
    requireCheck(n, checkId);
    return {
      ...n,
      checks: n.checks.map((c) =>
        c.id === checkId ? { ...c, expression } : c,
      ),
    };
  });
}

export function withCheckMessage(
  def: ProcessDefinition,
  nodeId: string,
  checkId: string,
  message: string,
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => {
    requireCheck(n, checkId);
    return {
      ...n,
      checks: n.checks.map((c) => (c.id === checkId ? { ...c, message } : c)),
    };
  });
}

// "c<N>", N the smallest positive integer that no check id of the
// definition uses.
export function newCheckId(def: ProcessDefinition): string {
  const used = new Set<number>();
  for (const node of def.nodes) {
    for (const check of node.checks) {
      if (check.id.startsWith("c")) {
        const n = Number(check.id.slice(1));
        if (Number.isInteger(n) && n > 0) {
          used.add(n);
        }
      }
    }
  }
  let n = 1;
  while (used.has(n)) {
    n += 1;
  }
  return `c${n}`;
}

export function addCheck(
  def: ProcessDefinition,
  nodeId: string,
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => ({
    ...n,
    checks: [
      ...n.checks,
      {
        id: newCheckId(def),
        expression: "true",
        message: "",
        plain_text: null,
        citations: [],
      },
    ],
  }));
}

export function removeCheck(
  def: ProcessDefinition,
  nodeId: string,
  checkId: string,
): ProcessDefinition {
  return withNodes(def, nodeId, (n) => {
    requireCheck(n, checkId);
    return { ...n, checks: n.checks.filter((c) => c.id !== checkId) };
  });
}

// Sets the access of one field and role on one node. The value that
// equals the process value removes the override, so the stored rows
// are always real deviations.
export function setScopeOverride(
  def: ProcessDefinition,
  nodeId: string,
  field: string,
  role: string,
  access: ScopeAccess,
): ProcessDefinition {
  const row = def.scope.find(
    (r) => r.field === field && r.role === role,
  );
  if (!row) {
    throw new Error(`unknown scope row: ${field}, ${role}`);
  }
  return withNodes(def, nodeId, (n) => {
    const rest = n.scope_overrides.filter(
      (r) => !(r.field === field && r.role === role),
    );
    if (access === row.access) {
      return { ...n, scope_overrides: rest };
    }
    return { ...n, scope_overrides: [...rest, { field, role, access }] };
  });
}

export function saveErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "conflict") {
      return "This version is not a draft anymore.";
    }
    return err.message;
  }
  return "The draft did not save.";
}
