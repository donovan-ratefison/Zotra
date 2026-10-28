// One input component per field type of the data model (cadrage
// section 5), plus the string and parse forms of one value. The step
// form and the new test case dialog share them.

import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import type { Field } from "./types";

// fieldInput gives the string form of a value for an input. null and
// undefined (a not-yet-touched field) give "", numbers give their
// string form, booleans give "true"/"false", documents join with
// ", ", everything else (string, enum, date) is already text.
export function fieldInput(field: Field, value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (field.type === "number" || field.type === "money" || field.type === "integer") {
    return String(value);
  }
  if (field.type === "boolean") {
    return value === true ? "true" : "false";
  }
  if (field.type === "document") {
    return Array.isArray(value) ? value.join(", ") : String(value);
  }
  return String(value);
}

// parseFieldValue parses one input string back to the value of the
// field type: numbers give null when the text is empty or not
// finite, a date gives null when empty, a document splits on commas
// and drops the empty items.
export function parseFieldValue(field: Field, raw: string): unknown {
  switch (field.type) {
    case "number":
    case "money": {
      const n = Number(raw);
      return raw === "" || !Number.isFinite(n) ? null : n;
    }
    case "integer": {
      const n = Number.parseInt(raw, 10);
      return raw === "" || !Number.isFinite(n) ? null : n;
    }
    case "boolean":
      return raw === "true";
    case "date":
      return raw === "" ? null : raw;
    case "document":
      return raw
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
    default:
      return raw;
  }
}

// FieldInput renders one input for the field type, fully controlled:
// the value comes in, the parsed value goes out through onChange.
// Every input carries the field label as its accessible name.
export function FieldInput({ field, value, onChange, disabled }: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  if (field.type === "boolean") {
    return (
      <Switch
        aria-label={field.label}
        checked={value === true}
        onCheckedChange={(v) => onChange(v)}
        disabled={disabled}
      />
    );
  }
  if (field.type === "enum") {
    return (
      <Select
        value={typeof value === "string" ? value : undefined}
        onValueChange={(v) => onChange(v)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={field.label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  const type =
    field.type === "date"
      ? "date"
      : field.type === "number" || field.type === "money" || field.type === "integer"
        ? "number"
        : undefined;
  const step =
    field.type === "money" ? "0.01" : field.type === "integer" ? "1" : undefined;
  return (
    <Input
      type={type}
      step={step}
      aria-label={field.label}
      title={field.type === "document" ? "Document ids, comma separated" : undefined}
      value={fieldInput(field, value)}
      onChange={(e) => onChange(parseFieldValue(field, e.target.value))}
      disabled={disabled}
    />
  );
}
