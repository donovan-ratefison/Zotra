// The case header test rows: the stepper and deadline model (T, D, U)
// and the rendered header of the case screen (R).

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import seedJson from "../../../internal/store/seed/example-process.json";
import type { CaseEvent, CaseState, UserDTO } from "../studio/case-api";
import type { ProcessDefinition } from "../studio/types";
import { upcomingIds, upcomingOf } from "../studio/TimelineBar";
import { deadlineOf, stepperOf } from "./case-header";
import { CaseScreen } from "./CaseScreen";

const def = seedJson as ProcessDefinition;
const node = (id: string) => def.nodes.find((n) => n.id === id)!;
const ev = (seq: number, type: string, at: string, payload: Record<string, unknown>): CaseEvent => ({
  case_id: "c1", seq, type, at, actor: "system", payload, prev_hash: "", hash: "",
});
const S = (nodeId: string, status: "open" | "closed", over: Partial<CaseState> = {}): CaseState => ({
  case_id: "c1", version_id: "v1", status, result: status === "closed" ? "refused" : "", node_id: nodeId,
  assignee: "", data: { client_name: "Hery Rabe", amount: 150000 }, seq: 1, prev_hash: "", ...over,
});
const entered = (ids: string[], at = "2026-10-30T05:00:00Z") =>
  ids.map((id, i) => ev(i + 1, "step_entered", at, { node_id: id }));
const marks = (items: { id: string; mark: string }[]) => items.map((i) => `${i.id}:${i.mark}`).join(" ");

const T1 = "start:done entry:current complete:next analysis:next threshold:next offer:next signing:next release:next released:next";
const now = Date.parse("2026-10-31T12:00:00Z");

describe("case header model", () => {
  test("T1: a new case shows start done, entry current, the path next", () => {
    expect(marks(stepperOf(def, entered(["entry"]), S("entry", "open")))).toBe(T1);
  });
  test("T2: a node entered twice keeps its first place", () => {
    const events = entered(["entry", "complete", "analysis", "threshold", "decision", "analysis"]);
    expect(marks(stepperOf(def, events, S("analysis", "open")))).toBe(
      "start:done entry:done complete:done analysis:current threshold:done decision:done offer:next signing:next release:next released:next",
    );
  });
  test("T3: a closed case has only done steps", () => {
    const events = entered(["entry", "complete", "analysis", "refused"]);
    expect(marks(stepperOf(def, events, S("refused", "closed")))).toBe(
      "start:done entry:done complete:done analysis:done refused:done",
    );
  });
  test("T4: a node outside the definition is dropped", () => {
    expect(marks(stepperOf(def, entered(["entry", "ghost"]), S("entry", "open")))).toBe(T1);
  });
  test("T5: with no events the current step is appended", () => {
    expect(marks(stepperOf(def, [], S("entry", "open")))).toBe(T1);
  });
  test("T6: the labels are the node names", () => {
    const items = stepperOf(def, entered(["entry"]), S("entry", "open"));
    expect(items[0]!.label).toBe("Application received");
    expect(items.at(-1)!.label).toBe("Loan released");
  });

  test("D1: 31 h of a 48 h deadline is warn", () => {
    const events = entered(["analysis"]);
    expect(deadlineOf(events, node("analysis"), S("analysis", "open"), now)).toEqual({
      due: "1 Nov, 05:00", spent: "31 h of 48 h", tone: "warn",
    });
  });
  test("D2: 31 h of a 24 h deadline is late", () => {
    expect(deadlineOf(entered(["entry"]), node("entry"), S("entry", "open"), now)).toEqual({
      due: "31 Oct, 05:00", spent: "31 h of 24 h", tone: "late",
    });
  });
  test("D3: 1 h of a 48 h deadline is ok", () => {
    const events = entered(["analysis"], "2026-10-31T11:00:00Z");
    expect(deadlineOf(events, node("analysis"), S("analysis", "open"), now)).toEqual({
      due: "2 Nov, 11:00", spent: "1 h of 48 h", tone: "ok",
    });
  });
  test("D4: a node with no deadline gives null", () => {
    expect(deadlineOf(entered(["complete"]), node("complete"), S("complete", "open"), now)).toBeNull();
  });
  test("D5: a closed case gives null", () => {
    expect(deadlineOf(entered(["analysis"]), node("analysis"), S("analysis", "closed"), now)).toBeNull();
  });
  test("D6: no node gives null", () => {
    expect(deadlineOf(entered(["analysis"]), undefined, S("analysis", "open"), now)).toBeNull();
  });
  test("D7: no step_entered for the node gives null", () => {
    expect(deadlineOf(entered(["entry"]), node("analysis"), S("analysis", "open"), now)).toBeNull();
  });

  test("U1: upcomingIds gives the ids, upcomingOf their names", () => {
    const ids = ["complete", "analysis", "threshold", "offer", "signing", "release", "released"];
    expect(upcomingIds(def, S("entry", "open"))).toEqual(ids);
    expect(upcomingOf(def, S("entry", "open"))).toEqual(ids.map((id) => node(id).name));
  });
});

const users: UserDTO[] = [
  { id: "u-advisor", name: "Demo Advisor", role_ids: ["advisor"] },
  { id: "u-analyst", name: "Demo Analyst", role_ids: ["analyst"] },
  { id: "u-backoffice", name: "Demo Back-office", role_ids: ["backoffice"] },
  { id: "u-director", name: "Demo Director", role_ids: ["director"] },
  { id: "u-legal", name: "Demo Legal Officer", role_ids: ["legal"] },
];

const versionSeed = {
  id: "v1", process_id: "p1", parent_id: null, number: 1, label: "Initial", status: "published",
  created_at: "2026-10-27T09:00:00Z", frozen_at: "2026-10-27T09:30:00Z", definition: def,
};
const caseRow = {
  id: "c1", version_id: "v1", reference: "CASE-2026-0001", is_test: false, created_at: "2026-10-30T05:00:00Z",
};

// renderCase renders the case screen with the caches seeded. With
// events undefined the events query pends.
function renderCase(state: CaseState, events: CaseEvent[] | undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["version", "v1"], versionSeed);
  client.setQueryData(["case", "c1"], { case: caseRow, state });
  if (events !== undefined) client.setQueryData(["events", "c1"], events);
  client.setQueryData(["documents", "c1"], []);
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(CaseScreen, { userId: "u-advisor", caseId: "c1", users, onBack: () => {} }),
    ),
  );
}

const stepsOf = (html: string) => html.slice(html.indexOf('aria-label="Steps"'), html.indexOf("</ol>"));
const liCount = (html: string) => stepsOf(html).split("<li").length - 1;
const entryOpen = [ev(1, "step_entered", "2026-10-30T05:00:00Z", { node_id: "entry" })];

describe("case header render", () => {
  test("R1: the stepper has 9 steps and marks Application entry as current", () => {
    const html = renderCase(S("entry", "open"), entryOpen);
    expect(html).toContain('aria-label="Steps"');
    expect(liCount(html)).toBe(9);
    expect(html.split('aria-current="step"').length - 1).toBe(1);
    const current = html.slice(html.indexOf('aria-current="step"'));
    expect(current.slice(0, current.indexOf("</li>"))).toContain("Application entry");
  });
  test("R2: the header shows the deadline and the time spent", () => {
    const html = renderCase(S("entry", "open"), entryOpen);
    expect(html).toContain("Deadline");
    expect(html).toContain("31 Oct, 05:00");
    expect(html).toContain("Time spent");
    expect(html).toMatch(/\d+ h of 24 h/);
  });
  test("R3: a closed case has no current step and no time spent", () => {
    const events = entered(["entry", "complete", "analysis", "refused"]);
    const html = renderCase(S("refused", "closed"), events);
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain("Time spent");
    expect(liCount(html)).toBe(5);
  });
  test("R4: a gateway step has no time spent", () => {
    const html = renderCase(S("complete", "open"), entered(["entry", "complete"]));
    expect(html).not.toContain("Time spent");
  });
  test("R5: pending events give the stepper and no time spent", () => {
    const html = renderCase(S("entry", "open"), undefined);
    expect(liCount(html)).toBe(9);
    expect(html).not.toContain("Time spent");
  });
  test("R6: the page uses the wide container", () => {
    const html = renderCase(S("entry", "open"), entryOpen);
    expect(html).toContain("max-w-[1120px]");
    expect(html).not.toContain("max-w-[720px]");
  });
});
