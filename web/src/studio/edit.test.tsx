// The test rows of the manual diagram edits: the pure functions of
// edit.tsx and the toolbar.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import seedJson from "../../../internal/store/seed/example-process.json";
import {
  addNode,
  connect,
  EditToolbar,
  newEdgeId,
  newNodeId,
  removeEdge,
  removeNode,
} from "./edit";
import type { ProcessDefinition } from "./types";

const base = seedJson as ProcessDefinition;

// The seed with the task "entry" given the decisions a and b, and
// its link e02 holding decision a. extra edges come after.
function withDecisions(extra: ProcessDefinition["edges"] = []): ProcessDefinition {
  return {
    ...base,
    nodes: base.nodes.map((n) => (n.id === "entry" ? { ...n, decisions: ["a", "b"] } : n)),
    edges: [
      ...base.edges.map((e) => (e.id === "e02" ? { ...e, decision: "a" } : e)),
      ...extra,
    ],
  };
}

describe("new ids", () => {
  test("124-1: the first task id is task_1", () => {
    expect(newNodeId(base, "task")).toBe("task_1");
  });

  test("124-2: a held task_1 gives task_2", () => {
    const def = addNode(base, "task").def;
    expect(def.nodes.at(-1)!.id).toBe("task_1");
    expect(newNodeId(def, "task")).toBe("task_2");
  });

  test("124-3: the seed edges e01 to e14 give e15", () => {
    expect(newEdgeId(base)).toBe("e15");
  });
});

describe("addNode", () => {
  test("124-4: an end gets every field and the base stays unchanged", () => {
    const copy = structuredClone(base);
    const r = addNode(base, "end");
    expect(r.id).toBe("end_1");
    expect(r.def.nodes).toHaveLength(12);
    expect(r.def.nodes.at(-1)).toEqual({
      id: "end_1",
      type: "end",
      name: "New end",
      role: null,
      deadline_hours: null,
      documents: [],
      signature: false,
      checks: [],
      decisions: [],
      end_result: "approved",
      scope_overrides: [],
      source_ids: [],
      citations: [],
    });
    expect(base).toEqual(copy);
  });

  test("124-5: a gateway has no end result", () => {
    const last = addNode(base, "gateway").def.nodes.at(-1)!;
    expect(last.type).toBe("gateway");
    expect(last.end_result).toBeNull();
    expect(last.name).toBe("New gateway");
  });
});

describe("connect", () => {
  test("124-6: a valid link appends one edge e15", () => {
    const next = connect(base, "release", "refused")!;
    expect(next.edges).toHaveLength(15);
    expect(next.edges.at(-1)).toEqual({
      id: "e15",
      from: "release",
      to: "refused",
      label: null,
      decision: null,
      condition: null,
      is_default: false,
    });
  });

  test("124-7: a link to the same node is refused", () => {
    expect(connect(base, "analysis", "analysis")).toBeNull();
  });

  test("124-8: unknown ids are refused, source cards included", () => {
    expect(connect(base, "ghost", "refused")).toBeNull();
    expect(connect(base, "release", "source:blacklist")).toBeNull();
  });

  test("124-9: a link out of an end is refused", () => {
    expect(connect(base, "released", "entry")).toBeNull();
  });

  test("124-10: a link into the start is refused", () => {
    expect(connect(base, "entry", "start")).toBeNull();
  });

  test("124-11: a duplicate link is refused", () => {
    expect(connect(base, "start", "entry")).toBeNull();
  });

  test("124-12: the first free decision goes on the new link", () => {
    const next = connect(withDecisions(), "entry", "refused")!;
    expect(next.edges.at(-1)!.decision).toBe("b");
  });

  test("124-13: with every decision used, the new link has none", () => {
    const def = withDecisions([
      { id: "e99", from: "entry", to: "offer", label: null, decision: "b", condition: null, is_default: false },
    ]);
    const next = connect(def, "entry", "refused")!;
    expect(next.edges.at(-1)!.decision).toBeNull();
  });

  test("124-14: the first link of a new gateway is the default", () => {
    const one = connect(addNode(base, "gateway").def, "gateway_1", "refused")!;
    const two = connect(one, "gateway_1", "released")!;
    expect(two.edges.at(-2)!.is_default).toBe(true);
    expect(two.edges.at(-1)!.is_default).toBe(false);
  });
});

describe("remove", () => {
  test("124-15: removeNode drops the node and its edges", () => {
    const next = removeNode(base, "analysis")!;
    expect(next.nodes).toHaveLength(10);
    expect(next.edges.some((e) => e.from === "analysis" || e.to === "analysis")).toBe(false);
  });

  test("124-16: the start and unknown ids are kept", () => {
    expect(removeNode(base, "start")).toBeNull();
    expect(removeNode(base, "ghost")).toBeNull();
    expect(removeEdge(base, "ghost").edges).toHaveLength(14);
  });
});

describe("EditToolbar", () => {
  test("124-17: the toolbar shows Add, Task, Gateway and End, no Start", () => {
    const html = renderToString(createElement(EditToolbar, { onAdd: () => {} }));
    expect(html).toContain('role="toolbar"');
    for (const text of ["Add", "Task", "Gateway", "End"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Start");
  });
});
