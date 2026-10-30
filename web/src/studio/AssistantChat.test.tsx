// The test rows of the assistant chat: the pure transition, the
// stateless view, the two async helpers and the per-element proposed
// flags of the diagram. The environment is node: renderToString for
// the components, no DOM events, and the IO of the helpers is
// stubbed through their last parameter.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ApiError } from "./api";
import { TaskCard } from "./diagram";
import {
  ChatPanelView,
  acceptProposal,
  chatEvent,
  readRestateFirst,
  requestChange,
  requestRestate,
  type ChatState,
} from "./AssistantChat";
import { diffChips, diffDefinitions } from "./diff";
import type { ProcessDefinition, Version } from "./types";

// The mini definition fixture of the approved 2.2 brief, with all
// fields. Local copy: every test file keeps its fixtures local.
const miniDefinition: ProcessDefinition = {
  schema_version: "1",
  name: "Mini loan",
  currency: "EUR",
  policy_document_id: null,
  theme: { brand_name: "Mini Bank", primary_color: "#0f4c45", logo_url: null },
  roles: [{ id: "advisor", name: "Advisor", department: "Branch" }],
  fields: [
    { name: "amount", label: "Amount", type: "money", options: [], computed: null },
  ],
  scope: [{ field: "amount", role: "advisor", access: "write" }],
  nodes: [
    {
      id: "start", type: "start", name: "Application received", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "entry", type: "task", name: "Application entry", role: "advisor",
      deadline_hours: 24, documents: [], signature: false, checks: [],
      decisions: [], end_result: null, scope_overrides: [], source_ids: [],
      citations: [],
    },
    {
      id: "released", type: "end", name: "Loan released", role: null,
      deadline_hours: null, documents: [], signature: false, checks: [],
      decisions: [], end_result: "approved", scope_overrides: [],
      source_ids: [], citations: [],
    },
  ],
  edges: [
    { id: "e1", from: "start", to: "entry", label: null, decision: null, condition: null, is_default: false },
    { id: "e2", from: "entry", to: "released", label: null, decision: null, condition: null, is_default: false },
  ],
  sources: [],
};

// changedDefinition is miniDefinition with one new task, so the diff
// holds one row and one chip.
function changedDefinition(): ProcessDefinition {
  const def: ProcessDefinition = JSON.parse(JSON.stringify(miniDefinition));
  def.nodes.splice(2, 0, {
    id: "expert", type: "task", name: "Expert review", role: "advisor",
    deadline_hours: 72, documents: [], signature: false, checks: [],
    decisions: [], end_result: null, scope_overrides: [], source_ids: [],
    citations: [],
  });
  def.edges.splice(1, 0, {
    id: "e3", from: "expert", to: "released", label: null, decision: null,
    condition: null, is_default: false,
  });
  return next2(def);
}

// next2 renames the entry step too, so the diff holds a modify row.
function next2(def: ProcessDefinition): ProcessDefinition {
  def.nodes.find((n) => n.id === "entry")!.name = "Application intake";
  return def;
}

function versionOf(status: Version["status"], number: number): Version {
  return {
    id: "v-1",
    process_id: "p-1",
    parent_id: null,
    number,
    label: "Chat demo",
    status,
    created_at: "2026-10-30T06:00:00Z",
    frozen_at: null,
    definition: miniDefinition,
  };
}
const draftVersion = versionOf("draft", 2);
const publishedVersion = versionOf("published", 1);

const EMPTY: ChatState = { turns: [], notice: null };
// The base state of the answer and error rows: the request was sent.
const sent = chatEvent(EMPTY, { type: "send", text: "add a deadline" });
// The base state of the accept and reject rows: a proposal is on.
const proposed = chatEvent(sent, {
  type: "answer",
  base: miniDefinition,
  next: changedDefinition(),
});

function renderChat(state: ChatState, version: Version, collapsed = false) {
  return renderToString(
    createElement(ChatPanelView, { state, version, collapsed }),
  );
}

describe("chatEvent", () => {
  test("send appends the user turn and the waiting turn", () => {
    expect(sent.turns.at(-2)).toEqual({
      kind: "user", text: "add a deadline", chips: [], rows: [], details: [],
    });
    expect(sent.turns.at(-1)).toEqual({
      kind: "waiting", text: "Thinking...", chips: [], rows: [], details: [],
    });
  });

  test("answer with a changed next makes the proposal turn", () => {
    const next = changedDefinition();
    const state = chatEvent(sent, { type: "answer", base: miniDefinition, next });
    const diff = diffDefinitions(miniDefinition, next);
    expect(state.turns.at(-1)).toEqual({
      kind: "proposal",
      text: "Proposal ready, in dashed violet on the diagram.",
      chips: diffChips(diff.counts),
      rows: diff.rows,
      details: [],
    });
  });

  test("answer with an equal next finds no change", () => {
    const state = chatEvent(sent, {
      type: "answer", base: miniDefinition, next: miniDefinition,
    });
    expect(state.turns.at(-1)).toEqual({
      kind: "none",
      text: "The AI found no change to make.",
      chips: [], rows: [], details: [],
    });
  });

  test("error 503 gives the not-available text", () => {
    const state = chatEvent(sent, {
      type: "error", status: 503, message: "The AI layer is off.", details: [],
    });
    expect(state.turns.at(-1)).toEqual({
      kind: "error",
      text: "The AI is not available. You can still edit the process by hand.",
      chips: [], rows: [], details: [],
    });
  });

  test("error 422 gives the invalid-output text and the first 3 details", () => {
    const state = chatEvent(sent, {
      type: "error", status: 422, message: "failed",
      details: ["d1", "d2", "d3", "d4"],
    });
    expect(state.turns.at(-1)).toEqual({
      kind: "error",
      text: "The AI could not propose a valid process. Try another wording.",
      chips: [], rows: [], details: ["d1", "d2", "d3"],
    });
  });

  test("error 500 gives the request-failed text", () => {
    const state = chatEvent(sent, {
      type: "error", status: 500, message: "boom", details: [],
    });
    expect(state.turns.at(-1)).toEqual({
      kind: "error", text: "The request failed: boom",
      chips: [], rows: [], details: [],
    });
  });

  test("accept-ok turns the proposal accepted with the version number", () => {
    const state = chatEvent(proposed, { type: "accept-ok", versionNumber: 2 });
    expect(state.turns.at(-1)).toEqual({
      kind: "accepted",
      text: "Accepted. The change is in the draft of v2.",
      chips: [], rows: [], details: [],
    });
  });

  test("accept-stale turns the proposal into the stale error", () => {
    const state = chatEvent(proposed, { type: "accept-stale" });
    expect(state.turns.at(-1)).toEqual({
      kind: "error",
      text: "The draft changed since the request. Ask again.",
      chips: [], rows: [], details: [],
    });
  });

  test("save-failed keeps the proposal and sets the notice", () => {
    const state = chatEvent(proposed, { type: "save-failed" });
    expect(state.notice).toBe("The draft did not save.");
    expect(state.turns.at(-1)!.kind).toBe("proposal");
  });

  test("reject turns the proposal rejected", () => {
    const state = chatEvent(proposed, { type: "reject" });
    expect(state.turns.at(-1)).toEqual({
      kind: "rejected",
      text: "Rejected. The diagram is back to its previous state.",
      chips: [], rows: [], details: [],
    });
  });
});

describe("ChatPanelView", () => {
  test("draft with an empty thread: the composer is open with the hint", () => {
    const html = renderChat(EMPTY, draftVersion);
    expect(html).toContain('aria-label="Message to the AI assistant"');
    expect(html).toContain(
      "Describe a change of the process, for example: add a 12 h deadline to the legal officer",
    );
    expect(html).not.toMatch(/aria-label="Message to the AI assistant"[^>]*disabled/);
  });

  test("published version: the composer is closed with the open-a-draft title", () => {
    const html = renderChat(EMPTY, publishedVersion);
    expect(html).toMatch(/aria-label="Message to the AI assistant"[^>]*disabled/);
    expect(html).toContain("Open a draft to change the process with the AI.");
  });

  test("a waiting turn renders the polite thinking text", () => {
    const html = renderChat(sent, draftVersion);
    expect(html).toContain("Thinking...");
    expect(html).toContain('aria-live="polite"');
  });

  test("a proposal turn renders the text, the chips, the buttons and the AI chrome", () => {
    const html = renderChat(proposed, draftVersion);
    expect(html).toContain("Proposal ready, in dashed violet on the diagram.");
    for (const chip of diffChips(diffDefinitions(miniDefinition, changedDefinition()).counts)) {
      expect(html).toContain(chip);
    }
    expect(html).toContain("Reject");
    expect(html).toContain("Accept");
    expect(html).toContain("See the changes");
    // The AI message chrome: the round violet avatar with Sparkles,
    // in a bordered card.
    expect(html).toContain("lucide-sparkles");
    expect(html).toContain("background-color:#7c3aed");
  });

  test("collapsed with a pending proposal: the chip shows and the thread hides", () => {
    const html = renderChat(proposed, draftVersion, true);
    expect(html).toContain("1 proposal pending");
    expect(html).not.toContain("Thinking...");
    expect(html).not.toContain("Message to the AI assistant");
  });
});

describe("requestChange", () => {
  test("a changed answer maps onto the answer event", async () => {
    const next = changedDefinition();
    const event = await requestChange({
      version: draftVersion,
      def: miniDefinition,
      text: "add an expert review",
      change: async () => ({ definition: next, attempts: 1 }),
    });
    expect(event).toEqual({ type: "answer", base: miniDefinition, next });
  });

  test("an ApiError maps onto the error event with its status", async () => {
    const event = await requestChange({
      version: draftVersion,
      def: miniDefinition,
      text: "add an expert review",
      change: async () => {
        throw new ApiError(503, "ai_unavailable", "The AI layer is off.");
      },
    });
    expect(event).toEqual({
      type: "error",
      status: 503,
      message: "The AI layer is off.",
      details: [],
    });
  });
});

describe("acceptProposal", () => {
  test("a def that differs from the snapshot returns stale without saving", async () => {
    let calls = 0;
    const result = await acceptProposal({
      snapshot: miniDefinition,
      def: changedDefinition(),
      proposal: changedDefinition(),
      version: draftVersion,
      update: async () => {
        calls++;
        return draftVersion;
      },
    });
    expect(result).toBe("stale");
    expect(calls).toBe(0);
  });

  test("the same def saves the proposal and returns ok", async () => {
    const saved: Array<[string, ProcessDefinition]> = [];
    const proposal = changedDefinition();
    const result = await acceptProposal({
      snapshot: miniDefinition,
      def: miniDefinition,
      proposal,
      version: draftVersion,
      update: async (id, definition) => {
        saved.push([id, definition]);
        return draftVersion;
      },
    });
    expect(result).toBe("ok");
    expect(saved).toEqual([[draftVersion.id, proposal]]);
  });

  test("a failed save returns failed", async () => {
    const result = await acceptProposal({
      snapshot: miniDefinition,
      def: miniDefinition,
      proposal: changedDefinition(),
      version: draftVersion,
      update: async () => {
        throw new Error("boom");
      },
    });
    expect(result).toBe("failed");
  });
});

describe("diagram proposed flags", () => {
  const node = miniDefinition.nodes.find((n) => n.id === "entry")!;
  const cardProps = {
    node,
    color: "#2563eb",
    roleName: "Advisor",
    selected: false,
  };

  test("a proposed node carries the badge and data-ghost", () => {
    const html = renderToString(
      createElement(TaskCard, { ...cardProps, proposed: true }),
    );
    expect(html).toContain("Proposed");
    expect(html).toContain('data-ghost="true"');
    expect(html).toContain('stroke-dasharray="5 4"');
    expect(html).toContain('stroke="#7c3aed"');
  });

  test("a node out of the proposal carries no badge", () => {
    const html = renderToString(createElement(TaskCard, { ...cardProps }));
    expect(html).not.toContain("Proposed");
    expect(html).toContain('data-ghost="false"');
  });
});

// The rows of the restate step: C1 to C10.
const restated = chatEvent(sent, { type: "restated", text: "You want to X." });

describe("restate step", () => {
  test("C1: restated replaces the waiting turn", () => {
    expect(restated.turns.at(-1)).toEqual({
      kind: "restate", text: "You want to X.", chips: [], rows: [], details: [],
    });
    expect(restated.turns).toHaveLength(2);
  });

  test("C2: restated after a proposal leaves the state", () => {
    expect(chatEvent(proposed, { type: "restated", text: "x" })).toBe(proposed);
  });

  test("C3: confirm appends the yes turn and the waiting turn", () => {
    const next = chatEvent(restated, { type: "confirm" });
    expect(next.turns.slice(-2)).toEqual([
      { kind: "user", text: "Yes, make the change", chips: [], rows: [], details: [] },
      { kind: "waiting", text: "Thinking...", chips: [], rows: [], details: [] },
    ]);
  });

  test("C4: confirm after a none turn leaves the state", () => {
    const none = chatEvent(restated, { type: "rephrase" });
    expect(chatEvent(none, { type: "confirm" })).toBe(none);
  });

  test("C5: rephrase appends the rephrase turn", () => {
    expect(chatEvent(restated, { type: "rephrase" }).turns.at(-1)).toEqual({
      kind: "none", text: "Rephrase your request below.", chips: [], rows: [], details: [],
    });
  });

  test("C6: rephrase while waiting leaves the state", () => {
    expect(chatEvent(sent, { type: "rephrase" })).toBe(sent);
  });

  test("C7: a last restate turn shows the two buttons", () => {
    const html = renderChat(restated, draftVersion);
    expect(html).toContain("You want to X.");
    expect(html).toContain("Yes, make the change");
    expect(html).toContain("No, rephrase");
  });

  test("C8: a restate turn that is not last has no buttons", () => {
    const html = renderChat(chatEvent(restated, { type: "rephrase" }), draftVersion);
    expect(html).toContain("You want to X.");
    expect(html).not.toContain("Yes, make the change");
    expect(html).not.toContain("No, rephrase");
  });

  test("C9: the header switch shows its state", () => {
    for (const on of [true, false]) {
      const html = renderToString(
        createElement(ChatPanelView, {
          state: EMPTY, version: draftVersion, collapsed: false, restateFirst: on,
        }),
      );
      expect(html).toContain('id="restate-first"');
      expect(html).toContain("Restate first");
      expect(html).toContain(`aria-checked="${on}"`);
    }
  });

  test("C10: only the stored value 0 turns the step off", () => {
    expect(readRestateFirst("0")).toBe(false);
    expect(readRestateFirst("1")).toBe(true);
    expect(readRestateFirst(null)).toBe(true);
    expect(readRestateFirst("x")).toBe(true);
  });

  test("requestRestate maps the answer and an ApiError", async () => {
    expect(
      await requestRestate({
        version: draftVersion,
        text: "add a step",
        restate: async () => ({ restatement: "You want to add a step." }),
      }),
    ).toEqual({ type: "restated", text: "You want to add a step." });
    const event = await requestRestate({
      version: draftVersion,
      text: "add a step",
      restate: async () => {
        throw new ApiError(503, "ai_unavailable", "off", []);
      },
    });
    expect(event).toMatchObject({ type: "error", status: 503 });
  });
});
