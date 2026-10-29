// The replay dialog: the tester picks one submit before the replay
// point, edits its values, and creates the copy. Nothing is created
// here: the body hands the patch to the caller (TestScreen), which
// runs it. The body is a plain component, so the tests render it with
// no Dialog context: the title is a plain element (the NewCaseDialog
// pattern). Radix mounts the content at each open, so the local state
// starts fresh at each open without a reset effect.

import { useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import { FieldInput } from "./field-inputs";
import { submitsOf } from "./replay";
import type { CaseEvent } from "./case-api";
import type { ProcessDefinition } from "./types";

// nodeNameOf gives the node name of a submit, the raw id when the
// definition holds no such node.
function nodeNameOf(def: ProcessDefinition, nodeId: string): string {
  return def.nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
}

export function ReplayDialogBody({ def, events, at, busy, error, onCreate, onClose }: {
  def: ProcessDefinition;
  events: CaseEvent[];
  at: number;
  busy: boolean;
  error: string | null;
  onCreate: (patch: { seq: number; values: Record<string, unknown> } | null) => void;
  onClose: () => void;
}) {
  const submits = submitsOf(events, at);
  // The selected submit and the local values. The initial value is the
  // first entry; each select change resets both, so the local values
  // start as the selected submit's values.
  const [selected, setSelected] = useState<number | null>(
    submits[0]?.seq ?? null,
  );
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(submits[0]?.values ?? {}),
  }));
  const selectedSubmit =
    submits.find((s) => s.seq === selected) ?? null;
  // One field of the definition per key of the selected values, in
  // definition order.
  const fields =
    selectedSubmit === null
      ? []
      : def.fields.filter((f) =>
          Object.hasOwn(selectedSubmit.values, f.name),
        );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold leading-tight">
          {`Replay from event ${at}`}
        </h2>
        <p className="text-sm text-muted-foreground">
          The copy runs the same commands in a new test case. Change a
          value below, or create the copy as is.
        </p>
      </div>
      {submits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {`No submitted values before event ${at}.`}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Values to change</span>
            <Select
              value={selectedSubmit === null ? undefined : String(selectedSubmit.seq)}
              onValueChange={(v) => {
                const submit = submits.find((s) => String(s.seq) === v);
                if (submit === undefined) {
                  return;
                }
                setSelected(submit.seq);
                setValues({ ...submit.values });
              }}
            >
              <SelectTrigger aria-label="Values to change" className="w-full">
                {/* A closed Radix select renders no selected label on
                    the server, so the label goes in as children. */}
                <SelectValue>
                  {selectedSubmit === null
                    ? ""
                    : `${nodeNameOf(def, selectedSubmit.node_id)} · event ${selectedSubmit.seq}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {submits.map((s) => (
                  <SelectItem key={s.seq} value={String(s.seq)}>
                    {`${nodeNameOf(def, s.node_id)} · event ${s.seq}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{field.label}</span>
              <FieldInput
                field={field}
                value={values[field.name]}
                onChange={(v) =>
                  setValues((old) => ({ ...old, [field.name]: v }))
                }
                disabled={false}
              />
            </label>
          ))}
        </>
      )}
      {error !== null && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            onCreate(
              selectedSubmit === null
                ? null
                : { seq: selectedSubmit.seq, values: { ...values } },
            )
          }
        >
          Create the copy
        </Button>
      </div>
    </div>
  );
}

export function ReplayDialog({ open, onOpenChange, def, events, at, busy, error, onCreate, onClose }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  def: ProcessDefinition;
  events: CaseEvent[];
  at: number;
  busy: boolean;
  error: string | null;
  onCreate: (patch: { seq: number; values: Record<string, unknown> } | null) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="Replay" className="max-h-[85vh] overflow-y-auto">
        <ReplayDialogBody
          def={def}
          events={events}
          at={at}
          busy={busy}
          error={error}
          onCreate={onCreate}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
