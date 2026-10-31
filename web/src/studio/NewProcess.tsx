// The New menu (from a policy or from scratch) and the dialog that
// creates an empty draft. The dialog body is a plain component, so
// the tests render it with no Dialog context.

import { useState } from "react";
import { FilePlus, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { createProcess, createVersion } from "./api";
import { blankDefinition } from "./blank";

export function NewProcessMenu({
  onPolicy,
  onScratch,
  size = "default",
}: {
  onPolicy: () => void;
  onScratch: () => void;
  size?: "sm" | "default";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={size === "sm" ? "outline" : "default"}
          size={size}
          className="shrink-0"
        >
          <Plus aria-hidden="true" />
          New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onPolicy}>
          <Upload aria-hidden="true" />
          From a policy
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onScratch}>
          <FilePlus aria-hidden="true" />
          From scratch
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// canCreate is true when the name holds text and no request runs.
export function canCreate(name: string, busy: boolean): boolean {
  return name.trim() !== "" && !busy;
}

export function ScratchDialogBody({
  onCreated,
  onClose,
}: {
  onCreated: (processId: string, versionId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = canCreate(name, busy);

  async function create() {
    if (!enabled) {
      return;
    }
    const trimmed = name.trim();
    setBusy(true);
    try {
      const process = await createProcess(trimmed);
      const version = await createVersion(process.id, "From scratch", blankDefinition(trimmed));
      onCreated(process.id, version.id);
      toast.success("Draft created.");
      onClose();
    } catch {
      toast.error("The process did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold leading-none">New process from scratch</h2>
        <p className="text-sm text-muted-foreground">
          Start with an empty draft. Add the steps with the toolbar, or ask the assistant to
          build them.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="scratch-name">Process name</Label>
        <Input
          id="scratch-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!enabled}>
          Create
        </Button>
      </div>
    </form>
  );
}

export function ScratchDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (processId: string, versionId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="New process from scratch" aria-describedby={undefined}>
        <ScratchDialogBody onCreated={onCreated} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
