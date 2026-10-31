// Display forms of the stored values. The forms and the inputs keep
// the raw values; only the read-only views format them.

import type { Field } from "./types";

const integerFormat = new Intl.NumberFormat("en-IE", {
  maximumFractionDigits: 0,
});
const numberFormat = new Intl.NumberFormat("en-IE", {
  maximumFractionDigits: 3,
});
const percentFormat = new Intl.NumberFormat("en-IE", {
  style: "percent",
  maximumFractionDigits: 2,
});
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const moneyFormats = new Map<string, Intl.NumberFormat>();

// moneyFormat gives the cached currency format of one ISO code. An
// unknown code falls back to a plain number with two decimals.
export function moneyFormat(currency: string): Intl.NumberFormat {
  let f = moneyFormats.get(currency);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat("en-IE", { style: "currency", currency });
    } catch {
      f = new Intl.NumberFormat("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormats.set(currency, f);
  }
  return f;
}

// CURRENCIES are the currency choices of a process.
export const CURRENCIES: { code: string; label: string }[] = [
  { code: "EUR", label: "EUR, euro" },
  { code: "USD", label: "USD, US dollar" },
  { code: "MGA", label: "MGA, Malagasy ariary" },
];

// currencyLabel gives the label of a code, else the code itself.
export function currencyLabel(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.label ?? code;
}

// currencyOptions gives the choices, plus the stored code when it is
// not in the list (an AI or imported process file can hold another
// code, and the select must keep it).
export function currencyOptions(code: string): { code: string; label: string }[] {
  return CURRENCIES.some((c) => c.code === code) ? CURRENCIES : [...CURRENCIES, { code, label: code }];
}

// valueText gives the display form of one value of one field. An
// empty value gives "-". A document value gives the scan count: the
// stored ids mean nothing to a reader. A percent number field shows
// its decimal value as a percentage (0.04 gives "4%").
export function valueText(field: Field, value: unknown, currency: string): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  switch (field.type) {
    case "money":
      return typeof value === "number" ? moneyFormat(currency).format(value) : String(value);
    case "integer":
      return typeof value === "number" ? integerFormat.format(value) : String(value);
    case "number":
      if (typeof value !== "number") return String(value);
      return field.format === "percent" ? percentFormat.format(value) : numberFormat.format(value);
    case "boolean":
      return value === true ? "Yes" : "No";
    case "date": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? String(value) : dateFormat.format(d);
    }
    case "document": {
      const n = Array.isArray(value) ? value.length : 0;
      return n === 1 ? "1 scan" : `${n} scans`;
    }
    default:
      return String(value);
  }
}
