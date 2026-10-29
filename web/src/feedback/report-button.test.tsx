// The rows of the report button brief: the idle trigger is one
// 24 x 24 icon fixed in the bottom-right corner, with the name in
// the attributes and no Report text node.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ReportTrigger } from "./ReportButton";

function triggerHtml(): string {
  return renderToString(createElement(ReportTrigger, { onClick: () => {} }));
}

describe("ReportTrigger", () => {
  test("renders the fixed icon button with its accessible names", () => {
    const html = triggerHtml();
    expect(html).toContain('data-testid="report-button"');
    expect(html).toContain('aria-label="Report"');
    expect(html).toContain('title="Report"');
    expect(html).toContain("fixed bottom-1 right-1 z-50");
    expect(html).toContain("<svg");
  });

  test("keeps no old corner class and no Report text node", () => {
    const html = triggerHtml();
    expect(html).not.toContain("bottom-4");
    expect(html).not.toContain("right-4");
    expect(html).not.toContain(">Report<");
  });
});
