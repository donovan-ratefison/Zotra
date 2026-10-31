// The test rows of the new process from scratch: the empty draft,
// the Start of the toolbar, the New menu and the scratch dialog.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { blankDefinition } from "./blank";
import { addNode, connect, EditToolbar, removeNode } from "./edit";
import { canCreate, NewProcessMenu, ScratchDialogBody } from "./NewProcess";
import { TopBar } from "./StudioShell";

// buttonOf returns the html of the toolbar button that holds label.
function buttonOf(html: string, label: string): string {
  const button = html.split("<button").find((b) => b.includes(`${label}</button>`));
  if (button === undefined) throw new Error(`no button ${label}`);
  return button;
}

describe("new process from scratch", () => {
  test("N1: blankDefinition gives the 12 keys, with no step and no link", () => {
    expect(blankDefinition("Car loan")).toEqual({
      schema_version: "1",
      name: "Car loan",
      currency: "EUR",
      policy_document_id: null,
      theme: { brand_name: "Car loan", primary_color: "#820ad1", logo_url: null },
      roles: [],
      fields: [],
      scope: [],
      nodes: [],
      edges: [],
      sources: [],
    });
  });

  test("N2: addNode start adds one start named Start", () => {
    const { def, id } = addNode(blankDefinition("x"), "start");
    expect(def.nodes).toHaveLength(1);
    expect(def.nodes[0]).toMatchObject({ id, type: "start", name: "Start", end_result: null });
  });

  test("N3: with a start, the Start button is disabled with a title", () => {
    const html = renderToString(createElement(EditToolbar, { onAdd: () => {}, hasStart: true }));
    expect(buttonOf(html, "Start")).toContain('disabled=""');
    expect(buttonOf(html, "Start")).toContain('title="A process has one start."');
    expect(buttonOf(html, "Task")).not.toContain('disabled=""');
  });

  test("N4: with no start, the Start button is enabled", () => {
    const html = renderToString(createElement(EditToolbar, { onAdd: () => {}, hasStart: false }));
    expect(buttonOf(html, "Start")).not.toContain('disabled=""');
  });

  const withStart = () => {
    const a = addNode(blankDefinition("x"), "start");
    const b = addNode(a.def, "task");
    return { def: b.def, start: a.id, task: b.id };
  };

  test("N5: a link into the added start is refused", () => {
    const { def, start, task } = withStart();
    expect(connect(def, task, start)).toBeNull();
  });

  test("N6: the added start cannot be deleted", () => {
    const { def, start } = withStart();
    expect(removeNode(def, start)).toBeNull();
  });

  test("N7: the menu trigger shows New", () => {
    const html = renderToString(
      createElement(NewProcessMenu, { onPolicy: () => {}, onScratch: () => {} }),
    );
    expect(html).toContain("New");
    expect(html).not.toContain("New from policy");
  });

  test("N8: the fresh dialog holds the title, the text, the name and a disabled Create", () => {
    const html = renderToString(
      createElement(ScratchDialogBody, { onCreated: () => {}, onClose: () => {} }),
    );
    expect(html).toContain("New process from scratch");
    expect(html).toContain(
      "Start with an empty draft. Add the steps with the toolbar, or ask the assistant to build them.",
    );
    expect(html).toContain("Process name");
    expect(buttonOf(html, "Create")).toContain('disabled=""');
  });

  test("N9: a name of spaces only, or a running request, disables Create", () => {
    expect(canCreate("   ", false)).toBe(false);
    expect(canCreate("Car loan", true)).toBe(false);
    expect(canCreate("Car loan", false)).toBe(true);
  });

  test("N10: the top bar shows New, not New from policy", () => {
    const html = renderToString(createElement(TopBar, { def: blankDefinition("Car loan") }));
    expect(html).toContain("New</button>");
    expect(html).not.toContain("New from policy");
  });
});
