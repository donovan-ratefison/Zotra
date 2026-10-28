// The checks tab of the test screen: one card per check of the step
// with its last result, the explain action of a failed check with its
// proposal card, the required documents card and the signature card.
// The results come from the events up to the state seq; the words
// carry the state, the color only backs them.

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ApiError } from "./api";
import {
  explainCheck,
  type ExplainAnswer,
  type ExplainProposal,
} from "./ai-api";
import type { CaseEvent, CaseState } from "./case-api";
import type { ProcessDefinition } from "./types";

// explainErrorText is the error line for any failure of the explain
// call. An ApiError gives its message, anything else gives the
// generic line (the 2.4 policyErrorText rule).
function explainErrorText(err: unknown): string {
  return err instanceof ApiError ? err.message : "The explanation did not run.";
}

// ExplainCard renders the answer of one explain call: the
// explanation in plain language, the proposed rule, and the accept or
// reject buttons. It is presentational: ChecksTab holds the state.
export function ExplainCard({ answer, versionStatus, busyApply, onApply, onReject }: {
  answer: ExplainAnswer;
  versionStatus: "draft" | "frozen" | "published" | null;
  busyApply: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  const draft = versionStatus === "draft";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm">{answer.explanation}</p>
      <p className="text-sm font-medium">Proposed rule:</p>
      <code className="font-mono text-[12px] text-muted-foreground">
        {answer.proposal.expression}
      </code>
      <p className="text-sm">{`New message: ${answer.proposal.message}`}</p>
      <p className="text-sm">{`Plain language: ${answer.proposal.plain_text}`}</p>
      {!draft && (
        <p className="text-sm text-muted-foreground">
          Only a draft can be edited. Fork the version first.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busyApply} onClick={onReject}>
          Reject
        </Button>
        <Button size="sm" disabled={!draft || busyApply} onClick={onApply}>
          Apply to draft
        </Button>
      </div>
    </div>
  );
}

export function ChecksTab({ def, state, events, nodeId, caseId = null, versionStatus = null, replaying = false, onApplyFix }: {
  def: ProcessDefinition;
  state: CaseState;
  events: CaseEvent[];
  nodeId: string;
  caseId?: string | null;
  versionStatus?: "draft" | "frozen" | "published" | null;
  replaying?: boolean;
  onApplyFix?: (checkId: string, p: ExplainProposal) => Promise<void>;
}) {
  // One explain at a time. The checkId keys place the answer card and
  // the error line under the right check card; check ids are unique
  // in the definition.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{
    checkId: string;
    answer: ExplainAnswer;
  } | null>(null);
  const [error, setError] = useState<{ checkId: string; text: string } | null>(
    null,
  );
  const [busyApply, setBusyApply] = useState(false);

  const node = def.nodes.find((nd) => nd.id === nodeId);
  if (node === undefined || node.type !== "task") {
    return (
      <p className="text-sm text-muted-foreground">Only tasks have checks.</p>
    );
  }
  const docs = Array.isArray(state.data.documents)
    ? state.data.documents.length
    : 0;

  // onExplain asks the AI about one failed check. A new explain
  // replaces an old answer and clears an old error. The button hides
  // during a replay: the handler reads the last event of the full
  // list, so the explain waits for the present, like the commands.
  async function onExplain(checkId: string) {
    if (caseId === null || replaying || busyId !== null) {
      return;
    }
    setBusyId(checkId);
    setError(null);
    try {
      const got = await explainCheck(caseId, nodeId, checkId);
      setAnswer({ checkId, answer: got });
    } catch (err) {
      setError({ checkId, text: explainErrorText(err) });
    } finally {
      setBusyId(null);
    }
  }

  // apply hands the proposal to the screen. The card clears on a
  // resolved promise; a rejection keeps it, the toast already showed
  // the error.
  async function apply() {
    if (onApplyFix === undefined || answer === null) {
      return;
    }
    setBusyApply(true);
    try {
      await onApplyFix(answer.checkId, answer.answer.proposal);
      setAnswer(null);
    } catch {
      // The promise rejected after the toast; the card stays.
    } finally {
      setBusyApply(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {node.checks.length === 0 && (
        <p className="text-sm text-muted-foreground">No check on this step.</p>
      )}
      {node.checks.map((check) => {
        // The last check_evaluated of this check at or before the
        // state seq: the state of a replay ends at its seq.
        const mine = events.filter(
          (e) =>
            e.type === "check_evaluated" &&
            e.payload.check_id === check.id &&
            e.seq <= state.seq,
        );
        const last = mine.length > 0 ? mine[mine.length - 1]! : undefined;
        const failed = last !== undefined && last.payload.result === false;
        return (
          <div
            key={check.id}
            className="flex flex-col gap-1.5 rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">{`Check ${check.id}`}</h4>
              {last === undefined ? (
                <Badge variant="secondary">Not run</Badge>
              ) : last.payload.result === true ? (
                <Badge className="bg-green-600 text-white">Passed</Badge>
              ) : (
                <Badge variant="destructive">Failed</Badge>
              )}
            </div>
            <code className="font-mono text-[12px] text-muted-foreground">
              {check.expression}
            </code>
            {failed && <p className="text-destructive text-sm">{check.message}</p>}
            {failed && caseId !== null && !replaying && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={busyId !== null}
                onClick={() => void onExplain(check.id)}
              >
                <Sparkles className="size-3.5" />
                {busyId === check.id ? "Explaining..." : "Explain this check"}
              </Button>
            )}
            {failed && error?.checkId === check.id && (
              <p className="text-destructive text-sm">{error.text}</p>
            )}
            {failed && answer?.checkId === check.id && (
              <ExplainCard
                answer={answer.answer}
                versionStatus={versionStatus}
                busyApply={busyApply}
                onApply={() => void apply()}
                onReject={() => setAnswer(null)}
              />
            )}
          </div>
        );
      })}

      {node.documents.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Required documents</h4>
            <Badge variant="secondary">{`${docs} of ${node.documents.length}`}</Badge>
          </div>
          <ul className="flex flex-col gap-1">
            {node.documents.map((name, index) => (
              <li
                key={name}
                className="flex items-center gap-2 text-sm"
                data-covered={index < docs}
              >
                {index < docs && <Check className="size-3.5 text-green-600" />}
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {node.signature && (
        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Signature</h4>
            <Badge variant="secondary">To sign</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Simple signature: name, time and document hash go to the audit
            log.
          </p>
        </div>
      )}
    </div>
  );
}
