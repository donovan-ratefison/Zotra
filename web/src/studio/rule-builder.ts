// The pure model of the guided rule builder: the operator sets by
// field type, the literals of each type, and the CEL that one rule
// row generates. The component (RuleBuilder.tsx) renders it.

import type { Field, FieldType, ProcessDefinition } from "./types";

export type Operator =
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "ge"
  | "gt"
  | "notempty"
  | "in"
  | "count";

export interface RuleRow {
  field: string;
  op: Operator;
  value: string;
}

const OPERATOR_LABEL: Record<Operator, string> = {
  eq: "equals",
  ne: "is not",
  lt: "is below",
  le: "is at most",
  ge: "is at least",
  gt: "is above",
  notempty: "is not empty",
  in: "is one of",
  count: "has at least",
};

// The date CEL type is a timestamp: string comparisons do not
// compile, so the date set holds the two timestamp comparisons only.
export function operatorsFor(type: FieldType): Operator[] {
  switch (type) {
    case "number":
    case "money":
    case "integer":
      return ["le", "lt", "ge", "gt", "eq", "ne"];
    case "string":
      return ["notempty", "eq", "ne"];
    case "date":
      return ["ge", "le"];
    case "enum":
      return ["eq", "ne", "in"];
    case "document":
      return ["count"];
    case "boolean":
      return ["eq", "ne"];
  }
}

export function operatorLabel(op: Operator): string {
  return OPERATOR_LABEL[op];
}

export function literalOf(type: FieldType, raw: string): string {
  if (type === "number" || type === "money" || type === "integer") {
    const n = raw.trim().replace(",", ".");
    return /^-?\d+(\.\d+)?$/.test(n) ? n : JSON.stringify(raw.trim());
  }
  if (type === "date") {
    if (raw === "now") return "now";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return `timestamp("${raw}T00:00:00Z")`;
    }
    return `timestamp("${raw}")`;
  }
  if (type === "boolean") {
    return raw === "true" || raw === "false" ? raw : JSON.stringify(raw);
  }
  return JSON.stringify(raw);
}

export function conditionCel(row: RuleRow, type: FieldType): string {
  switch (row.op) {
    case "eq":
      return `${row.field} == ${literalOf(type, row.value)}`;
    case "ne":
      return `${row.field} != ${literalOf(type, row.value)}`;
    case "lt":
      return `${row.field} < ${literalOf(type, row.value)}`;
    case "le":
      return `${row.field} <= ${literalOf(type, row.value)}`;
    case "ge":
      return `${row.field} >= ${literalOf(type, row.value)}`;
    case "gt":
      return `${row.field} > ${literalOf(type, row.value)}`;
    case "notempty":
      return `${row.field} != ""`;
    case "in":
      return `${row.field} in [${row.value
        .split(",")
        .map((part) => JSON.stringify(part.trim()))
        .join(", ")}]`;
    case "count":
      return `size(${row.field}) >= ${literalOf("integer", row.value)}`;
  }
}

export function buildExpression(
  rows: RuleRow[],
  types: Record<string, FieldType>,
  join: "and" | "or",
): string {
  return rows
    .map((row) => conditionCel(row, types[row.field] ?? "string"))
    .join(join === "or" ? " || " : " && ");
}

export function typesOf(def: ProcessDefinition): Record<string, FieldType> {
  return Object.fromEntries(def.fields.map((field) => [field.name, field.type]));
}

// The first operator of the type set and the default value of the
// field: the shape of a fresh row. defaultRow and the field change of
// the component share this mapping.
export function defaultRowFor(field: Field): RuleRow {
  let value = "";
  switch (field.type) {
    case "number":
    case "money":
    case "integer":
      value = "0";
      break;
    case "date":
      value = "now";
      break;
    case "enum":
      value = field.options[0] ?? "";
      break;
    case "boolean":
      value = "true";
      break;
    case "document":
      value = "1";
      break;
  }
  return { field: field.name, op: operatorsFor(field.type)[0], value };
}

export function defaultRow(def: ProcessDefinition): RuleRow {
  return defaultRowFor(
    def.fields[0] ?? {
      name: "",
      label: "",
      type: "string",
      options: [],
      computed: null,
    },
  );
}

// The reader of a stored expression: the inverse of conditionCel and
// literalOf. readExpression keeps a read only when the rows build the
// same CEL again, so each read is exact.
const COMPARE: Record<string, Operator> = {
  "==": "eq",
  "!=": "ne",
  "<": "lt",
  "<=": "le",
  ">=": "ge",
  ">": "gt",
};

function stringOf(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function valueOf(type: FieldType, literal: string): string | null {
  if (type === "date") {
    if (literal === "now") return "now";
    const match = /^timestamp\((".*")\)$/.exec(literal);
    const text = match ? stringOf(match[1]) : null;
    if (text === null) return null;
    return /^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(text) ? text.slice(0, 10) : text;
  }
  if (
    (type === "number" || type === "money" || type === "integer") &&
    /^-?\d+(\.\d+)?$/.test(literal)
  ) {
    return literal;
  }
  if (type === "boolean" && (literal === "true" || literal === "false")) return literal;
  return stringOf(literal);
}

export function readCondition(
  text: string,
  types: Record<string, FieldType>,
): RuleRow | null {
  const size = /^size\((\w+)\) >= (\d+)$/.exec(text);
  if (size) {
    return types[size[1]] === "document"
      ? { field: size[1], op: "count", value: size[2] }
      : null;
  }
  const list = /^(\w+) in (\[.*\])$/.exec(text);
  if (list) {
    if (types[list[1]] !== "enum") return null;
    let items: unknown;
    try {
      items = JSON.parse(list[2]);
    } catch {
      return null;
    }
    if (!Array.isArray(items) || !items.every((item) => typeof item === "string")) {
      return null;
    }
    return { field: list[1], op: "in", value: items.join(", ") };
  }
  const compare = /^(\w+) (==|!=|<=|>=|<|>) (.+)$/.exec(text);
  if (!compare) return null;
  const [, field, symbol, literal] = compare;
  const type = types[field];
  if (type === undefined) return null;
  if (type === "string" && symbol === "!=" && literal === '""') {
    return { field, op: "notempty", value: "" };
  }
  const op = COMPARE[symbol];
  if (!operatorsFor(type).includes(op)) return null;
  const value = valueOf(type, literal);
  return value === null ? null : { field, op, value };
}

export function readExpression(
  expression: string,
  types: Record<string, FieldType>,
): { rows: RuleRow[]; join: "and" | "or" } | null {
  const join = expression.includes(" || ") ? "or" : "and";
  const rows: RuleRow[] = [];
  for (const part of expression.split(join === "or" ? " || " : " && ")) {
    const row = readCondition(part, types);
    if (row === null) return null;
    rows.push(row);
  }
  return buildExpression(rows, types, join) === expression ? { rows, join } : null;
}

// The mode a check opens in. "" and "true" carry no rule (addCheck
// starts a check at "true"): the guided mode seeds one row for them.
// A stored expression that readExpression reads opens in the guided
// mode with its rows. Another stored expression opens in the expert
// mode: the guided rows cannot show it. A check that opens this way
// was never in the guided mode, so it shows no notice and no restore
// button (ruleNotice).
export function initialRuleMode(
  expression: string,
  types: Record<string, FieldType>,
): "guided" | "expert" {
  if (expression === "" || expression === "true") return "guided";
  return readExpression(expression, types) === null ? "expert" : "guided";
}

// The notice of the guided mode: a guided form existed in this edit
// session (the builder holds rows), and the stored CEL left the
// expression that the rows build. A check opened fresh shows no
// notice: no guided form existed.
export function ruleNotice(rows: number, expression: string, guided: string): boolean {
  return rows > 0 && expression !== guided;
}
