// The review bar: the proposal summary, the deterministic diff and
// the accept and reject actions. It sits under the top bar.

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/ui/button";
import { diffChips, type DiffCounts, type DiffRow } from "./diff";

const ROW_PREFIX = { add: "+", remove: "-", modify: "~" } as const;
const ROW_COLOR = {
  add: "#16a34a",
  remove: "#dc2626",
  modify: "#d97706",
} as const;

export function ProposalBar({ diff, busy, onAccept, onReject }: {
  diff: { counts: DiffCounts; rows: DiffRow[] };
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label="Proposal review"
      className="w-full shrink-0 border-b border-l-4 px-4 py-2"
      style={{ background: "var(--card)", borderLeftColor: "#7c3aed" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">
          The AI proposed a process from the policy.
        </span>
        {diffChips(diff.counts).map((chip) => (
          <span
            key={chip}
            className="rounded-full border px-2 py-0.5 text-[11px] text-zinc-600"
          >
            {chip}
          </span>
        ))}
        <button
          type="button"
          aria-expanded={open}
          className="rounded px-1.5 py-0.5 text-[12px] font-medium text-zinc-600 hover:bg-zinc-100"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide the changes" : "See the changes"}
        </button>
        <span className="flex-1" />
        <Button variant="outline" size="sm" disabled={busy} onClick={onReject}>
          <X aria-hidden="true" />
          Reject
        </Button>
        <Button size="sm" disabled={busy} onClick={onAccept}>
          <Check aria-hidden="true" />
          {busy ? "Accepting..." : "Accept"}
        </Button>
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-0.5">
          {diff.rows.length === 0 ? (
            <p className="text-[12px] text-zinc-500">No change</p>
          ) : (
            diff.rows.map((row) => (
              <div
                key={row.text}
                className="flex gap-1.5 text-[12px] text-zinc-700"
              >
                <span style={{ color: ROW_COLOR[row.kind] }}>
                  {ROW_PREFIX[row.kind]}
                </span>
                <span>{row.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
