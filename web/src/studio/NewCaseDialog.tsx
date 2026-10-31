// The new test case dialog: one generated input per non-computed
// field of the definition. Nothing is created here: the body hands
// the values to the caller (TestScreen), which creates the case and
// runs the start command. The body is a plain component, so the tests
// render it with no Dialog context: the title and the description
// are plain elements (the pattern of lot 2.4).

import { useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, focusContent } from "@/ui/dialog";
import { Hint } from "@/ui/hint";
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
    <div className="flex max-h-[80vh] flex-col">
      <div className="flex items-center gap-1.5 pb-3">
        <h2 className="text-lg font-semibold leading-tight">New test case</h2>
        <Hint label="About test cases" side="bottom">
          The case runs the opened version. Test data never enters
          production.
        </Hint>
      </div>
      <div className="-mx-1 grid min-h-0 grid-cols-2 gap-x-3 gap-y-2.5 overflow-y-auto px-1 pb-1">
        {def.fields
          .filter((field) => field.computed === null)
          .map((field) => (
            <label
              key={field.name}
              className={`flex min-w-0 flex-col gap-1 ${field.type === "document" ? "col-span-2" : ""}`}
            >
              <span className="truncate text-[12.5px] font-medium">{field.label}</span>
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
      {error !== null && <p className="pt-2 text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2 border-t pt-3 mt-3">
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
      <DialogContent
        aria-label="New test case"
        className="sm:max-w-[560px]"
        onOpenAutoFocus={focusContent}
      >
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
