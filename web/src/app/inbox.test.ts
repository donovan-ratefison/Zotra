import { describe, expect, test } from "vitest";
import seedJson from "../../../internal/store/seed/example-process.json";
import type { CaseEvent } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import { inTab, matchesSearch, originOf, tabCounts, type InboxItem } from "./inbox";

const def = seedJson as ProcessDefinition;
const ev = (seq: number, type: string, at: string, payload: Record<string, unknown>): CaseEvent => ({
  case_id: "c1", seq, type, at, actor: "system", payload, prev_hash: "", hash: "",
});
const entered = (...ids: string[]) =>
  [ev(0, "case_created", "2026-10-28T08:00:00Z", {})].concat(
    ids.map((id, i) => ev(i + 1, "step_entered", "2026-10-28T08:00:00Z", { node_id: id })),
  );

const A: InboxItem = { id: "a", reference: "CASE-2026-0010", client: "Hery Rabe", assignee: "u-analyst", msLeft: -1 };
const B: InboxItem = { id: "b", reference: "CASE-2026-0011", client: "Lova Rabe", assignee: "", msLeft: 5 };
const C: InboxItem = { id: "c", reference: "CASE-2026-0012", client: "Tiana", assignee: "u-other", msLeft: null };
const D: InboxItem = { id: "d", reference: "CASE-2026-0002", client: null, assignee: null, msLeft: null };

describe("inbox tabs and search", () => {
  test("I1: tabCounts counts each tab", () => {
    expect(tabCounts([A, B, C, D], "u-analyst")).toEqual({ all: 4, mine: 1, free: 1, late: 1 });
  });

  test("I2: a pending item is in no tab but All", () => {
    for (const t of ["mine", "free", "late"] as const) {
      expect(inTab(D, t, "u-analyst")).toBe(false);
    }
  });

  test("I3: the search matches the reference and the client, any case", () => {
    for (const q of ["0010", " hery ", "RABE"]) {
      expect(matchesSearch(A, q)).toBe(true);
    }
  });

  test("I4: a text that is in no field does not match", () => {
    expect(matchesSearch(A, "lova")).toBe(false);
  });

  test("I5: a pending item matches on its reference only", () => {
    expect(matchesSearch(D, "case")).toBe(true);
    expect(matchesSearch(D, "x")).toBe(false);
  });

  test("I6: an empty search matches", () => {
    expect(matchesSearch(A, "")).toBe(true);
    expect(matchesSearch(A, "  ")).toBe(true);
  });
});

describe("inbox origin", () => {
  test("O1: one entry into the node gives New", () => {
    expect(originOf(def, entered("entry", "complete", "analysis"), "analysis")).toBe("New");
  });

  test("O2: a second entry names the last task before it", () => {
    expect(
      originOf(def, entered("entry", "complete", "analysis", "threshold", "decision", "analysis"), "analysis"),
    ).toBe("Returned from Credit decision");
  });

  test("O3: with no other task before, Returned", () => {
    expect(originOf(def, entered("entry", "complete", "entry"), "entry")).toBe("Returned");
  });

  test("O4: no entry into the node gives null", () => {
    expect(originOf(def, entered("entry", "complete"), "analysis")).toBeNull();
  });
});
