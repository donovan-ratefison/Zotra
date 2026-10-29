// The test rows of the case version pin: the caseVersionUrl helper
// of the shell. The environment is node, direct calls, no component
// render (the patterns of the approved lots).

import { describe, expect, test } from "vitest";
import { caseVersionUrl } from "./StudioShell";

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
