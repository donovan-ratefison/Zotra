// The 27 test rows of the panel brief, in order, plus the F rows of
// lot fb-003 (unsaved badge and reserved corner).

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { updateDraft, ApiError } from "./api";
import {
  addCheck,
  newCheckId,
  removeCheck,
  saveErrorText,
  setScopeOverride,
  withCheckExpression,
  withCheckMessage,
  withNodeDeadline,
  withNodeDocuments,
  withNodeName,
  withNodeRole,
  withNodeSignature,
} from "./node-edit";
import { NodePanel, UnsavedBadge } from "./NodePanel";
import { ScopeMatrix } from "./ScopeMatrix";
import { StudioShell } from "./StudioShell";
import { useStudioStore, type PanelTab } from "./store";
import type { ProcessDefinition, VersionSummary } from "./types";

const panelDefinition: ProcessDefinition = {
  schema_version: "1",
  name: "Mini loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
  roles: [
    { id: "advisor", name: "Advisor", department: "Branch" },
    { id: "analyst", name: "Analyst", department: "Risk" },
  ],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
    { name: "documents", label: "Documents", type: "document", options: [], computed: null },
  ],
  scope: [
    { field: "amount", role: "advisor", access: "write" },
    { field: "amount", role: "analyst", access: "read" },
    { field: "documents", role: "advisor", access: "write" },
    { field: "documents", role: "analyst", access: "read" },
  ],
  nodes: [
    { id: "start", type: "start", name: "Application received", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "entry", type: "task", name: "Application entry", role: "advisor",
      deadline_hours: 24, documents: ["ID"], signature: false,
      checks: [{ id: "c1", expression: "amount > 0.0", message: "The amount must be positive.",
                 plain_text: "The loan amount must be positive.", citations: [] }],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "review", type: "task", name: "Review", role: "ghost",
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "complete", type: "gateway", name: "File complete?", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [], citations: [] },
    { id: "released", type: "end", name: "Loan released", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "approved", scope_overrides: [], source_ids: [], citations: [] },
    { id: "refused", type: "end", name: "Loan refused", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "refused", scope_overrides: [], source_ids: [], citations: [] },
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

const draftVersion: VersionSummary = {
  id: "v9",
  process_id: "p1",
  parent_id: null,
  number: 9,
  label: "Draft 9",
  status: "draft",
  created_at: "2026-10-27T12:00:00Z",
  frozen_at: null,
};

const publishedVersion: VersionSummary = { ...draftVersion, status: "published" };

// The entry node of the fixture with checks c1 and c3, for the gap
// rule of newCheckId (row 10).
const withC1C3: ProcessDefinition = {
  ...panelDefinition,
  nodes: panelDefinition.nodes.map((n) =>
    n.id === "entry"
      ? {
          ...n,
          checks: [
            ...n.checks,
            { id: "c3", expression: "true", message: "", plain_text: null, citations: [] },
          ],
        }
      : n,
  ),
};

// The server snapshot of zustand 5 is getInitialState(), so a plain
// setState before renderToString is invisible to the render. The
// initial state object is mutated in place, and the live state is
// set too, so the render and any later client read agree.
function setStudioStore(state: { selectedNodeId: string | null; tab: PanelTab }) {
  Object.assign(useStudioStore.getInitialState(), state);
  useStudioStore.setState(state);
}

function renderNodePanel(
  version: VersionSummary,
  state: { selectedNodeId: string | null; tab: PanelTab },
  def: ProcessDefinition = panelDefinition,
): string {
  setStudioStore(state);
  return renderToString(
    createElement(NodePanel, {
      def,
      version,
      onSaved: () => {},
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setStudioStore({ selectedNodeId: null, tab: "general" });
});

describe("node edits", () => {
  test("1: withNodeName renames entry and keeps the input unchanged", () => {
    const next = withNodeName(panelDefinition, "entry", "New name");
    expect(next.nodes.find((n) => n.id === "entry")!.name).toBe("New name");
    expect(panelDefinition.nodes.find((n) => n.id === "entry")!.name).toBe(
      "Application entry",
    );
  });

  test("2: withNodeName throws on an unknown node id", () => {
    expect(() => withNodeName(panelDefinition, "ghost", "x")).toThrow(
      "unknown node id: ghost",
    );
  });

  test("3: withNodeRole writes null and a role id", () => {
    const nulled = withNodeRole(panelDefinition, "review", null);
    expect(nulled.nodes.find((n) => n.id === "review")!.role).toBeNull();
    const changed = withNodeRole(panelDefinition, "entry", "analyst");
    expect(changed.nodes.find((n) => n.id === "entry")!.role).toBe("analyst");
  });

  test("4: withNodeDeadline writes null and an integer", () => {
    const cleared = withNodeDeadline(panelDefinition, "entry", null);
    expect(cleared.nodes.find((n) => n.id === "entry")!.deadline_hours).toBeNull();
    const set = withNodeDeadline(panelDefinition, "entry", 12);
    expect(set.nodes.find((n) => n.id === "entry")!.deadline_hours).toBe(12);
  });

  test("5: withNodeDocuments writes the exact array", () => {
    const next = withNodeDocuments(panelDefinition, "entry", ["ID", "Payslip"]);
    expect(next.nodes.find((n) => n.id === "entry")!.documents).toEqual([
      "ID",
      "Payslip",
    ]);
  });

  test("6: withNodeSignature writes true", () => {
    const next = withNodeSignature(panelDefinition, "entry", true);
    expect(next.nodes.find((n) => n.id === "entry")!.signature).toBe(true);
  });

  test("7: withCheckExpression changes the expression only", () => {
    const next = withCheckExpression(panelDefinition, "entry", "c1", "amount > 100.0");
    const check = next.nodes.find((n) => n.id === "entry")!.checks[0]!;
    expect(check.expression).toBe("amount > 100.0");
    expect(check.message).toBe("The amount must be positive.");
  });

  test("8: withCheckMessage changes the message only", () => {
    const next = withCheckMessage(panelDefinition, "entry", "c1", "New message.");
    const check = next.nodes.find((n) => n.id === "entry")!.checks[0]!;
    expect(check.message).toBe("New message.");
    expect(check.expression).toBe("amount > 0.0");
  });

  test("9: addCheck appends the five fields with the smallest free id", () => {
    const next = addCheck(panelDefinition, "entry");
    const checks = next.nodes.find((n) => n.id === "entry")!.checks;
    expect(checks).toHaveLength(2);
    expect(checks[1]).toEqual({
      id: "c2",
      expression: "true",
      message: "",
      plain_text: null,
      citations: [],
    });
  });

  test("10: newCheckId returns the smallest positive gap", () => {
    expect(newCheckId(withC1C3)).toBe("c2");
  });

  test("11: removeCheck drops the check", () => {
    const next = removeCheck(panelDefinition, "entry", "c1");
    expect(next.nodes.find((n) => n.id === "entry")!.checks).toHaveLength(0);
  });

  test("12: removeCheck throws on an unknown check id", () => {
    expect(() => removeCheck(panelDefinition, "entry", "nope")).toThrow(
      "unknown check id: nope on node entry",
    );
  });
});

describe("scope overrides", () => {
  test("13: a different access appends the override row", () => {
    const next = setScopeOverride(panelDefinition, "entry", "amount", "analyst", "hidden");
    const node = next.nodes.find((n) => n.id === "entry")!;
    expect(node.scope_overrides).toEqual([
      { field: "amount", role: "analyst", access: "hidden" },
    ]);
  });

  test("14: the process value leaves no override row", () => {
    const next = setScopeOverride(panelDefinition, "entry", "amount", "analyst", "read");
    const node = next.nodes.find((n) => n.id === "entry")!;
    expect(node.scope_overrides).toEqual([]);
  });

  test("15: an unknown field throws with both values", () => {
    expect(() =>
      setScopeOverride(panelDefinition, "entry", "salary", "analyst", "read"),
    ).toThrow("unknown scope row: salary, analyst");
  });

  test("16: an unknown role throws with both values", () => {
    expect(() =>
      setScopeOverride(panelDefinition, "entry", "amount", "intern", "read"),
    ).toThrow("unknown scope row: amount, intern");
  });
});

describe("save error text", () => {
  test("17: a conflict gives the fixed text", () => {
    expect(
      saveErrorText(new ApiError(409, "conflict", "version v9 is not a draft")),
    ).toBe("This version is not a draft anymore.");
  });

  test("18: another ApiError gives its message", () => {
    expect(saveErrorText(new ApiError(500, "internal", "boom"))).toBe("boom");
  });

  test("19: anything else gives the fallback", () => {
    expect(saveErrorText(new Error("network"))).toBe("The draft did not save.");
  });
});

describe("updateDraft", () => {
  test("20: PUTs the definition and returns the stored version", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", (path: string, init: RequestInit) => {
      calls.push({ path, init });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          version: {
            ...draftVersion,
            definition: panelDefinition,
          },
        }),
      });
    });
    const saved = await updateDraft("v9", panelDefinition);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/versions/v9");
    expect(calls[0]!.init.method).toBe("PUT");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      definition: panelDefinition,
    });
    expect(saved.definition.name).toBe("Mini loan");
  });
});

describe("panel render", () => {
  test("21: the draft panel of a task shows the general tab and the hidden panes", () => {
    const html = renderNodePanel(draftVersion, {
      selectedNodeId: "entry",
      tab: "general",
    });
    expect(html).toContain("Application entry");
    expect(html).toContain("Step name");
    expect(html).toContain("Deadline");
    expect(html).toContain("Role");
    expect(html).toContain("Advisor");
    expect(html).toContain("Outgoing links");
    expect(html).toContain("Review");
    expect(html).toContain("Save draft");
    expect(html).toContain("Plain language: The loan amount must be positive.");
  });

  test("22: a published version shows the banner and a disabled save button", () => {
    const html = renderNodePanel(publishedVersion, {
      selectedNodeId: "entry",
      tab: "general",
    });
    expect(html).toContain(
      "This version is published. Only a draft can be edited.",
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Save draft/);
  });

  test("23: a gateway on the requirements tab shows the gate", () => {
    const html = renderNodePanel(draftVersion, {
      selectedNodeId: "complete",
      tab: "requirements",
    });
    expect(html).toContain("Only tasks have requirements.");
    expect(html).toContain("Documents, signature and checks apply to tasks.");
  });

  test("24: a gateway on the scope tab shows the gate", () => {
    const html = renderNodePanel(draftVersion, {
      selectedNodeId: "complete",
      tab: "scope",
    });
    expect(html).toContain("Only tasks have a screen and a role.");
    expect(html).toContain("The process scope applies to this step.");
  });

  test("25: the scope tab of a task shows the matrix and the legend", () => {
    const html = renderNodePanel(draftVersion, {
      selectedNodeId: "entry",
      tab: "scope",
    });
    expect(html).toContain("No override. The process scope applies.");
    expect(html).toContain("Advisor");
    expect(html).toContain("Analyst");
    expect(html).toContain("Amount");
    expect(html).toContain("Documents");
    expect(html).toContain("R Read · W Write · H Hidden");
  });
});

describe("scope matrix render", () => {
  test("26: an overridden cell carries the dot, the title, the label and the badge", () => {
    const def = setScopeOverride(panelDefinition, "entry", "amount", "analyst", "hidden");
    const node = def.nodes.find((n) => n.id === "entry")!;
    setStudioStore({ selectedNodeId: null, tab: "general" });
    const html = renderToString(
      createElement(ScopeMatrix, { def, node, editable: true }),
    );
    expect(html).toContain("H");
    expect(html).toContain('title="Process: R"');
    expect(html).toContain("overridden here");
    expect(html).toContain("Overridden here");
  });
});

describe("shell empty state", () => {
  function renderShell(client: QueryClient): string {
    return renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ReactFlowProvider, null, createElement(StudioShell)),
      ),
    );
  }

  test("27: no selection shows the process overview", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["processes"], [
      { id: "p1", name: "Mini loan", created_at: "2026-10-27T09:00:00Z" },
    ]);
    client.setQueryData(["versions", "p1"], [draftVersion]);
    client.setQueryData(["version", "v9"], {
      ...draftVersion,
      definition: panelDefinition,
    });
    useStudioStore.setState({ selectedNodeId: null, tab: "general" });
    Object.assign(useStudioStore.getInitialState(), {
      selectedNodeId: null,
      tab: "general",
    });
    const html = renderShell(client);
    // With no step selected, the panel shows the process overview.
    expect(html).toContain("Select a step to edit it.");
    expect(html).toContain("Structure");
    expect(html).toContain("Roles");
  });
});

describe("unsaved badge and reserved corner", () => {
  test("F1: the panel reserves the corner above the Report button", () => {
    const html = renderNodePanel(draftVersion, {
      selectedNodeId: "entry",
      tab: "general",
    });
    const spacers = html.match(
      /<div class="h-14 shrink-0" aria-hidden="true"><\/div>/g,
    );
    expect(spacers).toHaveLength(1);
    expect(html).toContain("Save draft");
  });

  test("F2: the unsaved badge holds the dot and the amber colors", () => {
    const html = renderToString(createElement(UnsavedBadge, {}));
    expect(html).toContain("Unsaved changes");
    expect(html).toContain("bg-amber-500/10");
    expect(html).toContain("text-amber-700");
    expect(html).toContain('bg-amber-500" aria-hidden="true"');
  });
});
