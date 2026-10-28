// The test screen: the users pick, the case, the diagram and the
// step screen. TestScreen owns the case query, the actor, the last
// command answer and the create flow; the step screen renders one
// step of it.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Rewind,
  Sparkles,
} from "lucide-react";
import { ApiError, updateDraft } from "./api";
import { generateTests, type ExplainProposal } from "./ai-api";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
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
import { NewCaseDialog } from "./NewCaseDialog";
import {
  saveErrorText,
  withCheckExpression,
  withCheckMessage,
  withCheckPlainText,
} from "./node-edit";
import { ProcessDiagram } from "./diagram";
import { StepScreen } from "./StepScreen";
import { Timeline } from "./Timeline";
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
    if (testCaseId === null || at !== null) {
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

  // onGenerateTests asks the AI for test cases for the red edges of
  // the version. A created case has no cached query, so only the
  // coverage invalidation runs; the tester opens the new case by
  // hand.
  const [generating, setGenerating] = useState(false);
  async function onGenerateTests() {
    setGenerating(true);
    try {
      const answer = await generateTests(version.id);
      toast.success(`${answer.created.length} test cases created.`);
      void queryClient.invalidateQueries({
        queryKey: ["coverage", version.id],
      });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "The generation did not run.",
      );
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
    content = (
      <>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <span className="font-mono text-sm">{`Test case ${loaded.case.reference}`}</span>
          <Badge variant="secondary">{`v${version.number}`}</Badge>
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
            <span className="font-mono text-[12px] text-muted-foreground">
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
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            New test case
          </Button>
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
                className="flex shrink-0 items-center gap-2 border-b bg-blue-50 px-4 py-2 text-sm"
              >
                <Rewind className="size-4 shrink-0" />
                <span>{`Replay at event ${at}. The commands wait for the present.`}</span>
                <span className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => setAt(null)}>
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
            <div className="flex max-h-56 shrink-0 flex-col overflow-y-auto border-t">
              {eventsQuery.isError ? (
                <div className="flex flex-col gap-0.5 px-4 py-2 text-sm">
                  <span>The events did not load.</span>
                  <span className="text-muted-foreground">
                    {eventsQuery.error instanceof ApiError
                      ? eventsQuery.error.message
                      : String(eventsQuery.error)}
                  </span>
                </div>
              ) : eventsQuery.data === undefined ? (
                <div className="px-4 py-2 text-sm text-muted-foreground">
                  Loading the events
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1 px-4 py-1.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Go to the start"
                      disabled={count === 0 || at === 1}
                      onClick={() => setAt(count === 0 ? null : 1)}
                    >
                      <ChevronsLeft className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Step back"
                      disabled={n <= 1}
                      onClick={() => setAt(n - 1)}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Step forward"
                      disabled={at === null}
                      onClick={() => setAt(n === count ? null : n + 1)}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Go to the end"
                      disabled={at === null}
                      onClick={() => setAt(null)}
                    >
                      <ChevronsRight className="size-4" />
                    </Button>
                    <span className="ml-2 font-mono text-[12px] text-muted-foreground">
                      {`${n} of ${count}`}
                    </span>
                  </div>
                  <Timeline
                    def={def}
                    events={events}
                    at={at}
                    onSelect={setAt}
                  />
                </>
              )}
            </div>
          </div>
          <aside
            aria-label="Step screen"
            className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l"
          >
            <div
              role="tablist"
              aria-label="Case panel"
              className="grid grid-cols-3 gap-0.5 border-b p-1"
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
            {panelTab === "screen" && (
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
                readOnly={at !== null}
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
