// Rows of the compact step screen: the display form of the values,
// the prefilled scans, the summary and the sticky footer. The
// environment is node: renderToString, no jsdom (the pattern of the
// other render tests).

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import seedJson from "../../../internal/store/seed/example-process.json";
import { valueText } from "./format";
import { StepScreen } from "./StepScreen";
import type { Field, ProcessDefinition } from "./types";

const seed = seedJson as ProcessDefinition;

function field(type: Field["type"]): Field {
  return { name: "f", label: "F", type, options: [], computed: null };
}

describe("value text", () => {
  test("money, integer and number use their display forms", () => {
    expect(valueText(field("money"), 484.78426343952646, "EUR")).toBe("€484.78");
    expect(valueText(field("integer"), 240, "EUR")).toBe("240");
    expect(valueText(field("number"), 0.16159475447984215, "EUR")).toBe("0.162");
  });

  test("an empty value gives a dash, a document list gives its count", () => {
    expect(valueText(field("string"), "", "EUR")).toBe("-");
    expect(valueText(field("money"), null, "EUR")).toBe("-");
    expect(valueText(field("document"), ["a", "b", "c", "d"], "EUR")).toBe("4 scans");
    expect(valueText(field("document"), ["a"], "EUR")).toBe("1 scan");
  });

  test("a date gives the day, a boolean gives Yes or No", () => {
    expect(valueText(field("date"), "2026-10-31", "EUR")).toBe("31 Oct 2026");
    expect(valueText(field("boolean"), true, "EUR")).toBe("Yes");
    expect(valueText(field("boolean"), false, "EUR")).toBe("No");
  });

  test("an unknown currency code falls back to two decimals", () => {
    expect(valueText(field("money"), 12, "XX")).toBe("12.00");
  });
});

describe("step form", () => {
  const scans = [
    { id: "d1", case_id: "c1", name: "ID card.png", mime: "image/png", sha256: "x", created_at: "2026-10-29T09:00:00Z" },
    { id: "d2", case_id: "c1", name: "Salary slips.png", mime: "image/png", sha256: "y", created_at: "2026-10-29T09:00:00Z" },
  ];
  const render = (data: Record<string, unknown>) =>
    renderToString(
      createElement(StepScreen, {
        def: seed,
        state: {
          case_id: "c1",
          version_id: "v1",
          status: "open",
          result: "",
          node_id: "entry",
          data,
          assignee: "u-advisor",
          seq: 3,
          prev_hash: "",
        },
        users: [{ id: "u-advisor", name: "Demo Advisor", role_ids: ["advisor"] }],
        actor: "u-advisor",
        onActorChange: () => {},
        onCommand: () => {},
        failedChecks: [],
        onDecide: () => {},
        documents: scans,
        documentsError: null,
        events: [],
        uploading: false,
        onUpload: () => {},
      }),
    );

  test("the attached scans start ticked in the document field", () => {
    const html = render({});
    expect((html.match(/role="checkbox" aria-checked="true"/g) ?? []).length).toBe(2);
  });

  test("a stored document value wins over the prefill", () => {
    const html = render({ documents: ["d2"] });
    expect((html.match(/role="checkbox" aria-checked="true"/g) ?? []).length).toBe(1);
  });

  test("the summary leaves out the empty values, the footer names the missing items", () => {
    const html = render({ client_name: "Marie Rakoto" });
    expect(html).not.toContain(">Release date<");
    expect(html).toMatch(/Missing: [^<]*Bank statements/);
    expect(html).toContain("sticky bottom-0");
  });
});

describe("percent values", () => {
  const pct: Field = {
    name: "annual_rate",
    label: "Annual rate",
    type: "number",
    options: [],
    computed: null,
    format: "percent",
  };
  test.each([
    ["P1", pct, 0.04, "4%"],
    ["P2", pct, 0.0375, "3.75%"],
    ["P3", pct, 0.16159475447984215, "16.16%"],
    ["P4", pct, null, "-"],
    ["P5", pct, "abc", "abc"],
    ["P6", { ...pct, format: null }, 0.04, "0.04"],
    ["P7", field("number"), 0.16159475447984215, "0.162"],
  ])("%s: valueText gives the display form", (_id, f, value, text) => {
    expect(valueText(f, value, "EUR")).toBe(text);
  });
});
