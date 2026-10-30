// The rows for changedIds: the ids the diagram draws as proposed
// after an assistant chat answer. Pure functions, node environment.

import { describe, expect, test } from "vitest";
import { changedIds } from "./diff";
import type { ProcessDefinition } from "./types";

// The mini definition fixture of the approved 2.2 brief, with all
// fields. Local copy: every test file keeps its fixtures local.
const miniDefinition: ProcessDefinition = {
  schema_version: "1",
  name: "Mini loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
  roles: [{ id: "advisor", name: "Advisor", department: "Branch" }],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
  ],
  scope: [{ field: "amount", role: "advisor", access: "write" }],
  nodes: [
    {
      id: "start", type: "start", name: "Application received", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "entry", type: "task", name: "Application entry", role: "advisor",
      deadline_hours: 24, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "released", type: "end", name: "Loan released", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "approved", scope_overrides: [],
      source_ids: [], citations: [],
    },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
    { id: "e2", from: "entry", to: "released", label: null, decision: null, condition: null, is_default: false },
  ],
  sources: [],
};

function variant(change: (def: ProcessDefinition) => void): ProcessDefinition {
  const def: ProcessDefinition = JSON.parse(JSON.stringify(miniDefinition));
  change(def);
  return def;
}

describe("changedIds", () => {
  test("one new node and one renamed node: both ids in nodes", () => {
    const next = variant((def) => {
      def.nodes.find((n) => n.id === "entry")!.name = "Application intake";
      def.nodes.push({
        id: "expert", type: "task", name: "Expert review", role: "advisor",
        deadline_hours: 72, documents: [], signature: false, checks: [],
        decisions: [], end_result: null, scope_overrides: [], source_ids: [],
        citations: [],
      });
    });
    const ids = changedIds(miniDefinition, next);
    expect(ids.nodes.has("expert")).toBe(true);
    expect(ids.nodes.has("entry")).toBe(true);
  });

  test("an equal definition: both sets empty", () => {
    const next = variant(() => {});
    const ids = changedIds(miniDefinition, next);
    expect(ids.nodes.size).toBe(0);
    expect(ids.edges.size).toBe(0);
  });

  test("one edge with a new condition: the edge id in edges", () => {
    const next = variant((def) => {
      def.edges.find((e) => e.id === "e2")!.condition = "amount > 10.0";
    });
    const ids = changedIds(miniDefinition, next);
    expect(ids.edges.has("e2")).toBe(true);
    expect(ids.nodes.size).toBe(0);
  });
});
