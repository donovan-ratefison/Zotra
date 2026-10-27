// Vitest table test of buildSelector. The 10 rows. No DOM: the
// function is pure.
import { describe, expect, test } from "vitest";
import { buildSelector, type SelectorStep } from "./selector";

describe("buildSelector", () => {
  test.each([
    { n: 1, steps: [] as SelectorStep[], want: "" },
    { n: 2, steps: [{ tag: "div", id: null, testId: null, nth: 1 }], want: "div" },
    {
      n: 3,
      steps: [{ tag: "div", id: null, testId: null, nth: 2 }],
      want: "div:nth-of-type(2)",
    },
    {
      n: 4,
      steps: [
        { tag: "div", id: null, testId: null, nth: 2 },
        { tag: "section", id: "main", testId: null, nth: 1 },
      ],
      want: "div:nth-of-type(2) > #main",
    },
    {
      n: 5,
      steps: [
        { tag: "div", id: null, testId: null, nth: 1 },
        { tag: "button", id: null, testId: "send", nth: 1 },
      ],
      want: 'div > [data-testid="send"]',
    },
    {
      n: 6,
      steps: [
        { tag: "span", id: null, testId: null, nth: 3 },
        { tag: "div", id: null, testId: null, nth: 2 },
        { tag: "section", id: "main", testId: null, nth: 1 },
        { tag: "main", id: null, testId: null, nth: 1 },
      ],
      want: "span:nth-of-type(3) > div:nth-of-type(2) > #main",
    },
    {
      n: 7,
      steps: [
        { tag: "p", id: null, testId: null, nth: 1 },
        { tag: "div", id: null, testId: null, nth: 1 },
        { tag: "span", id: null, testId: null, nth: 1 },
        { tag: "section", id: null, testId: null, nth: 1 },
        { tag: "main", id: null, testId: null, nth: 1 },
        { tag: "body", id: null, testId: null, nth: 1 },
        { tag: "html", id: null, testId: null, nth: 1 },
      ],
      want: "p > div > span > section > main",
    },
    {
      n: 8,
      steps: [{ tag: "div", id: "x", testId: "t", nth: 1 }],
      want: '[data-testid="t"]',
    },
    {
      n: 9,
      steps: [{ tag: "section", id: "main", testId: null, nth: 2 }],
      want: "#main",
    },
    {
      n: 10,
      steps: [{ tag: "section", id: null, testId: "grid", nth: 3 }],
      want: '[data-testid="grid"]',
    },
  ])("row $n gives $want", ({ steps, want }) => {
    expect(buildSelector(steps)).toBe(want);
  });
});
