// The scan dialog: one scan with its SAM zones as boxes on the
// image, and the sign action in mode sign. The body is a plain
// component, so the tests render it with no Dialog context (the
// pattern of lot 2.4); the shell mounts the body only while open, so
// the zones query runs on open.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "./api";
import {
  documentBytesUrl,
  readZones,
  type DocumentDTO,
  type ZoneDTO,
} from "./doc-api";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";

// zoneStyle gives the absolute position of one zone box in percent
// of the natural image size.
export function zoneStyle(
  zone: ZoneDTO,
  size: { width: number; height: number },
): React.CSSProperties {
  return {
    left: `${(zone.box.x / size.width) * 100}%`,
    top: `${(zone.box.y / size.height) * 100}%`,
    width: `${(zone.box.width / size.width) * 100}%`,
    height: `${(zone.box.height / size.height) * 100}%`,
  };
}

// ZoneOverlay draws one box per zone over the image. Without the
// natural size it draws nothing: the percents need it.
export function ZoneOverlay({ zones, size }: {
  zones: ZoneDTO[];
  size: { width: number; height: number } | null;
}) {
  if (size === null) {
    return null;
  }
  return (
    <>
      {zones.map((zone, i) => (
        <div key={i} style={zoneStyle(zone, size)} className="absolute border-2 border-primary">
          <span className="bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
            {zone.label}
          </span>
        </div>
      ))}
    </>
  );
}

// ScanDialogBody shows one scan: the name and the hash, the image
// with the zone boxes, the zone lines, the field reading in mode view
// when the read props are given, and the sign action in mode sign. It
// mounts only while the dialog is open, so its query runs on open.
export function ScanDialogBody({ doc, mode, onSign, reading, readValues, onRead, fillTargets, onFill }: {
  doc: DocumentDTO;
  mode: "view" | "sign";
  onSign: (hash: string) => void;
  reading?: boolean;
  readValues?: Record<string, unknown> | null;
  onRead?: () => void;
  fillTargets?: { name: string; label: string; type: string }[];
  onFill?: (values: Record<string, unknown>) => void;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const zonesQuery = useQuery({
    queryKey: ["zones", doc.id],
    queryFn: () => readZones(doc.id),
  });
  const zones = zonesQuery.data;
  const hasSignatureZone =
    zones !== undefined && zones.some((zone) => zone.label === "signature");
  const signBlocked = zonesQuery.isPending || (zones !== undefined && !hasSignatureZone);
  // The read block renders in mode view when the five read props are
  // present. readValues uses !== undefined: null is a value, it means
  // "not read yet".
  const canRead =
    mode === "view" &&
    reading !== undefined &&
    readValues !== undefined &&
    onRead !== undefined &&
    fillTargets !== undefined &&
    onFill !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold leading-tight">{doc.name}</h2>
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 truncate font-mono text-[12px] text-muted-foreground"
            title={`sha256:${doc.sha256}`}
          >{`sha256:${doc.sha256}`}</span>
          {mode === "view" && (
            <Badge variant="secondary" className="shrink-0">
              Read only
            </Badge>
          )}
        </div>
      </div>
      {zonesQuery.isError && (
        <p className="text-destructive text-sm">
          {`The zones did not load: ${
            zonesQuery.error instanceof ApiError
              ? zonesQuery.error.message
              : String(zonesQuery.error)
          }`}
        </p>
      )}
      {zonesQuery.isPending && (
        <p className="text-sm text-muted-foreground">Detecting the zones...</p>
      )}
      <div className="relative mx-auto w-fit">
        <img
          src={documentBytesUrl(doc.id)}
          alt={`Scan ${doc.name}`}
          className="block max-h-[320px] w-auto max-w-full"
          onLoad={(e) =>
            setSize({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            })
          }
        />
        <div className="pointer-events-none absolute inset-0">
          <ZoneOverlay zones={zones ?? []} size={size} />
        </div>
      </div>
      {zones !== undefined && (
        <div className="flex flex-col gap-0.5">
          {zones.map((zone, i) => (
            <p key={i} className="text-[12px]">
              {`${zone.label}: ${zone.box.x}, ${zone.box.y}, ${zone.box.width}, ${zone.box.height}`}
            </p>
          ))}
        </div>
      )}
      {canRead && (
        <div className="flex flex-col gap-1.5">
          <Button disabled={reading} onClick={onRead}>
            Read the fields
          </Button>
          {reading && (
            <p className="text-sm text-muted-foreground">
              Reading the fields...
            </p>
          )}
          {readValues !== null && (
            <>
              <div className="flex flex-col gap-0.5">
                {fillTargets.map((field) => {
                  const value = readValues[field.name];
                  return (
                    <p key={field.name} className="text-[12px]">
                      {value === null || value === undefined
                        ? `${field.label}: not read`
                        : `${field.label}: ${String(value)}`}
                    </p>
                  );
                })}
              </div>
              <Button onClick={() => onFill(readValues)}>Fill the form</Button>
            </>
          )}
        </div>
      )}
      {mode === "sign" && (
        <div className="flex flex-col gap-1">
          <Button disabled={signBlocked} onClick={() => onSign(doc.sha256)}>
            Sign this document
          </Button>
          {signBlocked && zones !== undefined && (
            <p className="text-destructive text-sm">
              No signature zone on this scan.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ScanDialog({ open, onOpenChange, doc, mode, onSign, readFields, fillTargets, onFill }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: DocumentDTO;
  mode: "view" | "sign";
  onSign: (hash: string) => void;
  readFields?: (doc: DocumentDTO) => Promise<Record<string, unknown>>;
  fillTargets?: { name: string; label: string; type: string }[];
  onFill?: (values: Record<string, unknown>) => void;
}) {
  // The read state: one read at a time, the values of the last read.
  // Each dialog open is a fresh mount, so no reset is needed.
  const [reading, setReading] = useState(false);
  const [readValues, setReadValues] = useState<Record<string, unknown> | null>(null);
  const handleRead = async () => {
    if (readFields === undefined) {
      return;
    }
    setReading(true);
    try {
      setReadValues(await readFields(doc));
    } catch (err) {
      setReadValues(null);
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setReading(false);
    }
  };
  // The read props go down only when the three inputs are given, so
  // the lot 5.2 renders stay valid without them.
  const readProps =
    readFields === undefined || fillTargets === undefined || onFill === undefined
      ? {}
      : {
          reading,
          readValues,
          onRead: handleRead,
          fillTargets,
          onFill,
        };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label={doc.name} className="max-h-[85vh] overflow-y-auto">
        <ScanDialogBody doc={doc} mode={mode} onSign={onSign} {...readProps} />
      </DialogContent>
    </Dialog>
  );
}
