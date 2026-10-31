// The bank settings page (/settings): the name, the logo and the two
// colors of the bank profile of the delivered app, with a live
// preview. A change creates no process version.

import { useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { ApiError, fetchBank, saveBank, uploadBankLogo } from "./api";
import type { Bank, Theme } from "./types";
import { brandVars } from "../app/AppShell";
import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";

type BankInput = { name: string; primary_color: string; accent_color: string };

export function isHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

// bankInput gives the body of the save request, or null when a value
// is not valid. The name limit counts code points, as the server does.
export function bankInput(name: string, primary: string, accent: string): BankInput | null {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  if (length === 0 || length > 80 || !isHexColor(primary) || !isHexColor(accent)) {
    return null;
  }
  return { name: trimmed, primary_color: primary.toLowerCase(), accent_color: accent.toLowerCase() };
}

export function bankTheme(bank: Pick<Bank, "name" | "primary_color" | "logo_url">): Theme {
  return { brand_name: bank.name, primary_color: bank.primary_color, logo_url: bank.logo_url };
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}

function LogoTile({ name, color, logoUrl }: { name: string; color: string; logoUrl: string | null }) {
  if (logoUrl !== null) {
    return <img src={logoUrl} alt="" className="size-[34px] rounded-lg object-contain" />;
  }
  return (
    <div
      className="flex size-[34px] shrink-0 items-center justify-center rounded-lg font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {name.charAt(0)}
    </div>
  );
}

export function BankPreview({
  name,
  primary,
  accent,
  logoUrl,
}: {
  name: string;
  primary: string;
  accent: string;
  logoUrl: string | null;
}) {
  return (
    <div
      className="mt-2 overflow-hidden rounded-lg border bg-card"
      style={brandVars(bankTheme({ name, primary_color: primary, logo_url: logoUrl })) as CSSProperties}
    >
      <div className="flex items-center gap-2.5 border-t-[3px] px-4 py-3" style={{ borderTopColor: accent }}>
        <LogoTile name={name} color={primary} logoUrl={logoUrl} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="text-xs text-muted-foreground">Credits</span>
        </div>
      </div>
      <div className="flex justify-end border-t p-4">
        <span className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground">
          Approve
        </span>
      </div>
    </div>
  );
}

function ColorField({
  id,
  label,
  chooseLabel,
  value,
  saved,
  onChange,
}: {
  id: string;
  label: string;
  chooseLabel: string;
  value: string;
  saved: string;
  onChange: (value: string) => void;
}) {
  const valid = isHexColor(value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={chooseLabel}
          className="h-8 w-10 cursor-pointer rounded border p-0.5"
          value={valid ? value.toLowerCase() : saved}
          onChange={(e) => onChange(e.target.value)}
        />
        <Input
          id={id}
          className="font-mono text-[12px]"
          title="#rrggbb"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {!valid && <p className="text-xs text-destructive">Use the form #rrggbb.</p>}
    </div>
  );
}

export function BankForm({
  bank,
  saving,
  uploading,
  onSave,
  onLogo,
}: {
  bank: Bank;
  saving: boolean;
  uploading: boolean;
  onSave: (input: BankInput) => void;
  onLogo: (file: File) => void;
}) {
  const [name, setName] = useState(() => bank.name);
  const [primary, setPrimary] = useState(() => bank.primary_color);
  const [accent, setAccent] = useState(() => bank.accent_color);
  const fileRef = useRef<HTMLInputElement>(null);
  const input = bankInput(name, primary, accent);
  const nameLength = [...name.trim()].length;
  const shownPrimary = isHexColor(primary) ? primary.toLowerCase() : bank.primary_color;
  const shownAccent = isHexColor(accent) ? accent.toLowerCase() : bank.accent_color;

  return (
    <div className="mt-5 grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6">
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bank-name">Bank name</Label>
          <Input id="bank-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          {(nameLength === 0 || nameLength > 80) && (
            <p className="text-xs text-destructive">Enter a name of 1 to 80 characters.</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Logo</span>
          <div className="flex items-center gap-3">
            <LogoTile name={name} color={shownPrimary} logoUrl={bank.logo_url} />
            <p className="text-xs text-muted-foreground">PNG or SVG, at most 1 MB</p>
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {bank.logo_url === null ? "Upload a logo" : "Replace"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/svg+xml"
              aria-label="Logo file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onLogo(file);
                }
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <ColorField
            id="primary-hex"
            label="Primary color"
            chooseLabel="Choose the primary color"
            value={primary}
            saved={bank.primary_color}
            onChange={setPrimary}
          />
          <ColorField
            id="accent-hex"
            label="Accent color"
            chooseLabel="Choose the accent color"
            value={accent}
            saved={bank.accent_color}
            onChange={setAccent}
          />
        </div>
        <Button className="self-start" disabled={input === null || saving} onClick={() => input && onSave(input)}>
          Save
        </Button>
      </div>
      <section aria-label="Live preview">
        <p className="text-sm font-medium">Live preview</p>
        <p className="text-xs text-muted-foreground">Delivered app</p>
        <BankPreview name={name} primary={shownPrimary} accent={shownAccent} logoUrl={bank.logo_url} />
      </section>
    </div>
  );
}

export function BankSettingsView({
  bank,
  error,
  saving,
  uploading,
  onSave,
  onLogo,
}: {
  bank: Bank | undefined;
  error: unknown;
  saving: boolean;
  uploading: boolean;
  onSave: (input: BankInput) => void;
  onLogo: (file: File) => void;
}) {
  if (error !== null && error !== undefined) {
    return <p className="text-sm text-destructive">{`The bank settings did not load. ${messageOf(error)}`}</p>;
  }
  if (bank === undefined) {
    return (
      <div className="flex justify-center p-8 text-muted-foreground">
        <BrandLoader label="Loading the bank settings" />
      </div>
    );
  }
  return <BankForm bank={bank} saving={saving} uploading={uploading} onSave={onSave} onLogo={onLogo} />;
}

export function BankSettings() {
  const client = useQueryClient();
  const bank = useQuery({ queryKey: ["bank"], queryFn: fetchBank });
  const save = useMutation({
    mutationFn: saveBank,
    onSuccess: (saved) => {
      client.setQueryData(["bank"], saved);
      toast.success("The bank settings are saved.");
    },
    onError: (err) => toast.error(`The bank settings did not save. ${messageOf(err)}`),
  });
  const logo = useMutation({
    mutationFn: uploadBankLogo,
    onSuccess: (saved) => {
      client.setQueryData(["bank"], saved);
      toast.success("The logo is saved.");
    },
    onError: (err) => toast.error(`The logo did not save. ${messageOf(err)}`),
  });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header
        className="flex h-12 w-full shrink-0 items-center gap-3 border-b px-4"
        style={{ background: "var(--card)" }}
      >
        <a href="/" aria-label="All processes" className="shrink-0">
          <img src="/zotra-wordmark.svg" alt="Zotra" width={76} height={22} />
        </a>
        <span className="h-5 w-px shrink-0" style={{ background: "var(--border)" }} />
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px]">
          <a href="/processes" className="hover:underline">All processes</a>
          <ChevronRight size={14} className="shrink-0" />
          <span className="font-semibold">Bank settings</span>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[960px] p-6">
        <h1 className="text-lg font-semibold">Bank settings</h1>
        <p className="text-sm text-muted-foreground">
          The bank profile of the delivered app: name, logo and colors. A change creates no process version.
        </p>
        <BankSettingsView
          bank={bank.data}
          error={bank.error}
          saving={save.isPending}
          uploading={logo.isPending}
          onSave={(input) => save.mutate(input)}
          onLogo={(file) => logo.mutate(file)}
        />
      </main>
    </div>
  );
}
