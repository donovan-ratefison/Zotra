// The test screen: the users pick, the case, the diagram and the
// step screen. TestScreen owns the case query, the actor, the last
// command answer and the create flow; the step screen renders one
// step of it.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "./api";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  createCase,
  listUsers,
  readCase,
  runCommand,
  type CaseDTO,
  type CaseEvent,
  type CaseState,
  type CommandInput,
} from "./case-api";
import { NewCaseDialog } from "./NewCaseDialog";
import { ProcessDiagram } from "./diagram";
import { StepScreen } from "./StepScreen";
import { useStudioStore } from "./store";
import type { ProcessDefinition, VersionSummary } from "./types";

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      Loading the test view
    </div>
  );
}

function ErrorScreen({ heading, error }: { heading: string; error: unknown }) {
  const message = error instanceof ApiError ? error.message : String(error);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-semibold">{heading}</h1>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

// The diagram requires the citation handler. The test mode has no
// policy drawer to open (the drawer is a design-mode tool), so a
// citation chip click does nothing here.
function ignoreCitation() {}

export function TestScreen({ def, version }: {
  def: ProcessDefinition;
  version: VersionSummary;
}) {
  const testCaseId = useStudioStore((s) => s.testCaseId);
  const setTestCaseId = useStudioStore((s) => s.setTestCaseId);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const select = useStudioStore((s) => s.select);
  const queryClient = useQueryClient();

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const caseQuery = useQuery({
    queryKey: ["case", testCaseId],
    queryFn: () => readCase(testCaseId!),
    enabled: testCaseId !== null,
  });

  // The actor: the picked user, else the first of the list.
  const [actor, setActor] = useState<string | null>(null);
  const effectiveActor = actor ?? usersQuery.data?.[0]?.id ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<{
    events: CaseEvent[];
    state: CaseState;
  } | null>(null);
  const [valuesChanged, setValuesChanged] = useState(false);

  // The failed checks of the last command answer: one entry per
  // check_evaluated event with result false. The message comes from
  // the check of the definition; a check id outside the definition
  // falls back to the id itself.
  const failedChecks = (lastAnswer?.events ?? [])
    .filter((e) => e.type === "check_evaluated" && e.payload.result === false)
    .map((e) => {
      const id = String(e.payload.check_id);
      const message =
        def.nodes
          .flatMap((n) => n.checks)
          .find((check) => check.id === id)?.message ?? id;
      return { id, message };
    });

  // decisionEnabled: the last answer submitted the values of the
  // current node, no check failed, the case still rests on the node,
  // and no value changed since.
  const state = caseQuery.data?.state;
  const decisionEnabled =
    lastAnswer !== null &&
    state !== undefined &&
    lastAnswer.events.some(
      (e) => e.type === "data_submitted" && e.payload.node_id === state.node_id,
    ) &&
    failedChecks.length === 0 &&
    lastAnswer.state.node_id === state.node_id &&
    !valuesChanged;

  // onCommand runs one command. The failed list clears while it
  // runs; the answer merges into the case cache (the state only, the
  // case row stays), and a failure keeps the last state.
  async function onCommand(cmd: CommandInput) {
    if (testCaseId === null) {
      return;
    }
    setLastAnswer(null);
    setValuesChanged(false);
    try {
      const answer = await runCommand(testCaseId, effectiveActor, cmd);
      setLastAnswer(answer);
      queryClient.setQueryData<{
        case: CaseDTO;
        state: CaseState;
      }>(["case", testCaseId], (old) =>
        old ? { case: old.case, state: answer.state } : old,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  }

  // onNewCase creates the case and starts it with the form values.
  // A failure at either call keeps the dialog open with the message.
  async function onNewCase(data: Record<string, unknown>) {
    setBusy(true);
    setCreateError(null);
    try {
      const created = await createCase(version.id, true);
      await runCommand(created.id, effectiveActor, { type: "start", data });
      setTestCaseId(created.id);
      const params = new URLSearchParams(window.location.search);
      params.set("mode", "test");
      params.set("case", created.id);
      window.history.replaceState(null, "", `?${params.toString()}`);
      setDialogOpen(false);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Every state renders inside one layout, with the dialog mounted
  // once above the branches.
  let content: ReactNode;
  if (usersQuery.isError) {
    content = (
      <ErrorScreen heading="The users did not load." error={usersQuery.error} />
    );
  } else if (usersQuery.isPending) {
    content = <Loading />;
  } else if (testCaseId === null) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">No test case yet.</h1>
        <p className="text-muted-foreground">Create one to play the circuit.</p>
        <Button onClick={() => setDialogOpen(true)}>Create a test case</Button>
      </div>
    );
  } else if (caseQuery.isError) {
    content = (
      <ErrorScreen heading="The case did not load." error={caseQuery.error} />
    );
  } else if (caseQuery.isPending || caseQuery.data === undefined) {
    content = <Loading />;
  } else {
    const loaded = caseQuery.data;
    content = (
      <>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <span className="font-mono text-sm">{`Test case ${loaded.case.reference}`}</span>
          <Badge variant="secondary">{`v${version.number}`}</Badge>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            New test case
          </Button>
        </div>
        <main className="flex min-h-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1">
            <ProcessDiagram
              def={def}
              selectedNodeId={selectedNodeId}
              onNodeSelect={select}
              ghost={false}
              onCitationClick={ignoreCitation}
            />
          </div>
          <aside
            aria-label="Step screen"
            className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l"
          >
            <StepScreen
              def={def}
              state={loaded.state}
              users={usersQuery.data}
              actor={effectiveActor}
              onActorChange={setActor}
              onCommand={(cmd) => void onCommand(cmd)}
              failedChecks={failedChecks}
              decisionEnabled={decisionEnabled}
              onValueChange={() => setValuesChanged(true)}
            />
          </aside>
        </main>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {content}
      <NewCaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        def={def}
        busy={busy}
        error={createError}
        onCreate={(data) => void onNewCase(data)}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
