// One input component per field type of the data model (cadrage
// section 5), plus the string and parse forms of one value. The step
// form and the new test case dialog share them.

import { useState } from "react";
import { Checkbox } from "@/ui/checkbox";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import type { Field } from "./types";

// ScanOption is one scan of the case, for the document field.
export interface ScanOption {
  id: string;
  name: string;
}

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

// fieldText gives the text an input shows: the raw typed text while
// it still parses to the current value, else the canonical string
// form. A null text (nothing typed, or after a blur) always gives
// the canonical form.
export function fieldText(field: Field, value: unknown, text: string | null): string {
  if (text !== null && parseFieldValue(field, text) === value) {
    return text;
  }
  return fieldInput(field, value);
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
// Every input carries the field label as its accessible name. A
// document field renders one checkbox row per scan; the checked ids
// are the value array.
export function FieldInput({ field, value, onChange, disabled, scans }: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  scans?: ScanOption[];
}) {
  const [text, setText] = useState<string | null>(null);
  if (field.type === "document") {
    if (!scans || scans.length === 0) {
      return (
        <p className="text-[12px] text-muted-foreground">No scans yet.</p>
      );
    }
    const checkedIds = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-col gap-1.5">
        {scans.map((scan) => {
          const checked = checkedIds.includes(scan.id);
          return (
            <label key={scan.id} className="flex items-center gap-2">
              <Checkbox
                aria-label={scan.name}
                checked={checked}
                onCheckedChange={() =>
                  onChange(
                    checked
                      ? checkedIds.filter((id) => id !== scan.id)
                      : [...checkedIds, scan.id],
                  )
                }
                disabled={disabled}
              />
              <span className="text-[13px]">{scan.name}</span>
            </label>
          );
        })}
      </div>
    );
  }
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
      value={fieldText(field, value, text)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseFieldValue(field, e.target.value));
      }}
      onBlur={() => setText(null)}
      disabled={disabled}
    />
  );
}
