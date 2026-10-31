// The inbox screen: the cases that wait for a role of the picked
// user, with the filter tabs, the search and the take action. The
// row details come from the case and events caches; AppShell owns
// the inbox answer and passes it down.

import { useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "../studio/api";
import {
  listEvents,
  readCase,
  runCommand,
  type CaseEvent,
  type CaseState,
  type UserDTO,
} from "../studio/case-api";
import { initials } from "../studio/case-view";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import type { Field, FieldType, ProcessDefinition } from "../studio/types";
import type { InboxCase } from "./app-api";
import { inTab, matchesSearch, originOf, tabCounts, TABS, type InboxItem, type InboxTab } from "./inbox";
import { Pill } from "./TriageScreen";
import { dueText, enteredAt, msLeft, receivedText } from "./triage";

// pickField gives the first field of one type, else null.
export function pickField(
  def: ProcessDefinition,
  type: FieldType,
): Field | null {
  return def.fields.find((field) => field.type === type) ?? null;
}

const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
});

// moneyText formats one money value; anything but a number gives -.
export function moneyText(value: unknown): string {
  return typeof value === "number" ? eur.format(value) : "-";
}

// dayTimeText gives the short UTC date form: day, month and time,
// with the seconds only when withSeconds is true.
export function dayTimeText(iso: string, withSeconds: boolean): string {
  return new Date(iso).toLocaleString("en-IE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    timeZone: "UTC",
  });
}

const H = 3_600_000;

// dash fills a cell while its data is pending or null.
const dash = <span className="text-muted-foreground">-</span>;

// InboxRow renders one inbox row from the case answer and the events
// that InboxScreen reads. The take action stays in the row.
function InboxRow({
  def,
  userId,
  users,
  now,
  row,
  item,
  state,
  events,
  onOpenCase,
}: {
  def: ProcessDefinition;
  userId: string;
  users: UserDTO[];
  now: number;
  row: InboxCase;
  item: InboxItem;
  state: CaseState | undefined;
  events: CaseEvent[] | undefined;
  onOpenCase: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const moneyField = pickField(def, "money");
  const strings = def.fields.filter((field) => field.type === "string");
  const second =
    state === undefined || strings[1] === undefined
      ? undefined
      : state.data[strings[1].name];
  const amount =
    state === undefined || moneyField === null
      ? "-"
      : moneyText(state.data[moneyField.name]);
  const node = def.nodes.find((n) => n.id === row.node_id);
  const nodeName = node?.name ?? row.node_id;
  const entered = events === undefined ? null : enteredAt(events, row.node_id);
  const origin = events === undefined ? null : originOf(def, events, row.node_id);
  const due = dueText(item.msLeft);
  const dueAt =
    entered === null || node?.deadline_hours == null
      ? null
      : new Date(Date.parse(entered) + node.deadline_hours * H).toISOString();
  const assigneeName =
    users.find((u) => u.id === item.assignee)?.name ?? item.assignee ?? "";

  // take runs the take command, refreshes the case and the inbox,
  // then opens the case. A failure shows a toast and stays.
  async function take() {
    setBusy(true);
    try {
      await runCommand(row.id, userId, { type: "take" });
      void queryClient.invalidateQueries({ queryKey: ["case", row.id] });
      void queryClient.invalidateQueries({ queryKey: ["inbox", userId] });
      onOpenCase(row.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr
      tabIndex={0}
      aria-label={`${row.reference}, ${item.client ?? "-"}`}
      className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/50"
      onClick={() => onOpenCase(row.id)}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          (e.target as HTMLElement).tagName !== "BUTTON"
        ) {
          onOpenCase(row.id);
        }
      }}
    >
      <td className="whitespace-nowrap px-3 py-3 font-mono text-[13px]">{row.reference}</td>
      <td className="px-3 py-3 text-sm">
        {item.client ?? "-"}
        {typeof second === "string" && (
          <div className="text-xs text-muted-foreground">{second}</div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right text-sm">{amount}</td>
      <td className="px-3 py-3 text-sm">{nodeName}</td>
      <td className="px-3 py-3 text-sm">
        {origin === null || entered === null ? (
          dash
        ) : (
          <>
            <span className="whitespace-nowrap rounded-full border px-2 py-0.5 text-xs">
              {origin}
            </span>
            <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
              {receivedText(entered, now)}
            </div>
          </>
        )}
      </td>
      <td className="px-3 py-3 text-sm">
        {item.assignee === null ? (
          dash
        ) : item.assignee === "" ? (
          <span className="text-muted-foreground">Not taken</span>
        ) : (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
              {initials(assigneeName)}
            </span>
            {assigneeName}
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-sm">
        {due === null || dueAt === null ? (
          dash
        ) : (
          <>
            <Pill tone={due.tone} text={due.text} />
            <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
              {dayTimeText(dueAt, false)}
            </div>
          </>
        )}
      </td>
      <td className="px-3 py-3 text-right">
        {state === undefined ? (
          dash
        ) : state.assignee === "" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void take();
            }}
          >
            Take the case
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCase(row.id);
            }}
          >
            Open
          </Button>
        )}
      </td>
    </tr>
  );
}

export function InboxScreen({
  def,
  userId,
  users,
  now,
  cases,
  roleNames,
  onOpenCase,
}: {
  def: ProcessDefinition;
  userId: string;
  users: UserDTO[];
  now: number;
  cases: InboxCase[];
  roleNames: string;
  onOpenCase: (id: string) => void;
}) {
  const [tab, setTab] = useState<InboxTab>("all");
  const [search, setSearch] = useState("");
  const caseQs = useQueries({
    queries: cases.map((row) => ({
      queryKey: ["case", row.id],
      queryFn: () => readCase(row.id),
    })),
  });
  const eventQs = useQueries({
    queries: cases.map((row) => ({
      queryKey: ["events", row.id],
      queryFn: () => listEvents(row.id),
    })),
  });

  const stringField = pickField(def, "string");
  const items: InboxItem[] = cases.map((row, i) => {
    const state = caseQs[i]?.data?.state;
    const events = eventQs[i]?.data;
    const name =
      state === undefined || stringField === null
        ? undefined
        : state.data[stringField.name];
    const node = def.nodes.find((n) => n.id === row.node_id);
    return {
      id: row.id,
      reference: row.reference,
      client: typeof name === "string" ? name : null,
      assignee: state?.assignee ?? null,
      msLeft:
        events === undefined || node === undefined
          ? null
          : msLeft(enteredAt(events, row.node_id), node.deadline_hours, now),
    };
  });
  const counts = tabCounts(items, userId);
  const shown = items.filter(
    (item) => inTab(item, tab, userId) && matchesSearch(item, search),
  );

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {`Cases that wait for the roles of ${roleNames}. The first taker owns the case.`}
        </p>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
          <div role="group" aria-label="Filter" className="flex rounded-lg bg-muted p-0.5">
            {TABS.map(({ tab: t, text }) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                className={`rounded-md px-3 py-1 text-sm ${
                  tab === t ? "bg-background font-medium shadow-sm" : ""
                }`}
                onClick={() => setTab(t)}
              >
                {text}
                <span className="ml-1.5 text-muted-foreground">{counts[t]}</span>
              </button>
            ))}
          </div>
          <div className="relative w-[280px]">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search by case number or client"
              title="Case number or client"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Case</th>
                <th className="px-3 py-2.5 font-medium">Client</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">Step</th>
                <th className="px-3 py-2.5 font-medium">Origin</th>
                <th className="px-3 py-2.5 font-medium">Assigned to</th>
                <th className="px-3 py-2.5 font-medium">Deadline</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => {
                const i = items.indexOf(item);
                return (
                  <InboxRow
                    key={item.id}
                    def={def}
                    userId={userId}
                    users={users}
                    now={now}
                    row={cases[i]!}
                    item={item}
                    state={caseQs[i]?.data?.state}
                    events={eventQs[i]?.data}
                    onOpenCase={onOpenCase}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        {cases.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No case waits for your roles.
          </p>
        ) : (
          shown.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No case matches the filter.
            </p>
          )
        )}
        <div className="border-t px-4 py-2.5 text-[13px] text-muted-foreground">
          Open a case to work on its step.
        </div>
      </div>
    </div>
  );
}
