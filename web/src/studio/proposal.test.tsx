// The 21 test rows of the proposal review brief: the deterministic
// diff, the review bar, the citation chips, the ghost flags, the
// highlight helper, the panel loader and the dialog handoff. The
// environment is node: renderToString for the components, no jsdom.

import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { diffChips, diffDefinitions, type DiffCounts } from "./diff";
import { ProposalBar } from "./ProposalBar";
import { isHighlighted, PolicyPanel } from "./PolicyPanel";
import { ElkEdge, EventShape, GatewayNode, TaskCard } from "./diagram";
import { roleColor } from "./layout";
import { ImportDialogBody } from "./ImportDialog";
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
      deadline_hours: 24, documents: ["ID"], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "review", type: "task", name: "Review", role: "ghost",
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "complete", type: "gateway", name: "File complete?", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "released", type: "end", name: "Loan released", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "approved", scope_overrides: [],
      source_ids: [], citations: [],
    },
    {
      id: "refused", type: "end", name: "Loan refused", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "refused", scope_overrides: [],
      source_ids: [], citations: [],
    },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
    { id: "e2", from: "entry", to: "review", label: null, decision: null, condition: null, is_default: false },
    { id: "e3", from: "review", to: "complete", label: null, decision: null, condition: null, is_default: false },
    { id: "e4", from: "complete", to: "released", label: null, decision: null, condition: "size(documents) >= 4", is_default: false },
    { id: "e5", from: "complete", to: "refused", label: null, decision: null, condition: "amount < 0.0", is_default: false },
    { id: "e6", from: "complete", to: "entry", label: "Send back", decision: null, condition: null, is_default: true },
  ],
  sources: [],
};

// The proposal fixture: miniDefinition with the changes of the plan.
// The e4 condition keeps its reference to the documents field, which
// changedNoDocuments then drops: the diff is pure client code and
// never reaches the server validator, and e4 is identical on both
// sides of the rows that use the variant.
function changedDefinition(): ProcessDefinition {
  const def: ProcessDefinition = JSON.parse(JSON.stringify(miniDefinition));
  def.roles = [
    ...def.roles,
    { id: "analyst", name: "Analyst", department: "Risk" },
  ];
  def.fields = [
    ...def.fields,
    { name: "documents", label: "Documents", type: "document", options: [], computed: null },
  ];
  def.scope = [
    { field: "amount", role: "advisor", access: "write" },
    { field: "amount", role: "analyst", access: "read" },
    { field: "documents", role: "advisor", access: "write" },
    { field: "documents", role: "analyst", access: "read" },
  ];
  def.nodes = def.nodes
    .filter((n) => n.id !== "refused")
    .map((n) => {
      if (n.id === "entry") {
        return {
          ...n,
          name: "Application intake",
          deadline_hours: 48,
          documents: ["ID", "Payslip"],
          checks: [
            { id: "c1", expression: "amount > 10.0", message: "", plain_text: null, citations: [] },
          ],
        };
      }
      return n;
    });
  // extra inserts after review: start, entry, review, extra,
  // complete, released.
  def.nodes.splice(3, 0, {
    id: "extra", type: "task", name: "Extra step", role: "analyst",
    deadline_hours: null, documents: [], signature: false,
    checks: [
      { id: "c2", expression: "amount > 0.0", message: "", plain_text: null, citations: [] },
    ],
    decisions: [], end_result: null, scope_overrides: [], source_ids: [],
    citations: [],
  });
  def.edges = def.edges
    .filter((e) => e.id !== "e5")
    .map((e) => {
      if (e.id === "e3") {
        return { ...e, to: "extra" };
      }
      if (e.id === "e6") {
        return { ...e, label: "Back" };
      }
      return e;
    });
  def.edges.push({
    id: "e8", from: "extra", to: "complete", label: null, decision: null,
    condition: null, is_default: false,
  });
  return def;
}

const changed = changedDefinition();

function changedNoDocuments(): ProcessDefinition {
  const def = changedDefinition();
  def.fields = def.fields.filter((f) => f.name !== "documents");
  def.scope = def.scope.filter((row) => row.field !== "documents");
  return def;
}

function changedNoAnalyst(): ProcessDefinition {
  const def = changedDefinition();
  def.roles = def.roles.filter((r) => r.id !== "analyst");
  def.scope = def.scope.filter((row) => row.role !== "analyst");
  def.nodes = def.nodes.filter((n) => n.id !== "extra");
  def.edges = def.edges.filter((e) => e.id !== "e8");
  const e3 = def.edges.find((e) => e.id === "e3")!;
  e3.to = "complete";
  return def;
}

function zeroCounts(): DiffCounts {
  return {
    addedNodes: 0, removedNodes: 0, modifiedNodes: 0,
    addedEdges: 0, removedEdges: 0, modifiedEdges: 0,
    addedRoles: 0, removedRoles: 0,
    addedFields: 0, removedFields: 0, addedChecks: 0,
  };
}

describe("diff", () => {
  const diff = diffDefinitions(miniDefinition, changed);

  test("1: diffChips lists the nine chips of the proposal diff", () => {
    expect(diffChips(diff.counts)).toEqual([
      "+1 step",
      "-1 step",
      "1 modified step",
      "+1 link",
      "-1 link",
      "2 modified links",
      "+1 role",
      "+1 field",
      "+2 checks",
    ]);
  });

  test("2: the counts of the proposal diff", () => {
    expect(diff.counts).toEqual({
      addedNodes: 1,
      removedNodes: 1,
      modifiedNodes: 1,
      addedEdges: 1,
      removedEdges: 1,
      modifiedEdges: 2,
      addedRoles: 1,
      removedRoles: 0,
      addedFields: 1,
      removedFields: 0,
      addedChecks: 2,
    });
  });

  test("3: the rows follow the group order of the plan", () => {
    expect(diff.rows).toEqual([
      { kind: "add", text: "Role Analyst" },
      { kind: "add", text: "Field Documents" },
      { kind: "add", text: "Check c1 on Application intake" },
      { kind: "add", text: "Check c2 on Extra step" },
      { kind: "add", text: "Task Extra step" },
      { kind: "remove", text: "End Loan refused" },
      { kind: "modify", text: "Task Application entry modified" },
      { kind: "add", text: "Link Extra step to File complete?" },
      { kind: "remove", text: "Link File complete? to Loan refused" },
      { kind: "modify", text: "Modified link Review to Extra step" },
      { kind: "modify", text: "Modified link File complete? to Application entry" },
    ]);
  });

  test("4: an identical diff gives zero counts and no rows", () => {
    const same = diffDefinitions(miniDefinition, miniDefinition);
    expect(same.counts).toEqual(zeroCounts());
    expect(same.rows).toEqual([]);
    expect(diffChips(same.counts)).toEqual(["No change"]);
  });

  test("5: a removed field produces a row", () => {
    const d = diffDefinitions(changed, changedNoDocuments());
    expect(d.rows.map((r) => r.text)).toContain("Removed field Documents");
  });

  test("6: a removed role produces a row", () => {
    const d = diffDefinitions(changed, changedNoAnalyst());
    expect(d.rows.map((r) => r.text)).toContain("Removed role Analyst");
  });
});

describe("proposal bar", () => {
  test("7: the fresh bar holds the sentence, the chips and the buttons", () => {
    const html = renderToString(
      createElement(ProposalBar, {
        diff: diffDefinitions(miniDefinition, changed),
        busy: false,
        onAccept: () => {},
        onReject: () => {},
      }),
    );
    expect(html).toContain("The AI proposed a process from the policy.");
    expect(html).toContain("+1 step");
    expect(html).toContain("Reject");
    expect(html).toContain("Accept");
    expect(html).toContain("See the changes");
  });

  test("8: busy disables both buttons and Accept shows Accepting...", () => {
    const html = renderToString(
      createElement(ProposalBar, {
        diff: { counts: zeroCounts(), rows: [] },
        busy: true,
        onAccept: () => {},
        onReject: () => {},
      }),
    );
    expect(html).toContain("Accepting...");
    // The attribute form only: the class string also carries the
    // word in disabled:* variants.
    expect(html.match(/disabled="/g)).toHaveLength(2);
  });

  test("9: an empty diff shows the No change line", () => {
    const html = renderToString(
      createElement(ProposalBar, {
        diff: { counts: zeroCounts(), rows: [] },
        busy: false,
        onAccept: () => {},
        onReject: () => {},
      }),
    );
    expect(html).toContain("No change");
  });
});

describe("citation chips", () => {
  test("10: the task card renders one chip per citation", () => {
    const entry = changed.nodes.find((n) => n.id === "entry")!;
    const withCitations = { ...entry, citations: ["p2-3", "p4-1"] };
    const html = renderToString(
      createElement(TaskCard, {
        node: withCitations,
        color: roleColor(changed, "advisor"),
        roleName: "Advisor",
        selected: false,
        ghost: false,
      }),
    );
    expect(html).toContain(`aria-label="Show p2-3 in the policy"`);
    expect(html).toContain(`aria-label="Show p4-1 in the policy"`);
  });

  test("11: six citations give four chips and the +2 span", () => {
    const entry = changed.nodes.find((n) => n.id === "entry")!;
    const six = {
      ...entry,
      citations: ["p1-1", "p1-2", "p2-1", "p2-2", "p3-1", "p3-2"],
    };
    const html = renderToString(
      createElement(TaskCard, {
        node: six,
        color: null,
        roleName: null,
        selected: false,
        ghost: false,
      }),
    );
    expect(html).toContain("+2");
    expect(html.match(/aria-label="Show/g)).toHaveLength(4);
  });

  test("12: a ghost task card paints the proposed style without a badge", () => {
    const entry = changed.nodes.find((n) => n.id === "entry")!;
    const html = renderToString(
      createElement(TaskCard, {
        node: entry,
        color: null,
        roleName: null,
        selected: false,
        ghost: true,
      }),
    );
    expect(html).toContain(`data-ghost="true"`);
    // Full opacity and normal text colors: no ghost fade.
    expect(html).not.toContain("opacity-70");
    // The violet dashed rect is the only outline, 1.5 px like the
    // proposed style.
    expect(html).toContain('stroke="#7c3aed"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('stroke-dasharray="5 4"');
    // No badge on a ghost element: the badge marks chat proposals.
    expect(html).not.toContain("Proposed");
  });

  test("13: a ghost gateway carries data-ghost and no badge", () => {
    const gateway = changed.nodes.find((n) => n.id === "complete")!;
    const html = renderToString(
      createElement(GatewayNode, {
        node: gateway,
        selected: false,
        ghost: true,
      }),
    );
    expect(html).toContain(`data-ghost="true"`);
    expect(html).not.toContain("opacity-70");
    expect(html).toContain('stroke="#7c3aed"');
    expect(html).not.toContain("Proposed");
  });

  test("14: an end shape renders its chip and the ghost flag", () => {
    const released = changed.nodes.find((n) => n.id === "released")!;
    const withCitation = { ...released, citations: ["p1-1"] };
    const html = renderToString(
      createElement(EventShape, {
        node: withCitation,
        selected: false,
        ghost: false,
      }),
    );
    expect(html).toContain("p1-1");
    expect(html).toContain(`data-ghost="false"`);
  });

  test("15: a ghost edge paints the violet dashed inline style", () => {
    const html = renderToString(
      createElement(ElkEdge, {
        data: { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }], pill: null, ghost: true },
      } as unknown as ComponentProps<typeof ElkEdge>),
    );
    // The inline style wins over the React Flow stylesheet, which
    // beats every SVG attribute.
    expect(html).toContain("stroke:#7c3aed");
    expect(html).toContain("stroke-dasharray:5 4");
  });

  test("16: a node without citations renders no chip", () => {
    const review = changed.nodes.find((n) => n.id === "review")!;
    const html = renderToString(
      createElement(TaskCard, {
        node: review,
        color: null,
        roleName: null,
        selected: false,
        ghost: false,
      }),
    );
    expect(html).not.toContain(`aria-label="Show`);
  });
});

describe("isHighlighted", () => {
  const hl = [{ id: "p1-1", text: "The advisor collects the file." }];

  test("17: an item id equal to a cited paragraph id matches", () => {
    expect(isHighlighted("p1-1", hl)).toBe(true);
  });

  test("18: another id, no id and no citation give no match", () => {
    expect(isHighlighted("p1-2", hl)).toBe(false);
    expect(isHighlighted(null, hl)).toBe(false);
    expect(isHighlighted(undefined, hl)).toBe(false);
    expect(isHighlighted("p1-1", [])).toBe(false);
  });
});

describe("policy panel", () => {
  test("19: no file shows the empty text", () => {
    const html = renderToString(
      createElement(PolicyPanel, { file: null, highlight: [] }),
    );
    expect(html).toContain("No policy file. Ask for an import first.");
  });

  test("20: a file shows the loading text before the module resolves", () => {
    const html = renderToString(
      createElement(PolicyPanel, { file: new File([], "p.pdf"), highlight: [] }),
    );
    expect(html).toContain("Loading the policy...");
  });
});

describe("import dialog", () => {
  test("21: the fresh body holds the title and the analyze button", () => {
    const html = renderToString(
      createElement(ImportDialogBody, {
        onProposed: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("New from policy");
    expect(html).toContain("Analyze policy");
    expect(html).not.toContain("Draft created");
  });
});
