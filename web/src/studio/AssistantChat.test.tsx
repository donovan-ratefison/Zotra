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
import type { RestateQuestion } from "./ai-api";
import {
  ChatPanelView,
  acceptProposal,
  answerLabels,
  answersReady,
  chatEvent,
  composeMessage,
  defaultAnswers,
  pickOption,
  pickOther,
  readRestateFirst,
  requestChange,
  requestRestate,
  type ChatState,
} from "./AssistantChat";
import { diffChips, diffDefinitions } from "./diff";
import type { ProcessDefinition, Version } from "./types";

const REPLAY_MISS =
  "This request is not in the recorded demo answers. To use the live AI, set ZOTRA_AI_API_KEY and ZOTRA_AI_MODE=live in .env, then restart.";

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
      type: "error", status: 503, code: "ai_unavailable", message: "The AI layer is off.", details: [],
    });
    expect(state.turns.at(-1)).toEqual({
      kind: "error",
      text: "The AI is not available. You can still edit the process by hand.",
      chips: [], rows: [], details: [],
    });
  });

  test("error 503 ai_not_recorded shows the API message", () => {
    const state = chatEvent(sent, {
      type: "error", status: 503, code: "ai_not_recorded", message: REPLAY_MISS, details: [],
    });
    expect(state.turns.at(-1)).toEqual({
      kind: "error", text: REPLAY_MISS, chips: [], rows: [], details: [],
    });
  });

  test("error 422 gives the invalid-output text and the first 3 details", () => {
    const state = chatEvent(sent, {
      type: "error", status: 422, code: "invalid_output", message: "failed",
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
      type: "error", status: 500, code: "http", message: "boom", details: [],
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
  test("F13: open and collapsed bars hold the (?) and no explanation line", () => {
    for (const html of [renderChat(EMPTY, draftVersion), renderChat(EMPTY, draftVersion, true)]) {
      expect(html).toContain("AI assistant");
      expect(html).toContain('aria-label="About the AI assistant"');
      expect(html).not.toContain("Without AI, you can still");
    }
  });

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
      selectedNodeId: null,
      change: async () => ({ definition: next, attempts: 1 }),
    });
    expect(event).toEqual({ type: "answer", base: miniDefinition, next });
  });

  test("an ApiError maps onto the error event with its status", async () => {
    const event = await requestChange({
      version: draftVersion,
      def: miniDefinition,
      text: "add an expert review",
      selectedNodeId: null,
      change: async () => {
        throw new ApiError(503, "ai_unavailable", "The AI layer is off.");
      },
    });
    expect(event).toEqual({
      type: "error",
      status: 503,
      code: "ai_unavailable",
      message: "The AI layer is off.",
      details: [],
    });
  });
});

describe("requestChange errors", () => {
  test("an ai_not_recorded ApiError keeps its code", async () => {
    const event = await requestChange({
      version: draftVersion,
      def: miniDefinition,
      text: "add an expert review",
      selectedNodeId: null,
      change: async () => {
        throw new ApiError(503, "ai_not_recorded", REPLAY_MISS);
      },
    });
    expect(event).toEqual({
      type: "error", status: 503, code: "ai_not_recorded", message: REPLAY_MISS, details: [],
    });
  });

  test("another error gives status 0 and an empty code", async () => {
    const event = await requestChange({
      version: draftVersion,
      def: miniDefinition,
      text: "add an expert review",
      selectedNodeId: null,
      change: async () => {
        throw new Error("boom");
      },
    });
    expect(event).toEqual({
      type: "error", status: 0, code: "", message: "Error: boom", details: [],
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
const restated = chatEvent(sent, {
  type: "restated", text: "You want to X.", questions: [],
});

describe("restate step", () => {
  test("C1: restated replaces the waiting turn", () => {
    expect(restated.turns.at(-1)).toEqual({
      kind: "restate", text: "You want to X.", chips: [], rows: [], details: [],
    });
    expect(restated.turns).toHaveLength(2);
  });

  test("C2: restated after a proposal leaves the state", () => {
    expect(chatEvent(proposed, { type: "restated", text: "x", questions: [] })).toBe(proposed);
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
        selectedNodeId: null,
        restate: async () => ({ restatement: "You want to add a step.", questions: [] }),
      }),
    ).toEqual({ type: "restated", text: "You want to add a step.", questions: [] });
    const event = await requestRestate({
      version: draftVersion,
      text: "add a step",
      selectedNodeId: null,
      restate: async () => {
        throw new ApiError(503, "ai_unavailable", "off", []);
      },
    });
    expect(event).toMatchObject({ type: "error", status: 503 });
  });
});

// The rows of the clarifying questions: U1 to U7, W1 to W4.
const who: RestateQuestion = {
  id: "who",
  text: "Who validates?",
  kind: "single",
  other: true,
  options: [
    { label: "Legal officer", ref: "role:legal", default: true, reason: "four-eyes rule" },
    { label: "Analyst", ref: "role:analyst", default: false, reason: "" },
  ],
};
const docs: RestateQuestion = {
  id: "docs",
  text: "Which documents?",
  kind: "multi",
  other: true,
  options: [
    { label: "Loan offer", ref: "document:Loan offer", default: true, reason: "" },
    { label: "ID card", ref: "document:ID card", default: false, reason: "" },
    { label: "Signed contract", ref: "document:Signed contract", default: true, reason: "" },
  ],
};
const asked = chatEvent(sent, {
  type: "restated", text: "You want to add a check.", questions: [who, docs],
});

describe("clarifying questions", () => {
  test("U1: defaultAnswers ticks the default labels", () => {
    expect(defaultAnswers([who, docs])).toEqual({
      who: { picked: ["Legal officer"], other: null },
      docs: { picked: ["Loan offer", "Signed contract"], other: null },
    });
  });

  test("U2: pickOption single, then multi on and off", () => {
    const a = defaultAnswers([who, docs]);
    expect(pickOption(a, who, "Analyst", false).who).toEqual({ picked: ["Analyst"], other: null });
    const on = pickOption(a, docs, "ID card", true);
    expect(on.docs.picked).toEqual(["Loan offer", "ID card", "Signed contract"]);
    expect(pickOption(on, docs, "Loan offer", false).docs.picked).toEqual([
      "ID card", "Signed contract",
    ]);
  });

  test("U3: pickOther single, then null", () => {
    const a = pickOther(defaultAnswers([who]), who, "Compliance");
    expect(a.who).toEqual({ picked: [], other: "Compliance" });
    expect(pickOther(a, who, null).who).toEqual({ picked: [], other: null });
    const m = pickOther(defaultAnswers([docs]), docs, "Risk");
    expect(m.docs).toEqual({ picked: ["Loan offer", "Signed contract"], other: "Risk" });
  });

  test("U4: answerLabels gives option order, then the Other text", () => {
    expect(
      answerLabels(docs, { picked: ["Signed contract", "Loan offer"], other: " Risk " }),
    ).toEqual(["Loan offer", "Signed contract", "Risk"]);
    expect(answerLabels(docs, { picked: ["Loan offer"], other: "  " })).toEqual(["Loan offer"]);
  });

  test("U5: answersReady needs one label for each question", () => {
    const a = defaultAnswers([who, docs]);
    expect(answersReady([who, docs], a)).toBe(true);
    expect(answersReady([who, docs], { ...a, docs: { picked: [], other: null } })).toBe(false);
    expect(answersReady([who, docs], pickOther(a, who, ""))).toBe(false);
  });

  test("U6: composeMessage adds one line for each question", () => {
    const a = pickOption(
      pickOption(defaultAnswers([who, docs]), docs, "Signed contract", false),
      docs, "ID card", true,
    );
    expect(composeMessage("Add a check", [who, docs], a)).toBe(
      "Add a check\nWho validates?: Legal officer\nWhich documents?: Loan offer, ID card",
    );
  });

  test("U7: restated keeps the questions, confirm takes the text", () => {
    expect(asked.turns.at(-1)?.questions).toEqual([who, docs]);
    const next = chatEvent(asked, { type: "confirm", text: "Who validates?: Analyst" });
    expect(next.turns.at(-2)).toEqual({
      kind: "user", text: "Who validates?: Analyst", chips: [], rows: [], details: [],
    });
  });

  test("W1: the last turn renders the controls, the reason and the buttons", () => {
    const html = renderChat(asked, draftVersion);
    expect(html).toContain('name="q-who"');
    expect(html).toMatch(/<legend[^>]*>Who validates\?<\/legend>/);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("four-eyes rule");
    expect(html).toMatch(/aria-label="Other answer: Which documents\?" disabled=""/);
    expect(html).toContain("Make the change with these choices");
    expect(html).toContain("Rephrase");
    expect(html).not.toContain("Yes, make the change");
  });

  test("W2: answers that are not ready disable the primary button", () => {
    const answers = { ...defaultAnswers([who, docs]), docs: { picked: [], other: null } };
    const html = renderToString(
      createElement(ChatPanelView, {
        state: asked, version: draftVersion, collapsed: false, answers,
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Make the change with these choices/);
    const ready = renderChat(asked, draftVersion);
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>Make the change with these choices/);
  });

  test("W3: a restate turn that is not last shows text only", () => {
    const html = renderChat(chatEvent(asked, { type: "rephrase" }), draftVersion);
    expect(html).toContain("Who validates?");
    expect(html).toContain("Loan offer, Signed contract");
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("Other answer");
    expect(html).not.toContain("Make the change with these choices");
  });

  test("W4: a restate turn with no questions keeps the two buttons", () => {
    const html = renderChat(restated, draftVersion);
    expect(html).toContain("Yes, make the change");
    expect(html).toContain("No, rephrase");
    expect(html).not.toContain("<fieldset");
  });
});

// The rows of the selected step: A1, A2, V1 to V3.
describe("selected step", () => {
  test("A1: requestChange passes the selected step id, then null", async () => {
    const seen: (string | null)[] = [];
    for (const selectedNodeId of ["offer", null]) {
      await requestChange({
        version: draftVersion,
        def: miniDefinition,
        text: "add a step after this step",
        selectedNodeId,
        change: async (_id, _message, node) => {
          seen.push(node ?? null);
          return { definition: miniDefinition, attempts: 1 };
        },
      });
    }
    expect(seen).toEqual(["offer", null]);
  });

  test("A2: requestRestate passes the selected step id, then null", async () => {
    const seen: (string | null)[] = [];
    for (const selectedNodeId of ["offer", null]) {
      await requestRestate({
        version: draftVersion,
        text: "add a step after this step",
        selectedNodeId,
        restate: async (_id, _message, node) => {
          seen.push(node ?? null);
          return { restatement: "You want to add a step.", questions: [] };
        },
      });
    }
    expect(seen).toEqual(["offer", null]);
  });

  const about = { id: "offer", name: "Loan offer" };
  function renderAbout(version: Version, value: typeof about | null) {
    return renderToString(
      createElement(ChatPanelView, { state: EMPTY, version, collapsed: false, about: value }),
    );
  }

  test("V1: a draft with a selected step shows the chip and the clear button", () => {
    const html = renderAbout(draftVersion, about);
    expect(html).toContain("About: <!-- -->Loan offer");
    expect(html).toContain('aria-label="Clear the selected step"');
  });

  test("V2: no selected step, no chip", () => {
    const html = renderAbout(draftVersion, null);
    expect(html).not.toContain("About:");
    expect(html).not.toContain("Clear the selected step");
  });

  test("V3: a frozen version shows no chip", () => {
    const html = renderAbout(publishedVersion, about);
    expect(html).not.toContain("About:");
    expect(html).not.toContain("Clear the selected step");
  });
});
