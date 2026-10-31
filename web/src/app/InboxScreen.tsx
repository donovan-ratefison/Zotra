// The inbox screen: the cases that wait for a role of the picked
// user, with the take action. The row details come from the case
// cache; AppShell owns the inbox answer and passes it down.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "../studio/api";
import { readCase, runCommand } from "../studio/case-api";
import { Button } from "@/ui/button";
import type { Field, FieldType, ProcessDefinition } from "../studio/types";
import type { InboxCase } from "./app-api";

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

// InboxRow renders one inbox row. Its case query feeds the client,
// the amount, the assignee and the take or open action.
function InboxRow({
  def,
  userId,
  row,
  onOpenCase,
}: {
  def: ProcessDefinition;
  userId: string;
  row: InboxCase;
  onOpenCase: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["case", row.id],
    queryFn: () => readCase(row.id),
  });
  const [busy, setBusy] = useState(false);

  const state = query.data?.state;
  const stringField = pickField(def, "string");
  const moneyField = pickField(def, "money");
  let client = "-";
  let amount = "-";
  if (state !== undefined) {
    const name =
      stringField === null ? undefined : state.data[stringField.name];
    if (typeof name === "string") {
      client = name;
    }
    if (moneyField !== null) {
      amount = moneyText(state.data[moneyField.name]);
    }
  }
  const nodeName =
    def.nodes.find((node) => node.id === row.node_id)?.name ?? row.node_id;

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
      aria-label={`${row.reference}, ${client}`}
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
      <td className="px-4 py-3 font-mono text-[13px]">{row.reference}</td>
      <td className="px-4 py-3 text-sm">{client}</td>
      <td className="px-4 py-3 text-right text-sm">{amount}</td>
      <td className="px-4 py-3 text-sm">{nodeName}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {dayTimeText(row.created_at, false)}
      </td>
      <td className="px-4 py-3 text-right">
        {state === undefined ? (
          <span className="text-sm text-muted-foreground">-</span>
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
  cases,
  roleNames,
  onOpenCase,
}: {
  def: ProcessDefinition;
  userId: string;
  cases: InboxCase[];
  roleNames: string;
  onOpenCase: (id: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[1000px] px-8 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {`Cases that wait for the roles of ${roleNames}. The first taker owns the case.`}
        </p>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Case</th>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">Step</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {cases.map((row) => (
                <InboxRow
                  key={row.id}
                  def={def}
                  userId={userId}
                  row={row}
                  onOpenCase={onOpenCase}
                />
              ))}
            </tbody>
          </table>
        </div>
        {cases.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No case waits for your roles.
          </p>
        )}
        <div className="border-t px-4 py-2.5 text-[13px] text-muted-foreground">
          Open a case to work on its step.
        </div>
      </div>
    </div>
  );
}
