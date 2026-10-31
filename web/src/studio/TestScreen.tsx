// The test screen: the users pick, the case, the diagram and the
// step screen. TestScreen owns the case query, the actor, the last
// command answer and the create flow; the step screen renders one
// step of it.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3,
  Plus,
  Rewind,
  Sparkles,
} from "lucide-react";
import { ApiError, updateDraft } from "./api";
import { generateTests, type ExplainProposal, type GenerateTestsAnswer } from "./ai-api";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Hint } from "@/ui/hint";
import {
  createCase,
  getCoverage,
  listEvents,
  listUsers,
  readCase,
  runCommand,
  type CaseDTO,
  type CaseEvent,
  type CaseState,
  type CommandInput,
} from "./case-api";
import { caseViewOf } from "./case-view";
import { ChecksTab } from "./ChecksTab";
import { Inspector } from "./Inspector";
import { listCaseDocuments, uploadDocument, type DocumentDTO } from "./doc-api";
import { NewCaseDialog } from "./NewCaseDialog";
import {
  saveErrorText,
  withCheckExpression,
  withCheckMessage,
  withCheckPlainText,
} from "./node-edit";
import { ReplayDialog } from "./ReplayDialog";
import { commandsOf, runCopy } from "./replay";
import { ProcessDiagram } from "./diagram";
import { ActorSelect, StepHeader, StepScreen } from "./StepScreen";
import { sendDecision } from "../app/triage";
import { TimelineBar } from "./TimelineBar";
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

// runGenerateTests is the generate action of the coverage bar. It
// asks for the test cases and shows the toast of the answer: the
// success toast with the count for one created case or more, the
// error toast with the first error of the answer when no case is
// created, and the bare error text when the answer holds no error
// either. A refused request gives the error toast of the refusal.
// Then the coverage query refetches. Exported for the tests.
export async function runGenerateTests(
  queryClient: QueryClient,
  versionId: string,
): Promise<void> {
  try {
    const answer: GenerateTestsAnswer = await generateTests(versionId);
    if (answer.created.length > 0) {
      toast.success(`${answer.created.length} test cases created.`);
    } else if (answer.errors[0] !== undefined) {
      toast.error(`The generation created no case: ${answer.errors[0]}`);
    } else {
      toast.error("The generation created no case.");
    }
    void queryClient.invalidateQueries({
      queryKey: ["coverage", versionId],
    });
  } catch (err) {
    toast.error(
      err instanceof ApiError ? err.message : "The generation did not run.",
    );
  }
}

// The tabs of the aside, in render order. The tab state is local to
// the test screen; only the active pane mounts.
const TABS = [
  { id: "screen", label: "Screen" },
  { id: "inspector", label: "Inspector" },
  { id: "checks", label: "Checks" },
] as const;

type PanelTab = (typeof TABS)[number]["id"];

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

  // The coverage mode: off by default, on with coverage=1 in the
  // URL at mount. The render tests have no window: off there (the
  // new=1 pattern of StudioShell.tsx, lines 123 to 130).
  const [coverageOn, setCoverageOn] = useState<boolean>(() => {
    return (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("coverage") === "1"
    );
  });
  // The coverage report of the version. It reads only while the
  // mode is on and a case is open; each command invalidates it, so
  // the counter stays fresh.
  const coverageQuery = useQuery({
    queryKey: ["coverage", version.id],
    queryFn: () => getCoverage(version.id),
    enabled: coverageOn && testCaseId !== null,
  });

  // The replay position: null is the present. It changes only through
  // the controls and the timeline; the create flow resets it. The
  // events feed the timeline, the checks tab, the counter and the
  // control bounds. The replay reads the case at the position; the
  // inspector reads it once more at the earlier position.
  const [at, setAt] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("screen");
  const eventsQuery = useQuery({
    queryKey: ["events", testCaseId],
    queryFn: () => listEvents(testCaseId!),
    enabled: testCaseId !== null,
  });
  // The scans of the case. TestScreen owns this cache: the upload
  // appends into it, and the commands never touch it.
  const documentsQuery = useQuery({
    queryKey: ["documents", testCaseId],
    queryFn: () => listCaseDocuments(testCaseId!),
    enabled: testCaseId !== null,
  });
  const count = eventsQuery.data?.length ?? 0;
  const n = at ?? count;
  const earlier = n - 1;
  const caseAtQuery = useQuery({
    queryKey: ["caseAt", testCaseId, at],
    queryFn: () => readCase(testCaseId!, at!),
    enabled: testCaseId !== null && at !== null,
  });
  const earlierQuery = useQuery({
    queryKey: ["caseAt", testCaseId, earlier],
    queryFn: () => readCase(testCaseId!, earlier),
    enabled: testCaseId !== null && earlier >= 1,
  });

  // The actor: the picked user, else the first of the list.
  const [actor, setActor] = useState<string | null>(null);
  const effectiveActor = actor ?? usersQuery.data?.[0]?.id ?? "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // The replay copy: the dialog, its busy flag and its error. The
  // error clears at each open of the dialog and at each run.
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<{
    events: CaseEvent[];
    state: CaseState;
  } | null>(null);

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

  // onCommands runs a command chain (one command, or a submit and a
  // decide). The failed list clears while it runs; the merged answer
  // goes into the case cache (the state only, the case row stays).
  // A failure refetches the case: a submit can be stored before the
  // decide fails.
  async function onCommands(cmds: CommandInput[]) {
    if (testCaseId === null || at !== null) {
      return;
    }
    setLastAnswer(null);
    try {
      const answer = await sendDecision(testCaseId, effectiveActor, cmds, runCommand);
      setLastAnswer(answer);
      queryClient.setQueryData<{
        case: CaseDTO;
        state: CaseState;
      }>(["case", testCaseId], (old) =>
        old ? { case: old.case, state: answer.state } : old,
      );
      // The timeline, the counter and the control bounds read the
      // event list; the command answer carries the new events only.
      void queryClient.invalidateQueries({ queryKey: ["events", testCaseId] });
      // A take changes the coverage; a disabled query makes this a
      // no-op while the mode is off.
      void queryClient.invalidateQueries({
        queryKey: ["coverage", version.id],
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
      void queryClient.invalidateQueries({ queryKey: ["case", testCaseId] });
      void queryClient.invalidateQueries({ queryKey: ["events", testCaseId] });
    }
  }

  // onUpload attaches one scan to the case under the target name of
  // one required document. The answer appends into the documents
  // cache; a failure shows a toast. The flag always resets.
  function onUpload(file: File, targetName: string) {
    if (testCaseId === null) {
      return;
    }
    const caseId = testCaseId;
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

  // onNewCase creates the case and starts it with the form values.
  // A failure at either call keeps the dialog open with the message.
  async function onNewCase(data: Record<string, unknown>) {
    setBusy(true);
    setCreateError(null);
    try {
      const created = await createCase(version.id, true);
      await runCommand(created.id, effectiveActor, { type: "start", data });
      setTestCaseId(created.id);
      setAt(null);
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

  // onReplayCopy copies the commands up to the replay point into a new
  // test case, with the patched values when the tester changed one.
  // runCopy never rejects; the catch holds an unexpected throw. The
  // dialog stays open with busy while it runs, then closes on both end
  // paths; the busy flag resets on every path (the uploading pattern).
  async function onReplayCopy(
    patch: { seq: number; values: Record<string, unknown> } | null,
  ) {
    if (at === null) {
      return;
    }
    setReplayBusy(true);
    setReplayError(null);
    try {
      const steps = commandsOf((eventsQuery.data ?? []).slice(0, at));
      const answer = await runCopy(steps, version.id, patch);
      if (answer.error === null) {
        toast.success("Copy created.");
      } else {
        toast.error(`The copy stopped: ${answer.error}`);
      }
      // A create refusal leaves nothing to open: the tester stays on
      // the source case.
      if (answer.caseId !== "") {
        setTestCaseId(answer.caseId);
        setAt(null);
        const params = new URLSearchParams(window.location.search);
        params.set("mode", "test");
        params.set("case", answer.caseId);
        window.history.replaceState(null, "", `?${params.toString()}`);
      }
      setReplayOpen(false);
    } catch (err) {
      setReplayError(err instanceof ApiError ? err.message : String(err));
      setReplayOpen(false);
    } finally {
      setReplayBusy(false);
    }
  }

  // onGenerateTests asks the AI for test cases for the red edges of
  // onGenerateTests runs the generate action (runGenerateTests)
  // with the busy flag of the button. A created case has no cached
  // query, so only the coverage invalidation runs inside the action;
  // the tester opens the new case by hand.
  const [generating, setGenerating] = useState(false);
  async function onGenerateTests() {
    setGenerating(true);
    try {
      await runGenerateTests(queryClient, version.id);
    } finally {
      setGenerating(false);
    }
  }

  // onApplyFix applies one proposal to the draft of the opened
  // version (the version prop, never null in the shell): the
  // expression, the message and the plain text of the check change
  // together. The promise rejects on a save error, so the proposal
  // card stays; the case query and the version query refetch, so the
  // check card, the step form and the diagram read the new def.
  async function onApplyFix(checkId: string, p: ExplainProposal): Promise<void> {
    const st = caseQuery.data?.state;
    if (st === undefined) {
      return;
    }
    const next = withCheckPlainText(
      withCheckMessage(
        withCheckExpression(def, st.node_id, checkId, p.expression),
        st.node_id,
        checkId,
        p.message,
      ),
      st.node_id,
      checkId,
      p.plain_text,
    );
    try {
      await updateDraft(version.id, next);
      toast.success("Rule updated in the draft.");
      await queryClient.invalidateQueries({ queryKey: ["case", testCaseId] });
      await queryClient.invalidateQueries({
        queryKey: ["version", version.id],
      });
    } catch (err) {
      toast.error(saveErrorText(err));
      throw err;
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
  } else if (at !== null && caseAtQuery.isError) {
    content = (
      <ErrorScreen
        heading="The replay did not load."
        error={caseAtQuery.error}
      />
    );
  } else if (at !== null && caseAtQuery.data === undefined) {
    content = <Loading />;
  } else {
    // The effective view is the replay answer during a replay, the
    // live answer at the present. The inspector reads the data at the
    // current and the earlier position; below position 1 there is no
    // before. The events feed the timeline block, the checks tab and
    // the counter; their load and error states render inside that
    // block, so the rest of the screen stays usable.
    const loaded =
      at !== null && caseAtQuery.data !== undefined
        ? caseAtQuery.data
        : caseQuery.data;
    const events = eventsQuery.data ?? [];
    const userName = (id: string) =>
      usersQuery.data?.find((u) => u.id === id)?.name ?? id;
    const caseView = caseViewOf(
      events,
      loaded.state,
      (id) => usersQuery.data?.find((u) => u.id === id)?.name ?? null,
    );
    const after =
      at !== null
        ? (caseAtQuery.data?.state.data ?? {})
        : loaded.state.data;
    const before = earlier >= 1 ? (earlierQuery.data?.state.data ?? {}) : {};
    const currentNode =
      def.nodes.find((nd) => nd.id === loaded.state.node_id) ?? null;
    content = (
      <>
        <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4 text-[13px]">
          {currentNode !== null && (currentNode.type === "task" || loaded.state.status === "closed") && (
            <>
              <span className="text-muted-foreground">Act as</span>
              <ActorSelect
                users={usersQuery.data}
                node={currentNode}
                state={loaded.state}
                actor={effectiveActor}
                onActorChange={setActor}
                disabled={at !== null || loaded.state.status === "closed"}
                className="h-8 w-[200px]"
              />
              <span aria-hidden className="h-5 w-px bg-border" />
            </>
          )}
          <span className="text-muted-foreground">Test case</span>
          <span className="font-medium">{loaded.case.reference}</span>
          <Badge variant="secondary">{`v${version.number}`}</Badge>
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            New test case
          </Button>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            aria-pressed={coverageOn}
            onClick={() => setCoverageOn((v) => !v)}
          >
            <BarChart3 className="size-4" />
            Coverage
          </Button>
          {coverageOn && coverageQuery.data !== undefined && (
            <span className="text-[12px] text-muted-foreground">
              {`${coverageQuery.data.taken} / ${coverageQuery.data.total} branches`}
            </span>
          )}
          {coverageOn && (
            <Button
              size="sm"
              disabled={generating}
              onClick={() => void onGenerateTests()}
            >
              <Sparkles className="size-4" />
              {generating ? "Generating..." : "Generate tests"}
            </Button>
          )}
        </div>
        {coverageOn && coverageQuery.isError && (
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-sm">
            <span>The coverage did not load.</span>
            <span className="text-muted-foreground">
              {coverageQuery.error instanceof ApiError
                ? coverageQuery.error.message
                : String(coverageQuery.error)}
            </span>
          </div>
        )}
        <main className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {at !== null && (
              <div
                role="status"
                className="m-3 mb-0 flex shrink-0 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] text-blue-900"
              >
                <Rewind className="size-4 shrink-0" />
                <span>
                  {`Replay at «${currentNode?.name ?? "the start"}», event ${at} of ${count}.`}
                </span>
                <Hint label="About the replay">
                  The case shows its state at this event. The commands wait for
                  the present. Copy the case to change a value and play again.
                </Hint>
                <span className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-background"
                  onClick={() => {
                    setReplayError(null);
                    setReplayOpen(true);
                  }}
                >
                  Copy to a new case
                </Button>
                <Button variant="outline" size="sm" className="bg-background" onClick={() => setAt(null)}>
                  Back to the present
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <ProcessDiagram
                def={def}
                selectedNodeId={selectedNodeId}
                onNodeSelect={select}
                ghost={false}
                onCitationClick={ignoreCitation}
                minimap={false}
                caseView={caseView}
                coverage={coverageQuery.data ?? null}
              />
            </div>
            {eventsQuery.isError ? (
              <div className="flex shrink-0 flex-col gap-0.5 border-t px-4 py-2 text-sm">
                <span>The events did not load.</span>
                <span className="text-muted-foreground">
                  {eventsQuery.error instanceof ApiError
                    ? eventsQuery.error.message
                    : String(eventsQuery.error)}
                </span>
              </div>
            ) : eventsQuery.data === undefined ? (
              <div className="shrink-0 border-t px-4 py-2 text-sm text-muted-foreground">
                Loading the events
              </div>
            ) : (
              <TimelineBar
                def={def}
                events={events}
                state={caseQuery.data.state}
                at={at}
                onSelect={setAt}
                userName={userName}
              />
            )}
          </div>
          <aside
            aria-label="Step screen"
            className="flex w-[380px] shrink-0 flex-col border-l"
          >
            {currentNode !== null && loaded.state.status !== "closed" && (
              <div className="shrink-0 border-b px-4 pt-3.5 pb-3">
                <StepHeader def={def} node={currentNode} />
              </div>
            )}
            <div
              role="tablist"
              aria-label="Case panel"
              className="grid shrink-0 grid-cols-3 gap-0.5 border-b p-1"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={panelTab === t.id}
                  onClick={() => setPanelTab(t.id)}
                  className={`rounded-md px-1 py-1.5 text-[12.5px] font-medium whitespace-nowrap ${
                    panelTab === t.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
            {panelTab === "screen" && (
              <StepScreen
                def={def}
                state={loaded.state}
                users={usersQuery.data}
                actor={effectiveActor}
                onActorChange={setActor}
                onCommand={(cmd) => void onCommands([cmd])}
                onDecide={(cmds) => void onCommands(cmds)}
                failedChecks={failedChecks}
                readOnly={at !== null}
                documents={documentsQuery.data ?? null}
                documentsError={
                  documentsQuery.error instanceof ApiError
                    ? documentsQuery.error.message
                    : null
                }
                events={events}
                uploading={uploading}
                onUpload={onUpload}
                actorInBar
                showHeader={false}
                finalData
              />
            )}
            {panelTab === "inspector" && (
              <div className="p-4">
                <Inspector
                  def={def}
                  before={before}
                  after={after}
                  nodeId={loaded.state.node_id}
                />
              </div>
            )}
            {panelTab === "checks" && (
              <div className="p-4">
                <ChecksTab
                  def={def}
                  state={loaded.state}
                  events={events}
                  nodeId={loaded.state.node_id}
                  caseId={testCaseId}
                  versionStatus={version.status}
                  replaying={at !== null}
                  onApplyFix={(checkId, p) => onApplyFix(checkId, p)}
                />
              </div>
            )}
            </div>
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
      {at !== null && (
        <ReplayDialog
          open={replayOpen}
          onOpenChange={setReplayOpen}
          def={def}
          events={eventsQuery.data ?? []}
          at={at}
          busy={replayBusy}
          error={replayError}
          onCreate={(patch) => void onReplayCopy(patch)}
          onClose={() => setReplayOpen(false)}
        />
      )}
    </div>
  );
}
