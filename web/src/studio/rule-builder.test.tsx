// The rows of the rule builder brief, in order.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  buildExpression,
  conditionCel,
  defaultRow,
  initialRuleMode,
  literalOf,
  operatorLabel,
  operatorsFor,
  readExpression,
  ruleNotice,
  typesOf,
  type RuleRow,
  type RuleType,
} from "./rule-builder";
import { RuleBuilder } from "./RuleBuilder";
import type { Check, FieldType, ProcessDefinition } from "./types";

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

const c1 = panelDefinition.nodes.find((n) => n.id === "entry")!.checks[0];
const checkWith = (expression: string): Check => ({ ...c1, expression });

function renderBuilder(check: Check, disabled = false): string {
  return renderToString(
    createElement(RuleBuilder, {
      def: panelDefinition,
      check,
      onExpressionChange: vi.fn(),
      disabled,
    }),
  );
}

// The tag that holds an attribute, found from the attribute backwards:
// the class strings carry the substring "disabled:", so only the
// attribute form proves the disabled state.
function tagOf(html: string, marker: string, element: string): string {
  const at = html.indexOf(marker);
  const start = html.lastIndexOf("<" + element, at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

// The assertions that rows 7 and 7b share: one seeded guided row.
function expectSeededRow(html: string) {
  expect(html).toContain('aria-label="Rule mode of check c1"');
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Guided/);
  expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Expert/);
  expect(html).toContain('aria-label="Condition 1"');
  expect(html).toContain('aria-label="Field of condition 1"');
  expect(html).toContain('<option value="amount" selected="">Amount</option>');
  expect(html).toContain('aria-label="Operator of condition 1"');
  expect(html).toContain('<option value="le" selected="">is at most</option>');
  expect(html).toContain('aria-label="Value of condition 1"');
  expect(html).toMatch(/aria-label="Value of condition 1"[^>]*value="0"/);
  expect(html).toContain("Add a condition");
  expect(html).toContain("Generated CEL (read only)");
  expect(html).toContain("amount &lt;= 0");
  expect(html).not.toContain("changed in the expert mode");
  expect(html).not.toContain('aria-label="Join of the conditions"');
}

describe("operator sets", () => {
  test("1: operatorsFor lists the operators of each field type, in order", () => {
    expect(operatorsFor("number")).toEqual(["le", "lt", "ge", "gt", "eq", "ne"]);
    expect(operatorsFor("money")).toEqual(["le", "lt", "ge", "gt", "eq", "ne"]);
    expect(operatorsFor("integer")).toEqual(["le", "lt", "ge", "gt", "eq", "ne"]);
    expect(operatorsFor("string")).toEqual(["notempty", "eq", "ne"]);
    expect(operatorsFor("date")).toEqual(["ge", "le"]);
    expect(operatorsFor("enum")).toEqual(["eq", "ne", "in"]);
    expect(operatorsFor("document")).toEqual(["count"]);
    expect(operatorsFor("boolean")).toEqual(["eq", "ne"]);
  });

  test("2: operatorLabel names each operator", () => {
    expect(operatorLabel("eq")).toBe("equals");
    expect(operatorLabel("ne")).toBe("is not");
    expect(operatorLabel("lt")).toBe("is below");
    expect(operatorLabel("le")).toBe("is at most");
    expect(operatorLabel("ge")).toBe("is at least");
    expect(operatorLabel("gt")).toBe("is above");
    expect(operatorLabel("notempty")).toBe("is not empty");
    expect(operatorLabel("in")).toBe("is one of");
    expect(operatorLabel("count")).toBe("has at least");
  });

  test("2b: typesOf maps the field names of the fixture", () => {
    expect(typesOf(panelDefinition)).toEqual({
      amount: "money",
      documents: "document",
    });
  });
});

describe("literals, conditions, expressions", () => {
  test("3: literalOf writes the literal of each type", () => {
    expect(literalOf("money", "240 000")).toBe('"240 000"');
    expect(literalOf("money", "240,5")).toBe("240.5");
    expect(literalOf("money", "abc")).toBe('"abc"');
    expect(literalOf("boolean", "true")).toBe("true");
    expect(literalOf("string", "x")).toBe('"x"');
    expect(literalOf("date", "now")).toBe("now");
    expect(literalOf("date", "2026-11-01")).toBe(
      'timestamp("2026-11-01T00:00:00Z")',
    );
    expect(literalOf("date", "2026-11-01T10:00:00Z")).toBe(
      'timestamp("2026-11-01T10:00:00Z")',
    );
    expect(literalOf("date", "")).toBe('timestamp("")');
  });

  test("4: conditionCel writes the CEL of each operator", () => {
    expect(conditionCel({ field: "amount", op: "ge", value: "100,5" }, "money")).toBe(
      "amount >= 100.5",
    );
    expect(
      conditionCel({ field: "client_name", op: "notempty", value: "" }, "string"),
    ).toBe('client_name != ""');
    expect(conditionCel({ field: "kind", op: "in", value: "fast, slow" }, "enum")).toBe(
      'kind in ["fast", "slow"]',
    );
    expect(conditionCel({ field: "docs", op: "count", value: "4" }, "document")).toBe(
      "size(docs) >= 4",
    );
    expect(conditionCel({ field: "ok", op: "eq", value: "true" }, "boolean")).toBe(
      "ok == true",
    );
    expect(
      conditionCel({ field: "signed_on", op: "le", value: "2026-11-01" }, "date"),
    ).toBe('signed_on <= timestamp("2026-11-01T00:00:00Z")');
    expect(
      conditionCel({ field: "release_date", op: "ge", value: "now" }, "date"),
    ).toBe("release_date >= now");
  });

  test("5: buildExpression joins the rows", () => {
    const rows: RuleRow[] = [
      { field: "amount", op: "ge", value: "100,5" },
      { field: "duration_months", op: "le", value: "300" },
    ];
    const types: Record<string, FieldType> = {
      amount: "money",
      duration_months: "integer",
    };
    expect(buildExpression(rows, types, "and")).toBe(
      "amount >= 100.5 && duration_months <= 300",
    );
    expect(buildExpression(rows, types, "or")).toBe(
      "amount >= 100.5 || duration_months <= 300",
    );
    expect(buildExpression([rows[0]], types, "and")).toBe("amount >= 100.5");
    expect(buildExpression([], types, "and")).toBe("");
    expect(
      buildExpression([{ field: "ghost", op: "eq", value: "x" }], {}, "and"),
    ).toBe('ghost == "x"');
  });

  test("6: defaultRow seeds the first field of the definition", () => {
    expect(defaultRow(panelDefinition)).toEqual({
      field: "amount",
      op: "le",
      value: "0",
    });
  });
});

describe("rule builder render", () => {
  test("7: an empty expression seeds one guided row", () => {
    expectSeededRow(renderBuilder(checkWith("")));
  });

  test("7b: the addCheck marker true seeds the same guided row", () => {
    expectSeededRow(renderBuilder(checkWith("true")));
  });

  test("8: a stored rule the builder cannot show opens in the expert mode", () => {
    const html = renderBuilder(checkWith("amount * 2.0 > 10.0"));
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Guided/);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Expert/);
    // The stored CEL sits in the textarea.
    expect(html).toMatch(/<textarea[^>]*>amount \* 2\.0 &gt; 10\.0<\/textarea>/);
    // The plain text of the check sits above the CEL.
    expect(html).toContain("The loan amount must be positive.");
    // The rule was never in the guided mode: no notice, no restore.
    expect(html).not.toContain("changed in the expert mode");
    expect(html).not.toContain("Restore the guided rule");
    expect(html).not.toContain("Field of condition 1");
  });

  test("8b: the expert pane hides an empty plain text", () => {
    const html = renderBuilder({ ...checkWith("amount * 2.0 > 10.0"), plain_text: null });
    expect(html).toContain('aria-label="Expression of check c1"');
    expect(html).not.toContain("The loan amount must be positive.");
  });

  test("9: a disabled builder disables the value input and the add button", () => {
    const html = renderBuilder(checkWith(""), true);
    expect(tagOf(html, 'aria-label="Value of condition 1"', "input")).toContain(
      'disabled=""',
    );
    expect(tagOf(html, "Add a condition", "button")).toContain('disabled=""');
  });

  test("10: the only row carries a disabled remove button and no join", () => {
    const html = renderBuilder(checkWith(""));
    expect(tagOf(html, 'aria-label="Remove condition 1"', "button")).toContain(
      'disabled=""',
    );
    expect(html).not.toContain('aria-label="Join of the conditions"');
  });

  test("G1: a stored rule that the builder reads opens guided with its row", () => {
    const html = renderBuilder(c1);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Guided/);
    expect(html).toContain('<option value="amount" selected="">Amount</option>');
    expect(html).toContain('<option value="gt" selected="">is above</option>');
    expect(html).toMatch(/aria-label="Value of condition 1"[^>]*value="0\.0"/);
    expect(html).toContain("amount &gt; 0.0");
    expect(html).not.toContain('aria-label="Expression of check c1"');
    expect(html).not.toContain("changed in the expert mode");
    expect(html).not.toContain('aria-label="Join of the conditions"');
  });

  test("G2: a stored rule with two conditions shows both rows and its join", () => {
    const html = renderBuilder(checkWith("amount <= 500.0 || size(documents) >= 2"));
    expect(html).toContain('aria-label="Condition 2"');
    expect(html).toContain('aria-label="Join of the conditions"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>or<\/button>/);
    expect(html).toContain('<option value="count" selected="">has at least</option>');
    expect(html).toMatch(/aria-label="Value of condition 2"[^>]*value="2"/);
    expect(html).not.toContain("changed in the expert mode");
  });
});

// The local field types of rows R and X.
const readTypes: Record<string, FieldType> = {
  amount: "money",
  term: "integer",
  rate: "number",
  note: "string",
  decision: "enum",
  due: "date",
  docs: "document",
  ok: "boolean",
};

describe("readExpression", () => {
  const row = (field: string, op: RuleRow["op"], value: string): RuleRow => ({
    field,
    op,
    value,
  });
  test.each([
    ["R1", "amount > 0.0", [row("amount", "gt", "0.0")], "and"],
    ["R2", 'rate <= 0.33 || note != ""', [row("rate", "le", "0.33"), row("note", "notempty", "")], "or"],
    [
      "R3",
      "amount >= 1000 && term <= 300 && size(docs) >= 2",
      [row("amount", "ge", "1000"), row("term", "le", "300"), row("docs", "count", "2")],
      "and",
    ],
    ["R4", 'decision in ["approve", "refuse"]', [row("decision", "in", "approve, refuse")], "and"],
    ["R5", 'decision != ""', [row("decision", "ne", "")], "and"],
    ["R6", "due >= now", [row("due", "ge", "now")], "and"],
    ["R7", 'due <= timestamp("2026-01-01T00:00:00Z")', [row("due", "le", "2026-01-01")], "and"],
    ["R8", "ok == false", [row("ok", "eq", "false")], "and"],
    ["R9", 'note == "done"', [row("note", "eq", "done")], "and"],
  ])("%s: %s", (_id, expression, rows, join) => {
    expect(readExpression(expression, readTypes)).toEqual({ rows, join });
  });

  test.each([
    ["X1", ""],
    ["X2", "true"],
    ["X3", "amount * 2.0 > 10.0"],
    ["X4", "amount > 0.0 && term <= 300 || rate < 1"],
    ["X5", "ghost > 1"],
    ["X6", 'note < "b"'],
    ["X7", "size(amount) >= 1"],
    ["X8", "blacklist.listed == false"],
    ["X9", "amount>0"],
    ["X10", 'note == "a && b"'],
    ["X11", "decision in [1, 2]"],
  ])("%s: %s gives null", (_id, expression) => {
    expect(readExpression(expression, readTypes)).toBeNull();
  });
});

describe("rule mode and notice helpers", () => {
  test("8c: initialRuleMode opens markers and read rules guided, others expert", () => {
    const types = typesOf(panelDefinition);
    expect(initialRuleMode("", types)).toBe("guided");
    expect(initialRuleMode("true", types)).toBe("guided");
    expect(initialRuleMode("amount > 0.0", types)).toBe("guided");
    expect(initialRuleMode("amount * 2.0 > 10.0", types)).toBe("expert");
  });

  test("8d: ruleNotice needs guided rows and a left built expression", () => {
    // No guided form existed in this edit session.
    expect(ruleNotice(0, "a changed CEL", "")).toBe(false);
    // The stored CEL still matches the rows.
    expect(ruleNotice(2, "amount <= 0", "amount <= 0")).toBe(false);
    // The user built rows, then changed the CEL in the expert mode.
    expect(ruleNotice(2, "a changed CEL", "amount <= 0")).toBe(true);
  });
});

describe("percent rows", () => {
  const pct = { options: [], computed: null, format: "percent" as const };
  const percentDefinition: ProcessDefinition = {
    ...panelDefinition,
    fields: [
      { name: "annual_rate", label: "Annual rate", type: "number", ...pct },
      { name: "amount", label: "Amount", type: "money", options: [], computed: null },
    ],
  };
  const types: Record<string, RuleType> = {
    debt_ratio: "percent",
    analysis_comment: "string",
  };
  const row = (field: string, op: RuleRow["op"], value: string): RuleRow => ({
    field,
    op,
    value,
  });

  test("R1: typesOf gives percent for a percent number field", () => {
    expect(typesOf(percentDefinition)).toEqual({ annual_rate: "percent", amount: "money" });
  });

  test.each([
    ["33", "0.33"],
    ["4.5", "0.045"],
    ["100", "1.0"],
    ["0", "0.0"],
    ["-5", "-0.05"],
    ["33,5", "0.335"],
    ["12.50", "0.125"],
    ["abc", '"abc"'],
  ])("R2: literalOf percent %s gives %s", (raw, literal) => {
    expect(literalOf("percent", raw)).toBe(literal);
  });

  test("R3: a stored percent rule reads as percent rows", () => {
    expect(readExpression('debt_ratio <= 0.33 || analysis_comment != ""', types)).toEqual({
      rows: [row("debt_ratio", "le", "33"), row("analysis_comment", "notempty", "")],
      join: "or",
    });
  });

  test("R4: 1.0 reads as 100", () => {
    expect(readExpression("debt_ratio <= 1.0", types)?.rows[0].value).toBe("100");
  });

  test("R5: a literal the rows do not build again gives null", () => {
    expect(readExpression("debt_ratio <= 0.330", types)).toBeNull();
    expect(readExpression("debt_ratio <= 1", types)).toBeNull();
  });

  test("R6: a percent row builds the decimal CEL", () => {
    expect(buildExpression([row("debt_ratio", "le", "33")], types, "and")).toBe(
      "debt_ratio <= 0.33",
    );
  });

  test("R7: percent has the number operator set", () => {
    expect(operatorsFor("percent")).toEqual(["le", "lt", "ge", "gt", "eq", "ne"]);
  });

  test("R8: a stored percent rule opens guided", () => {
    expect(initialRuleMode("debt_ratio <= 0.33", types)).toBe("guided");
  });

  test("R9: the builder shows the percentage, the suffix and the title", () => {
    const def: ProcessDefinition = {
      ...panelDefinition,
      fields: [{ name: "debt_ratio", label: "Debt ratio", type: "number", ...pct }],
    };
    const html = renderToString(
      createElement(RuleBuilder, {
        def,
        check: checkWith("debt_ratio <= 0.33"),
        onExpressionChange: vi.fn(),
        disabled: false,
      }),
    );
    expect(html).toMatch(/aria-label="Value of condition 1"[^>]*value="33"/);
    expect(html).toContain(">%<");
    expect(html).toContain('title="Percent, for example 33 for 33%."');
    expect(html).toContain("debt_ratio &lt;= 0.33");
  });
});
