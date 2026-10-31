// The case screen of the delivered app: the header card (figures,
// deadline and stepper), then two columns. The left column holds the
// case data, the share of income and the supporting documents. The
// right column holds the step screen with the actor locked to the
// picked user, and the rules of the step above its actions. The command and upload wiring copies the delivered
// test screen.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, FileText } from "lucide-react";
import { ApiError, getVersion } from "../studio/api";
import {
  listEvents,
  readCase,
  runCommand,
  type CaseDTO,
  type CaseEvent,
  type CaseState,
  type CommandInput,
  type UserDTO,
} from "../studio/case-api";
import {
  listCaseDocuments,
  uploadDocument,
  type DocumentDTO,
} from "../studio/doc-api";
import { CaseSummary, StepScreen } from "../studio/StepScreen";
import { Button } from "@/ui/button";
import { dayTimeText, moneyText, pickField } from "./InboxScreen";
import { fetchChecks } from "./app-api";
import { documentRows, leftStep, sendDecision, shareOfIncome } from "./triage";
import { Pill, RulesSection, ShareBar } from "./TriageScreen";
import { deadlineOf, stepperOf, type StepperItem } from "./case-header";

// Loading is the pending stage of the case or of its version.
function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      Loading the case.
    </div>
  );
}

// Stepper renders the case path: a circle and a label for each step,
// with a connector line to the next step.
function Stepper({ items }: { items: StepperItem[] }) {
  return (
    <ol
      aria-label="Steps"
      className="grid"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item, i) => (
        <li
          key={item.id}
          aria-current={item.mark === "current" ? "step" : undefined}
          className="relative flex flex-col items-center gap-1 px-1 text-center"
        >
          {i < items.length - 1 && (
            <span
              aria-hidden
              className={`absolute top-[10px] left-[calc(50%+15px)] right-[calc(-50%+15px)] h-0.5 ${item.mark === "done" ? "bg-primary" : "bg-border"}`}
            />
          )}
          {item.mark === "done" ? (
            <span className="flex size-[22px] items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check size={12} strokeWidth={3} />
            </span>
          ) : (
            <span
              className={`flex size-[22px] items-center justify-center rounded-full text-[11px] ${item.mark === "current" ? "border-2 border-primary font-bold" : "border text-muted-foreground"}`}
            >
              {i + 1}
            </span>
          )}
          <span
            className={`text-[12px] leading-tight line-clamp-2 ${item.mark === "current" ? "font-semibold" : item.mark === "next" ? "text-muted-foreground" : ""}`}
          >
            {item.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

// ErrorScreen is the error stage of the case or of its version. The
// heading copies the delivered text of the test screen.
function ErrorScreen({ error }: { error: unknown }) {
  const message = messageOf(error);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-semibold">The case did not load.</h1>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

export function CaseScreen({
  userId,
  caseId,
  users,
  onBack,
  backLabel = "Inbox",
  onLeftStep,
}: {
  userId: string;
  caseId: string;
  users: UserDTO[];
  onBack: () => void;
  backLabel?: string;
  onLeftStep?: () => void;
}) {
  const queryClient = useQueryClient();
  const caseQuery = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => readCase(caseId),
  });
  const versionId = caseQuery.data?.case.version_id ?? null;
  const versionQuery = useQuery({
    queryKey: ["version", versionId],
    queryFn: () => getVersion(versionId!),
    enabled: versionId !== null,
  });
  const eventsQuery = useQuery({
    queryKey: ["events", caseId],
    queryFn: () => listEvents(caseId),
  });
  const documentsQuery = useQuery({
    queryKey: ["documents", caseId],
    queryFn: () => listCaseDocuments(caseId),
  });
  // The same key as the triage deck: one cache for the checks of a case.
  const checksQuery = useQuery({
    queryKey: ["checks", caseId],
    queryFn: () => fetchChecks(caseId),
    enabled: caseQuery.data?.state.status === "open",
  });

  const [lastAnswer, setLastAnswer] = useState<{
    events: CaseEvent[];
    state: CaseState;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  const def = versionQuery.data?.definition;
  const state = caseQuery.data?.state;

  // The failed checks of the last command answer: one entry per
  // check_evaluated event with result false. The message comes from
  // the check of the definition; a check id outside the definition
  // falls back to the id itself.
  const failedChecks = (lastAnswer?.events ?? [])
    .filter((e) => e.type === "check_evaluated" && e.payload.result === false)
    .map((e) => {
      const id = String(e.payload.check_id);
      const message =
        def?.nodes
          .flatMap((n) => n.checks)
          .find((check) => check.id === id)?.message ?? id;
      return { id, message };
    });

  // onCommands runs a command chain (one command, or a submit and a
  // decide). The merged answer goes into the case cache (the state
  // only, the case row stays), and the event list invalidates (the
  // pattern of lot 3.2). A failure refetches the case: a submit can
  // be stored before the decide fails.
  async function onCommands(cmds: CommandInput[]) {
    setLastAnswer(null);
    try {
      const answer = await sendDecision(caseId, userId, cmds, runCommand);
      setLastAnswer(answer);
      queryClient.setQueryData<{ case: CaseDTO; state: CaseState }>(
        ["case", caseId],
        (old) => (old ? { case: old.case, state: answer.state } : old),
      );
      if (onLeftStep && state && leftStep(state, answer.state)) onLeftStep();
      void queryClient.invalidateQueries({ queryKey: ["events", caseId] });
      void queryClient.invalidateQueries({ queryKey: ["checks", caseId] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
      void queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      void queryClient.invalidateQueries({ queryKey: ["events", caseId] });
      void queryClient.invalidateQueries({ queryKey: ["checks", caseId] });
    }
  }

  // onUpload attaches one scan under the target name of one required
  // document. The answer appends into the documents cache; the flag
  // always resets.
  function onUpload(file: File, targetName: string) {
    setUploading(true);
    const named = new File([file], targetName, { type: file.type });
    uploadDocument(caseId, named)
      .then((doc) => {
        queryClient.setQueryData<DocumentDTO[]>(
          ["documents", caseId],
          (old) => (old ? [...old, doc] : [doc]),
        );
        toast.success(`Document attached: ${doc.name}.`);
      })
      .catch((err) => {
        toast.error(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        setUploading(false);
      });
  }

  if (caseQuery.isError || versionQuery.isError) {
    return (
      <div className="flex min-h-screen flex-col">
        <ErrorScreen error={caseQuery.error ?? versionQuery.error} />
      </div>
    );
  }
  if (caseQuery.isPending || versionQuery.isPending) {
    return (
      <div className="flex min-h-screen flex-col">
        <Loading />
      </div>
    );
  }

  const loaded = caseQuery.data;
  const loadedDef = versionQuery.data.definition;
  const versionRow = versionQuery.data;
  const caseRow = loaded.case;
  const stringField = pickField(loadedDef, "string");
  const moneyField = pickField(loadedDef, "money");
  const rawClient =
    stringField === null ? undefined : loaded.state.data[stringField.name];
  const clientName = typeof rawClient === "string" ? rawClient : "-";
  const currentNode = loadedDef.nodes.find(
    (node) => node.id === loaded.state.node_id,
  );
  const nodeName = currentNode?.name ?? loaded.state.node_id;
  const events = eventsQuery.data ?? [];
  const deadline = deadlineOf(
    events,
    currentNode,
    loaded.state,
    caseQuery.dataUpdatedAt,
  );
  const steps = stepperOf(loadedDef, events, loaded.state);
  const share = shareOfIncome(loaded.state);
  const rows =
    documentsQuery.data === undefined
      ? null
      : documentRows(loadedDef, events, loaded.state.node_id, documentsQuery.data);
  const provided = (rows ?? []).filter((r) => r.scan !== null).length;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-6 py-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {backLabel}
        </Button>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <span className="font-mono text-xs text-muted-foreground">
              {`${caseRow.reference} · ${loadedDef.name} v${versionRow.number}`}
            </span>
            <h1 className="mt-1 truncate text-lg font-semibold leading-tight">
              {clientName}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {`Created ${dayTimeText(caseRow.created_at, false)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Amount</span>
              <span className="text-sm font-medium">
                {moneyField === null
                  ? "-"
                  : moneyText(loaded.state.data[moneyField.name])}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Step</span>
              <span>
                <span className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
                  {nodeName}
                </span>
              </span>
            </div>
            {deadline !== null && (
              <>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Deadline</span>
                  <span className="text-sm font-medium">{deadline.due}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Time spent</span>
                  <span>
                    <Pill tone={deadline.tone} text={deadline.spent} />
                  </span>
                </div>
              </>
            )}
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Status</span>
              <span className="text-sm font-medium">
                {loaded.state.status === "closed"
                  ? `Closed: ${loaded.state.result}`
                  : "Open"}
              </span>
            </div>
          </div>
        </div>
        <div className="border-t px-4 py-3">
          <Stepper items={steps} />
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label="Case data" className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-3 text-[15px] font-semibold">Case data</h2>
            <div className="p-4">
              {currentNode !== undefined && (
                // The write fields show here only while the form is closed.
                <CaseSummary
                  def={loadedDef}
                  node={currentNode}
                  state={loaded.state}
                  withWrites={loaded.state.status !== "open" || loaded.state.assignee !== userId}
                />
              )}
              {share !== null && (
                <div className="mt-3 border-t pt-3">
                  <ShareBar share={share} />
                </div>
              )}
            </div>
          </section>
          {(rows === null || rows.length > 0) && (
            <section aria-label="Supporting documents" className="rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <h2 className="text-[15px] font-semibold">Supporting documents</h2>
                {rows !== null && (
                  <span className="text-xs text-muted-foreground">{`${provided} of ${rows.length} provided`}</span>
                )}
              </div>
              {documentsQuery.isError ? (
                <p className="border-t px-4 py-2.5 text-sm text-red-700">
                  {`The documents did not load: ${messageOf(documentsQuery.error)}`}
                </p>
              ) : rows === null ? (
                <p className="border-t px-4 py-2.5 text-sm text-muted-foreground">Loading the documents.</p>
              ) : (
                <ul>
                  {rows.map((r) => (
                    <li key={r.name} className="flex items-start gap-3 border-t px-4 py-2.5">
                      <FileText size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        {r.scan === null ? (
                          <p className="text-xs text-red-700">Missing</p>
                        ) : (
                          <p className="truncate text-xs text-muted-foreground">{r.scan.name}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
        <div className="rounded-lg border bg-card">
          <StepScreen
            def={loadedDef}
            state={loaded.state}
            users={users}
            actor={userId}
            onActorChange={() => {}}
            onCommand={(cmd) => void onCommands([cmd])}
            onDecide={(cmds) => void onCommands(cmds)}
            failedChecks={failedChecks}
            documents={documentsQuery.data ?? null}
            documentsError={
              documentsQuery.error instanceof ApiError
                ? documentsQuery.error.message
                : null
            }
            events={eventsQuery.data ?? []}
            uploading={uploading}
            onUpload={onUpload}
            actorLocked
            showSummary={false}
            checkResult={
              loaded.state.status === "open" ? (
                <RulesSection
                  checks={checksQuery.data?.checks ?? null}
                  checksError={checksQuery.isError ? messageOf(checksQuery.error) : null}
                />
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
