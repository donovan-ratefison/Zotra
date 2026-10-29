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
