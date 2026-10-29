// Display forms of the stored values. The forms and the inputs keep
// the raw values; only the read-only views format them.

import type { Field } from "./types";

const integerFormat = new Intl.NumberFormat("en-IE", {
  maximumFractionDigits: 0,
});
const numberFormat = new Intl.NumberFormat("en-IE", {
  maximumFractionDigits: 3,
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
function moneyFormat(currency: string): Intl.NumberFormat {
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

// valueText gives the display form of one value of one field. An
// empty value gives "-". A document value gives the scan count: the
// stored ids mean nothing to a reader.
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
      return typeof value === "number" ? numberFormat.format(value) : String(value);
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
