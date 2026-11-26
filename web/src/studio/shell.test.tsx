// The test rows of the case version pin (the caseVersionUrl helper)
// and of the phone layout of the design view (paneClasses and the
// pane tabs). The environment is node: direct calls, and
// renderToString for the shell.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { caseVersionUrl, paneClasses, StudioShell } from "./StudioShell";
import { useStudioStore } from "./store";
import type { ProcessDefinition, VersionSummary } from "./types";
import seedJson from "../../../internal/store/seed/example-process.json";

describe("caseVersionUrl", () => {
  test("1: the four parameters, in order, plain ids", () => {
    expect(caseVersionUrl("p1", "v1", "c1")).toBe(
      "/?process=p1&version=v1&mode=test&case=c1",
    );
  });

  test("2: the three ids are percent-encoded", () => {
    expect(caseVersionUrl("p 1", "v/1", "c 1")).toBe(
      "/?process=p%201&version=v%2F1&mode=test&case=c%201",
    );
  });

  test("3: the answer starts with /?process= and holds the four parameters in the order process, version, mode, case", () => {
    const url = caseVersionUrl("p1", "v1", "c1");
    expect(url.startsWith("/?process=")).toBe(true);
    const order = [
      url.indexOf("process="),
      url.indexOf("version="),
      url.indexOf("mode=test"),
      url.indexOf("case="),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("paneClasses", () => {
  const hidden = "max-md:hidden";

  test("P1: the diagram pane shows, chat and aside are hidden", () => {
    const c = paneClasses("diagram");
    expect(c.diagram).not.toContain(hidden);
    expect(c.diagram).toContain("max-md:flex");
    expect(c.chat).toContain(hidden);
    expect(c.aside).toContain(hidden);
  });

  test("P2: only the chat pane shows", () => {
    const c = paneClasses("assistant");
    expect(c.chat).not.toContain(hidden);
    expect(c.chat).toContain("max-md:flex-1");
    expect(c.diagram).toContain(hidden);
    expect(c.aside).toContain(hidden);
  });

  test("P3: only the aside pane shows", () => {
    const c = paneClasses("step");
    expect(c.aside).not.toContain(hidden);
    expect(c.diagram).toContain(hidden);
    expect(c.chat).toContain(hidden);
  });

  test("P4: every class has a max-md variant, so the md layout stays", () => {
    for (const pane of ["diagram", "assistant", "step"] as const) {
      for (const cls of Object.values(paneClasses(pane)).join(" ").split(" ")) {
        expect(cls.startsWith("max-md:")).toBe(true);
      }
    }
  });
});

describe("design stage on a phone screen", () => {
  const version: VersionSummary = {
    id: "v1",
    process_id: "p1",
    parent_id: null,
    number: 1,
    label: "Draft 1",
    status: "draft",
    created_at: "2026-10-27T12:00:00Z",
    frozen_at: null,
  };

  test("P5: the design stage has the pane tabs and the desktop note", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["processes"], [
      { id: "p1", name: "Home loan", created_at: "2026-10-27T09:00:00Z" },
    ]);
    client.setQueryData(["versions", "p1"], [version]);
    client.setQueryData(["version", "v1"], {
      ...version,
      definition: seedJson as unknown as ProcessDefinition,
    });
    useStudioStore.setState({ selectedNodeId: null, mode: "design" });
    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ReactFlowProvider, null, createElement(StudioShell)),
      ),
    );
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Studio panes"|aria-label="Studio panes"[^>]*role="tablist"/);
    expect(html).toContain("Best on a desktop screen");
    expect(html).toMatch(/aria-selected="true"[^>]*>Diagram</);
    expect(html).toMatch(/aria-selected="false"[^>]*>Assistant</);
    expect(html).toMatch(/aria-selected="false"[^>]*>Step</);
    expect(html).toContain("md:w-[var(--aside-w)]");
    expect(html).toContain("--aside-w:380px");
  });
});
