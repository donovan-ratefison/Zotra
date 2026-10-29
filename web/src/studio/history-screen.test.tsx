// Rows of the version history and of the Screen tab of the step
// panel, plus the field order move. The environment is node:
// renderToString, no jsdom (the pattern of the other render tests).

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import seedJson from "../../../internal/store/seed/example-process.json";
import { moveField } from "./node-edit";
import { ScreenPane } from "./ScreenPane";
import { HistoryBody } from "./version-actions";
import type { ProcessDefinition, VersionSummary } from "./types";

const seed = seedJson as ProcessDefinition;

describe("field order", () => {
  test("a move puts the field at the place of the target", () => {
    const next = moveField(seed, "analysis_opinion", "client_name");
    expect(next.fields.map((f) => f.name).slice(0, 3)).toEqual([
      "analysis_opinion",
      "client_name",
      "profession",
    ]);
    expect(next.fields).toHaveLength(seed.fields.length);
  });

  test("an unknown name or the same place keeps the definition", () => {
    expect(moveField(seed, "nope", "client_name")).toBe(seed);
    expect(moveField(seed, "amount", "amount")).toBe(seed);
  });
});

function version(over: Partial<VersionSummary>): VersionSummary {
  return {
    id: "v1",
    process_id: "p1",
    parent_id: null,
    number: 1,
    label: "Initial",
    status: "published",
    created_at: "2026-10-28T15:57:00Z",
    frozen_at: "2026-10-28T15:57:00Z",
    ...over,
  };
}

describe("version history", () => {
  const rows = [
    version({}),
    version({ id: "v2", number: 2, label: "Threshold", status: "frozen", parent_id: "v1" }),
    version({ id: "v3", number: 3, label: "Draft work", status: "draft", parent_id: "v2", frozen_at: null }),
  ];

  test("the newest version comes first, with the actions of its status", () => {
    const html = renderToString(
      createElement(HistoryBody, {
        def: seed,
        version: rows[2]!,
        versions: rows,
        onOpen: () => {},
        onAction: () => {},
      }),
    );
    expect(html.indexOf(">v3<")).toBeLessThan(html.indexOf(">v2<"));
    expect(html.indexOf(">v2<")).toBeLessThan(html.indexOf(">v1<"));
    expect(html).toContain("Home loan · 2 versions and 1 draft");
    expect(html).toContain(">Shown<");
    expect((html.match(/>Freeze</g) ?? []).length).toBe(1);
    expect((html.match(/>Publish</g) ?? []).length).toBe(1);
    expect((html.match(/New draft from this version/g) ?? []).length).toBe(2);
    // The shown version has no Open button; the two others have one.
    expect((html.match(/>Open</g) ?? []).length).toBe(2);
    expect(html).toContain("from v2");
  });
});

describe("screen tab", () => {
  const analysis = seed.nodes.find((n) => n.id === "analysis")!;

  test("a task shows the preview for its role and the visible fields", () => {
    const html = renderToString(
      createElement(ScreenPane, { def: seed, node: analysis, editable: true, onChange: () => {} }),
    );
    expect(html).toContain("Preview for Credit analyst");
    expect(html).toContain(seed.theme.brand_name);
    expect(html).toContain('aria-label="Form fields"');
    expect((html.match(/>Write</g) ?? []).length).toBe(2);
    expect(html).toContain("1 field is hidden for this role");
    expect(html).toContain('aria-label="Move Client name down"');
  });

  test("a gateway has no screen, and a frozen version hides the move buttons", () => {
    const gateway = seed.nodes.find((n) => n.type === "gateway")!;
    expect(
      renderToString(createElement(ScreenPane, { def: seed, node: gateway, editable: true, onChange: () => {} })),
    ).toContain("Only tasks have a screen.");
    const frozen = renderToString(
      createElement(ScreenPane, { def: seed, node: analysis, editable: false, onChange: () => {} }),
    );
    expect(frozen).not.toContain("Move Client name down");
  });
});

