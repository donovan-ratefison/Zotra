// The scan dialog: one scan with its SAM zones as boxes on the
// image, and the sign action in mode sign. The body is a plain
// component, so the tests render it with no Dialog context (the
// pattern of lot 2.4); the shell mounts the body only while open, so
// the zones query runs on open.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "./api";
import { documentBytesUrl, readZones, type DocumentDTO, type ZoneDTO } from "./doc-api";
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
      {zones.map((zone) => (
        <div key={zone.label} style={zoneStyle(zone, size)} className="absolute border-2 border-primary">
          <span className="bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
            {zone.label}
          </span>
        </div>
      ))}
    </>
  );
}

// ScanDialogBody shows one scan: the name and the hash, the image
// with the zone boxes, the zone lines, and the sign action in mode
// sign. It mounts only while the dialog is open, so its query runs
// on open.
export function ScanDialogBody({ doc, mode, onSign }: {
  doc: DocumentDTO;
  mode: "view" | "sign";
  onSign: (hash: string) => void;
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold leading-tight">{doc.name}</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-muted-foreground">{`sha256:${doc.sha256}`}</span>
          {mode === "view" && <Badge variant="secondary">Read only</Badge>}
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
      <div className="relative">
        <img
          src={documentBytesUrl(doc.id)}
          alt={`Scan ${doc.name}`}
          className="max-h-[320px] w-full object-contain"
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
          {zones.map((zone) => (
            <p key={zone.label} className="text-[12px]">
              {`${zone.label}: ${zone.box.x}, ${zone.box.y}, ${zone.box.width}, ${zone.box.height}`}
            </p>
          ))}
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

export function ScanDialog({ open, onOpenChange, doc, mode, onSign }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: DocumentDTO;
  mode: "view" | "sign";
  onSign: (hash: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label={doc.name} className="max-h-[85vh] overflow-y-auto">
        <ScanDialogBody doc={doc} mode={mode} onSign={onSign} />
      </DialogContent>
    </Dialog>
  );
}
