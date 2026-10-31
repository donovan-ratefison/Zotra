// The documents dialog of the triage: the case documents at the left,
// the selected scan with its zone boxes in the center, the zone results
// and the consequence for the step at the right. The body is a plain
// component, so the tests render it with no Dialog context.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, FileText, FileX, Info, Lock, ShieldCheck } from "lucide-react";
import { ApiError } from "../studio/api";
import type { CaseEvent } from "../studio/case-api";
import { documentBytesUrl, readZones, type DocumentDTO } from "../studio/doc-api";
import { ZoneOverlay } from "../studio/ScanDialog";
import type { ProcessNode } from "../studio/types";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, focusContent } from "@/ui/dialog";
import { Hint } from "@/ui/hint";
import { dayTimeText } from "./InboxScreen";
import { Kbd } from "./TriageScreen";
import { docConsequence, docStep, zoneText, type DocRow } from "./triage";

interface BodyProps {
  reference: string;
  client: string;
  node: ProcessNode;
  events: CaseEvent[];
  rows: DocRow[];
  index: number;
  onIndex: (i: number) => void;
}

const CONSEQUENCE = {
  bad: { box: "bg-red-900 text-white border-red-900", Icon: Lock },
  ok: { box: "bg-green-50 text-green-900 border-green-200", Icon: CircleCheck },
  none: { box: "bg-zinc-50", Icon: Info },
};

// ScanStage shows one scan with its zone boxes. Its parent keys it by
// the scan id, so the natural size resets on a document change.
function ScanStage({ scan, zones, zonesShown }: {
  scan: DocumentDTO;
  zones: Parameters<typeof ZoneOverlay>[0]["zones"];
  zonesShown: boolean;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <div className="relative mx-auto w-fit">
      <img
        src={documentBytesUrl(scan.id)}
        alt={`Scan ${scan.name}`}
        className="block max-h-[calc(90vh-150px)] w-auto max-w-full shadow-md"
        onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
      />
      <div className="pointer-events-none absolute inset-0">
        {zonesShown && <ZoneOverlay zones={zones} size={size} />}
      </div>
    </div>
  );
}

export function TriageDocumentsBody(props: BodyProps & {
  zonesShown: boolean;
  onZonesShown: (on: boolean) => void;
  onClose: () => void;
}) {
  const { rows, index, node, zonesShown } = props;
  const row = rows[index]!;
  const scan = row.scan;
  const zonesQ = useQuery({
    queryKey: ["zones", scan?.id],
    queryFn: () => readZones(scan!.id),
    enabled: scan !== null,
  });
  const cons = docConsequence(row, node, props.events);
  const { box, Icon } = CONSEQUENCE[cons.tone];
  const attached = rows.filter((r) => r.scan !== null).length;
  const segment = (on: boolean) =>
    cn(
      "px-2.5 py-0.5 text-xs text-muted-foreground",
      on && "border-r",
      zonesShown === on && "bg-primary/10 font-medium text-primary",
    );

  return (
    <>
      <header className="flex items-center gap-3 border-b pr-3 pl-[18px] text-[13px]">
        <FileText className="size-4" />
        <b className="text-[14px] font-semibold whitespace-nowrap">{row.name}</b>
        <span className="truncate font-mono text-muted-foreground">{`${props.reference} · ${props.client}`}</span>
        <span className="ml-auto flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Change document
        </span>
        <Button variant="outline" size="sm" onClick={props.onClose}>
          <Kbd>Esc</Kbd>
          Back to the case
        </Button>
      </header>

      <div className="grid min-h-0 grid-cols-[236px_minmax(0,1fr)_330px]">
        <section className="flex min-h-0 flex-col border-r">
          <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5 text-[13px]">
            <b className="font-semibold">Documents</b>
            <small className="text-xs text-muted-foreground">{`${attached} of ${rows.length} attached`}</small>
          </div>
          <div className="grid gap-1 px-2">
            {rows.map((r, i) => (
              <button
                key={r.name}
                type="button"
                aria-current={i === index}
                onClick={() => props.onIndex(i)}
                className={cn(
                  "grid grid-cols-[38px_minmax(0,1fr)] items-center gap-2.5 rounded-[7px] border border-transparent px-2 py-[7px] text-left hover:bg-stone-50",
                  i === index && "border-primary/30 bg-primary/10 hover:bg-primary/10",
                )}
              >
                <span className="relative grid h-12 w-[38px] content-start gap-[3px] rounded-[3px] border border-stone-300 bg-[#fcfbf6] px-[5px] py-1.5 shadow-sm">
                  <i className="h-0.5 w-3/5 rounded-full bg-stone-500" />
                  <i className="h-0.5 rounded-full bg-stone-300" />
                  <i className="h-0.5 rounded-full bg-stone-300" />
                  <i className="h-0.5 rounded-full bg-stone-300" />
                  <span
                    className={`absolute -right-1 -bottom-1 size-3 rounded-full border-2 border-white ${
                      r.scan !== null ? "bg-green-600" : "bg-red-600"
                    }`}
                  />
                </span>
                <span className="min-w-0">
                  <b className="block truncate text-[12.5px] font-medium">{r.name}</b>
                  <small className={`block truncate text-[11.5px] ${r.scan !== null ? "text-muted-foreground" : "text-red-700"}`}>
                    {r.scan !== null ? r.scan.name : "Missing"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {scan !== null && (
            <div className="mt-auto grid gap-[3px] border-t px-3.5 py-2.5 text-[11.5px] text-muted-foreground">
              <div>{`Added ${dayTimeText(scan.created_at, false)}.`}</div>
              <div>
                {"Fingerprint "}
                <span className="font-mono text-[11px] text-foreground" title={`sha256:${scan.sha256}`}>
                  {`sha256 ${scan.sha256.slice(0, 6)}…${scan.sha256.slice(-6)}`}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="flex min-h-0 flex-col bg-[#e7e7e4]">
          {scan !== null && (
            <div className="flex items-center gap-2.5 border-b bg-white px-3 py-2 text-[12.5px]">
              <FileText className="size-4 shrink-0" />
              <span className="min-w-0 truncate font-medium">{scan.name}</span>
              <span className="ml-auto inline-flex shrink-0 overflow-hidden rounded-md border bg-white">
                <button type="button" aria-pressed={zonesShown} className={segment(true)} onClick={() => props.onZonesShown(true)}>
                  Zones shown
                </button>
                <button type="button" aria-pressed={!zonesShown} className={segment(false)} onClick={() => props.onZonesShown(false)}>
                  Zones hidden
                </button>
              </span>
            </div>
          )}
          <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4">
            {scan !== null ? (
              <ScanStage key={scan.id} scan={scan} zones={zonesQ.data ?? []} zonesShown={zonesShown} />
            ) : (
              <div className="grid justify-items-center gap-1.5 text-center text-[13px] text-muted-foreground">
                <FileX className="size-8 text-red-600" />
                <b className="font-semibold text-red-700">Missing</b>
                <span>{`No scan for ${row.name} on this case.`}</span>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col border-l">
          <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5 text-[13px]">
            <span className="flex items-center gap-1.5">
              <b className="font-semibold">Document check</b>
              <Hint label="About the document check">
                A participant attaches the scan at its step. The document model (SAM 3.1) finds the zones on the scan.
                The process rule decides. Rules and humans decide. The AI only checks.
              </Hint>
            </span>
            <small className="truncate pl-2 text-xs text-muted-foreground">{row.name}</small>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-3.5 pb-3">
            {scan !== null && (
              <>
                {zonesQ.isError ? (
                  <p className="text-[12.5px] text-red-700">
                    {`The zones did not load: ${
                      zonesQ.error instanceof ApiError ? zonesQ.error.message : String(zonesQ.error)
                    }`}
                  </p>
                ) : zonesQ.data === undefined ? (
                  <p className="text-[12.5px] text-muted-foreground">Detecting the zones...</p>
                ) : zonesQ.data.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">The document model found no zone on this scan.</p>
                ) : (
                  <div className="grid gap-1.5">
                    {zonesQ.data.map((z, i) => {
                      const t = zoneText(z);
                      return (
                        <div key={i} className="flex items-start gap-2.5 rounded-md border px-2.5 py-2">
                          <CircleCheck className="size-[22px] shrink-0 fill-green-600 text-white" />
                          <div className="min-w-0">
                            <b className="block text-[13px] font-medium">{t.title}</b>
                            <small className="block font-mono text-[10.5px] text-muted-foreground">{t.detail}</small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${box}`}>
              <Icon className="mt-0.5 size-4 shrink-0" />
              <div>
                <b className="block text-[13.5px] leading-snug font-semibold">{cons.title}</b>
                <small className="mt-0.5 block text-xs leading-snug opacity-85">{cons.detail}</small>
              </div>
            </div>
            {cons.tone === "bad" && (
              <p className="mt-auto flex items-start gap-2 rounded-[7px] border border-zinc-100 bg-stone-50 px-3 py-2.5 text-xs text-zinc-700">
                <ShieldCheck className="mt-px size-3.5 shrink-0 text-primary" />
                <span>You cannot close the step yet.</span>
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export function TriageDocuments(props: BodyProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseFocus: () => void;
}) {
  const [zonesShown, setZonesShown] = useState(true);
  const { rows, index, onIndex } = props;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label={rows[index]!.name}
        onOpenAutoFocus={focusContent}
        aria-describedby={undefined}
        className="top-[5vh] left-[5vw] h-[90vh] w-[90vw] max-w-none translate-x-0 translate-y-0 grid-rows-[50px_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-none"
        onKeyDown={(e) => {
          const next = docStep(e.key, index, rows.length);
          if (next === null) return;
          e.preventDefault();
          onIndex(next);
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          props.onCloseFocus();
        }}
      >
        <TriageDocumentsBody
          {...props}
          zonesShown={zonesShown}
          onZonesShown={setZonesShown}
          onClose={() => props.onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
