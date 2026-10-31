// The case screen of the delivered app: the header card and the step
// screen with the actor locked to the picked user. The command and
// upload wiring copies the delivered test screen.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
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
import { StepScreen } from "../studio/StepScreen";
import { Button } from "@/ui/button";
import { dayTimeText, moneyText, pickField } from "./InboxScreen";

// Loading is the pending stage of the case or of its version.
function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      Loading the case.
    </div>
  );
}

// ErrorScreen is the error stage of the case or of its version. The
// heading copies the delivered text of the test screen.
function ErrorScreen({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? error.message : String(error);
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
}: {
  userId: string;
  caseId: string;
  users: UserDTO[];
  onBack: () => void;
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

  const [lastAnswer, setLastAnswer] = useState<{
    events: CaseEvent[];
    state: CaseState;
  } | null>(null);
  const [valuesChanged, setValuesChanged] = useState(false);
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

  // decisionEnabled: the last answer submitted the values of the
  // current node, no check failed, the case still rests on the node,
  // and no value changed since.
  const decisionEnabled =
    lastAnswer !== null &&
    state !== undefined &&
    lastAnswer.events.some(
      (e) =>
        e.type === "data_submitted" && e.payload.node_id === state.node_id,
    ) &&
    failedChecks.length === 0 &&
    lastAnswer.state.node_id === state.node_id &&
    !valuesChanged;

  // onCommand runs one command. The answer merges into the case
  // cache (the state only, the case row stays), and the event list
  // invalidates (the pattern of lot 3.2).
  async function onCommand(cmd: CommandInput) {
    setLastAnswer(null);
    setValuesChanged(false);
    try {
      const answer = await runCommand(caseId, userId, cmd);
      setLastAnswer(answer);
      queryClient.setQueryData<{ case: CaseDTO; state: CaseState }>(
        ["case", caseId],
        (old) => (old ? { case: old.case, state: answer.state } : old),
      );
      void queryClient.invalidateQueries({ queryKey: ["events", caseId] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
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
  const nodeName =
    loadedDef.nodes.find((node) => node.id === loaded.state.node_id)?.name ??
    loaded.state.node_id;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Inbox
        </Button>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
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
      </div>
      <div className="rounded-lg border bg-card">
        <StepScreen
          def={loadedDef}
          state={loaded.state}
          users={users}
          actor={userId}
          onActorChange={() => {}}
          onCommand={(cmd) => void onCommand(cmd)}
          failedChecks={failedChecks}
          decisionEnabled={decisionEnabled}
          onValueChange={() => setValuesChanged(true)}
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
        />
      </div>
    </div>
  );
}
