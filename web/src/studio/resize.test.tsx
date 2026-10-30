// The test rows of the panel resize fix: the size helpers, the handle
// attributes, the policy maximize button and the chat list height.
// The environment is node: renderToString for the components.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { clampSize, keyResize, ResizeHandle } from "./resize";
import { PolicyPanel } from "./PolicyPanel";
import { ChatPanelView } from "./AssistantChat";

const noop = () => {};

describe("panel resize", () => {
  test("51a: clampSize keeps the value in the range", () => {
    expect(clampSize(0.5, 0.15, 0.85)).toBe(0.5);
    expect(clampSize(0.9, 0.15, 0.85)).toBe(0.85);
    expect(clampSize(0.1, 0.15, 0.85)).toBe(0.15);
  });

  test("51b: a non-finite value gives the minimum", () => {
    expect(clampSize(NaN, 0.15, 0.85)).toBe(0.15);
    expect(clampSize(Infinity, 0.15, 0.85)).toBe(0.15);
  });

  test("51c: up and left grow the panel", () => {
    expect(keyResize("ArrowUp", 380, 20, 300, 640)).toBe(400);
    expect(keyResize("ArrowLeft", 380, 20, 300, 640)).toBe(400);
  });

  test("51d: down and right shrink the panel", () => {
    expect(keyResize("ArrowDown", 380, 20, 300, 640)).toBe(360);
    expect(keyResize("ArrowRight", 380, 20, 300, 640)).toBe(360);
  });

  test("51e: Home and End give the limits, a step stops at the max", () => {
    expect(keyResize("Home", 380, 20, 300, 640)).toBe(640);
    expect(keyResize("End", 380, 20, 300, 640)).toBe(300);
    expect(keyResize("ArrowUp", 630, 20, 300, 640)).toBe(640);
  });

  test("51f: another key gives null", () => {
    expect(keyResize("Enter", 380, 20, 300, 640)).toBeNull();
  });

  const handle = (orientation: "horizontal" | "vertical", value: number) =>
    renderToString(
      createElement(ResizeHandle, {
        orientation,
        label: "Resize the policy panel",
        value,
        min: 0,
        max: 1000,
        step: 1,
        onResize: noop,
        measure: () => value,
      }),
    );

  test("51g: a horizontal handle has the separator attributes", () => {
    const html = handle("horizontal", 0.4);
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('aria-valuenow="0.4"');
    expect(html).toContain('aria-label="Resize the policy panel"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("cursor-row-resize");
  });

  test("51h: a vertical handle resizes columns", () => {
    const html = handle("vertical", 380);
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain("cursor-col-resize");
  });

  const policy = (props: object) =>
    renderToString(
      createElement(PolicyPanel, { file: null, highlight: [], ...props }),
    );

  test("51i: the policy header shows Maximize", () => {
    expect(policy({ onToggleMaximize: noop, maximized: false })).toContain(
      'aria-label="Maximize the policy"',
    );
  });

  test("51j: a maximized policy shows Restore", () => {
    expect(policy({ onToggleMaximize: noop, maximized: true })).toContain(
      'aria-label="Restore the policy"',
    );
  });

  test("51k: no toggle prop, no button", () => {
    const html = policy({});
    expect(html).not.toContain("Maximize the policy");
    expect(html).not.toContain("Restore the policy");
  });

  test("51l: the chat list uses listHeight", () => {
    const html = renderToString(
      createElement(ChatPanelView, {
        state: { turns: [], notice: null },
        // The view reads the status and the number only.
        version: { status: "draft", number: 1 } as never,
        collapsed: false,
        listHeight: 300,
      }),
    );
    expect(html).toContain("max-height:300px");
  });
});
