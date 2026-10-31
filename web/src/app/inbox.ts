// Pure model of the inbox: the filter tabs, the search and the
// origin of a case in its step.

import type { CaseEvent } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";

export type InboxTab = "all" | "mine" | "free" | "late";

export const TABS: { tab: InboxTab; text: string }[] = [
  { tab: "all", text: "All" },
  { tab: "mine", text: "Mine" },
  { tab: "free", text: "Not taken" },
  { tab: "late", text: "Late" },
];

// client and assignee are null while the case query is pending;
// client is also null when the case has no client name.
export interface InboxItem {
  id: string;
  reference: string;
  client: string | null;
  assignee: string | null;
  msLeft: number | null;
}

export function inTab(item: InboxItem, tab: InboxTab, userId: string): boolean {
  switch (tab) {
    case "all":
      return true;
    case "mine":
      return item.assignee === userId;
    case "free":
      return item.assignee === "";
    case "late":
      return item.msLeft !== null && item.msLeft < 0;
  }
}

export function matchesSearch(item: InboxItem, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (q === "") return true;
  return item.reference.toLowerCase().includes(q) || (item.client?.toLowerCase().includes(q) ?? false);
}

// tabCounts ignores the search.
export function tabCounts(items: InboxItem[], userId: string): Record<InboxTab, number> {
  const counts = { all: 0, mine: 0, free: 0, late: 0 };
  for (const item of items) {
    for (const { tab } of TABS) {
      if (inTab(item, tab, userId)) counts[tab]++;
    }
  }
  return counts;
}

// originOf tells if the case is new in the node or came back to it,
// and from which task.
export function originOf(def: ProcessDefinition, events: CaseEvent[], nodeId: string): string | null {
  const ids = events.filter((e) => e.type === "step_entered").map((e) => e.payload.node_id);
  const last = ids.lastIndexOf(nodeId);
  if (last === -1) return null;
  if (ids.indexOf(nodeId) === last) return "New";
  for (let i = last - 1; i >= 0; i--) {
    const node = def.nodes.find((n) => n.id === ids[i]);
    if (node !== undefined && node.type === "task" && node.id !== nodeId) return `Returned from ${node.name}`;
  }
  return "Returned";
}
