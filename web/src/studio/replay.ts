// The replay mapping and the copy runner of the test screen. One event
// log becomes the command list of a copy (commandsOf); the copy runs
// through createCase and runCommand (runCopy), so a replay creates a
// new case and never touches the source log.

import { ApiError } from "./api";
import {
  createCase,
  runCommand,
  type CaseEvent,
  type CommandInput,
} from "./case-api";

// One command of the copy: the seq of its command event, the actor of
// that event, and the command body. The seq stays on the step, so a
// patch can match one step by its event.
export interface ReplayStep {
  seq: number;
  actor: string;
  cmd: CommandInput;
}

// One payload view per command event. CaseEvent.payload is a record
// of unknown values; each branch reads it through its own shape, with
// payloadOf as the one cast.
interface CreatedPayload {
  data: Record<string, unknown>;
}
interface SubmittedPayload {
  node_id: string;
  values: Record<string, unknown>;
}
interface DecisionPayload {
  decision: string;
}
interface SignaturePayload {
  document_hash: string;
}

function payloadOf<T>(event: CaseEvent): T {
  return event.payload as unknown as T;
}

// commandsOf maps the command events to steps, in seq order. The
// engine emits edge_taken, step_entered and case_closed itself, and
// check_evaluated follows a decide; source_fetched belongs to the
// external sources. None of those is a command, so they give no step.
export function commandsOf(events: CaseEvent[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  for (const event of events) {
    switch (event.type) {
      case "case_created":
        steps.push({
          seq: event.seq,
          actor: event.actor,
          cmd: {
            type: "start",
            data: payloadOf<CreatedPayload>(event).data,
          },
        });
        break;
      case "step_assigned":
        steps.push({
          seq: event.seq,
          actor: event.actor,
          cmd: { type: "take" },
        });
        break;
      case "data_submitted":
        steps.push({
          seq: event.seq,
          actor: event.actor,
          cmd: {
            type: "submit",
            values: payloadOf<SubmittedPayload>(event).values,
          },
        });
        break;
      case "decision_made":
        steps.push({
          seq: event.seq,
          actor: event.actor,
          cmd: {
            type: "decide",
            decision: payloadOf<DecisionPayload>(event).decision,
          },
        });
        break;
      case "signature_added":
        steps.push({
          seq: event.seq,
          actor: event.actor,
          cmd: {
            type: "sign",
            document_hash: payloadOf<SignaturePayload>(event).document_hash,
          },
        });
        break;
      default:
        break;
    }
  }
  return steps;
}

// submitsOf lists the submitted values before the replay point: one
// entry per data_submitted event with seq < until, in seq order. The
// event at the boundary is out.
export function submitsOf(
  events: CaseEvent[],
  until: number,
): { seq: number; node_id: string; values: Record<string, unknown> }[] {
  return events
    .filter((e) => e.type === "data_submitted" && e.seq < until)
    .map((e) => {
      const payload = payloadOf<SubmittedPayload>(e);
      return { seq: e.seq, node_id: payload.node_id, values: payload.values };
    });
}

// messageOf holds the text of one rejection: the ApiError message when
// it is one, else the string form. runCopy never rejects, so this is
// the one place that reads a failure.
function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : String(err);
}

// runCopy creates a test case and replays the commands into it, each
// under the actor of its event. The step whose seq equals patch.seq
// sends the patched values instead of its own. The first refusal stops
// the loop; the partial copy stays, so the caller can open it.
// runCopy never rejects.
export async function runCopy(
  steps: ReplayStep[],
  versionId: string,
  patch: { seq: number; values: Record<string, unknown> } | null,
): Promise<{ caseId: string; applied: number; error: string | null }> {
  let created;
  try {
    created = await createCase(versionId, true);
  } catch (err) {
    return { caseId: "", applied: 0, error: messageOf(err) };
  }
  let applied = 0;
  for (const step of steps) {
    const cmd =
      patch !== null && step.seq === patch.seq
        ? { ...step.cmd, values: patch.values }
        : step.cmd;
    try {
      await runCommand(created.id, step.actor, cmd);
    } catch (err) {
      return { caseId: created.id, applied, error: messageOf(err) };
    }
    applied += 1;
  }
  return { caseId: created.id, applied, error: null };
}
