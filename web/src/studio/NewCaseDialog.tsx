// The new test case dialog: one generated input per non-computed
// field of the definition. Nothing is created here: the body hands
// the values to the caller (TestScreen), which creates the case and
// runs the start command. The body is a plain component, so the tests
// render it with no Dialog context: the title and the description
// are plain elements (the pattern of lot 2.4).

import { useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import { FieldInput } from "./field-inputs";
import type { ProcessDefinition } from "./types";

export function NewCaseDialogBody({ def, busy, error, onCreate, onClose }: {
  def: ProcessDefinition;
  busy: boolean;
  error: string | null;
  onCreate: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  // The values the tester changed, keyed by field name. The body
  // mounts fresh at each dialog open (Radix mounts the content when
  // open), so the values are empty at open without a reset effect.
  const [values, setValues] = useState<Record<string, unknown>>({});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold leading-tight">New test case</h2>
        <p className="text-sm text-muted-foreground">
          The case runs the opened version. Test data never enters
          production.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {def.fields
          .filter((field) => field.computed === null)
          .map((field) => (
            <label key={field.name} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{field.label}</span>
              <FieldInput
                field={field}
                value={values[field.name]}
                onChange={(v) =>
                  setValues((old) => ({ ...old, [field.name]: v }))
                }
                disabled={busy}
              />
            </label>
          ))}
      </div>
      {error !== null && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => onCreate({ ...values })}>
          Create and start
        </Button>
      </div>
    </div>
  );
}

export function NewCaseDialog({ open, onOpenChange, def, busy, error, onCreate, onClose }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  def: ProcessDefinition;
  busy: boolean;
  error: string | null;
  onCreate: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="New test case" className="max-h-[85vh] overflow-y-auto">
        <NewCaseDialogBody
          def={def}
          busy={busy}
          error={error}
          onCreate={onCreate}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
