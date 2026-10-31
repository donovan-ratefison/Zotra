// The rows of the field input brief: the typed-text rule of the
// numeric and text inputs, and the controlled render of the values.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { FieldInput, fieldInput, fieldText, parseFieldValue } from "./field-inputs";
import type { Field } from "./types";

const numberField: Field = {
  name: "annual_rate",
  label: "Annual rate",
  type: "number",
  options: [],
  computed: null,
};
const moneyField: Field = {
  name: "amount",
  label: "Amount",
  type: "money",
  options: [],
  computed: null,
};
const integerField: Field = {
  name: "duration_months",
  label: "Duration (months)",
  type: "integer",
  options: [],
  computed: null,
};
const stringField: Field = {
  name: "client_name",
  label: "Client name",
  type: "string",
  options: [],
  computed: null,
};

describe("fieldText", () => {
  test("keeps the typed text while it parses to the current value", () => {
    expect(fieldText(numberField, 0, "0.")).toBe("0.");
    expect(fieldText(numberField, 0.04, "0.04")).toBe("0.04");
    expect(fieldText(moneyField, 12, "12.")).toBe("12.");
    expect(fieldText(integerField, 0, "0.")).toBe("0.");
    expect(fieldText(stringField, "ab", "ab")).toBe("ab");
  });

  test("returns the canonical form on an external change or a blur", () => {
    expect(fieldText(numberField, 0.5, "0.04")).toBe("0.5");
    expect(fieldText(numberField, 0, null)).toBe("0");
  });
});

describe("FieldInput render", () => {
  test("the number input renders the value", () => {
    const html = renderToString(
      createElement(FieldInput, {
        field: numberField,
        value: 0.04,
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(html).toContain('value="0.04"');
  });

  test("the money input renders the value", () => {
    const html = renderToString(
      createElement(FieldInput, {
        field: moneyField,
        value: 12,
        onChange: () => {},
        disabled: false,
      }),
    );
    expect(html).toContain('value="12"');
  });
});

describe("percent field", () => {
  const pct: Field = { ...numberField, format: "percent" };
  const render = (field: Field) =>
    renderToString(
      createElement(FieldInput, { field, value: 0.04, onChange: () => {}, disabled: false }),
    );

  test("I1: fieldInput gives the percentage", () => {
    expect(fieldInput(pct, 0.04)).toBe("4");
    expect(fieldInput(pct, 0.07)).toBe("7");
  });

  test("I2: parseFieldValue gives the decimal", () => {
    expect(parseFieldValue(pct, "3.75")).toBe(0.0375);
    expect(parseFieldValue(pct, "4")).toBe(0.04);
  });

  test("I3: an empty or bad text gives null", () => {
    expect(parseFieldValue(pct, "")).toBeNull();
    expect(parseFieldValue(pct, "abc")).toBeNull();
  });

  test("I4: fieldText keeps the typed percentage", () => {
    expect(fieldText(pct, 0.04, "4")).toBe("4");
  });

  test("I5: the input shows the percentage, the suffix and the title", () => {
    const html = render(pct);
    expect(html).toContain('value="4"');
    expect(html).toContain(">%<");
    expect(html).toContain('title="Type the rate in percent, for example 4 for 4%."');
    expect(html).toContain('aria-label="Annual rate"');
  });

  test("I6: a number field with no format shows the decimal", () => {
    const html = render({ ...pct, format: null });
    expect(html).toContain('value="0.04"');
    expect(html).not.toContain(">%<");
  });
});
