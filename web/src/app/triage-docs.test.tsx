// The documents dialog test rows B1 to B7, in order. The environment
// is node: renderToString of the body with pre-seeded caches.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import seedJson from "../../../internal/store/seed/example-process.json";
import { ApiError } from "../studio/api";
import type { ProcessDefinition } from "../studio/types";
import { TriageDocumentsBody } from "./TriageDocuments";

const def = seedJson as ProcessDefinition;
const node = (id: string) => def.nodes.find((n) => n.id === id)!;
const sha = "3b91f0" + "0".repeat(52) + "a1c7e3";
const idDoc = { id: "d1", case_id: "c1", name: "ID card.png", mime: "image/png", sha256: sha, created_at: "2026-10-28T10:00:00Z" };
const rows = [
  { name: "ID card", scan: idDoc },
  { name: "Salary slips", scan: null },
];
const zone = { label: "signature", box: { x: 52, y: 436, width: 236, height: 84 } };

function render(
  over: { index?: number; zonesShown?: boolean; nodeId?: string } = {},
  seed: (c: QueryClient) => void = () => {},
): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  seed(client);
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(TriageDocumentsBody, {
        reference: "CASE-2026-0001",
        client: "Hery Rasolofo",
        node: node(over.nodeId ?? "analysis"),
        events: [],
        rows,
        index: over.index ?? 0,
        onIndex: () => {},
        zonesShown: over.zonesShown ?? true,
        onZonesShown: () => {},
        onClose: () => {},
      }),
    ),
  );
}

const zones = (z: unknown[]) => (c: QueryClient) => c.setQueryData(["zones", "d1"], z);

describe("triage documents dialog", () => {
  test("B1: a scan with one zone", () => {
    const html = render({}, zones([zone]));
    for (const text of [
      "ID card",
      "CASE-2026-0001 · Hery Rasolofo",
      "1 of 2 attached",
      'src="/api/documents/d1/bytes"',
      "Signature found",
      "This document passes the check.",
      "sha256 3b91f0…a1c7e3",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/aria-pressed="true"[^>]*>Zones shown</);
    expect(html).toContain('aria-label="About the document check"');
    for (const text of ["SAM 3.1", "A participant attaches the scan", "You cannot close the step yet."]) {
      expect(html).not.toContain(text);
    }
  });

  test("B2: pending zones", () => {
    expect(render()).toContain("Detecting the zones...");
  });

  test("B3: a zone error", () => {
    const html = render({}, (c) =>
      c
        .getQueryCache()
        .build(c, { queryKey: ["zones", "d1"] })
        .setState({ status: "error", error: new ApiError(503, "ai_unavailable", "ai_unavailable text", []), fetchStatus: "idle" }),
    );
    expect(html).toContain("The zones did not load: ai_unavailable text");
  });

  test("B4: no zone", () => {
    expect(render({}, zones([]))).toContain("The document model found no zone on this scan.");
  });

  test("B5: a missing document", () => {
    const html = render({ index: 1 });
    expect(html).toContain("Missing");
    expect(html).toContain("No scan for Salary slips on this case.");
    expect(html).not.toContain("<img");
    expect(html).toContain("This document is missing.");
    expect(html).not.toContain("You cannot close the step yet.");
  });

  test("B6: zones hidden keep the zone rows", () => {
    const html = render({ zonesShown: false }, zones([zone]));
    expect(html).toContain("Signature found");
    expect(html).not.toContain("border-2 border-primary");
  });

  test("B7: an unsigned step", () => {
    const html = render({ nodeId: "decision" }, zones([zone]));
    expect(html).toContain("The step cannot close until it is signed.");
    expect(html).toContain(">You cannot close the step yet.<");
    expect(html).not.toContain("Rules and humans decide");
  });
});
