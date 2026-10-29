// The delivered app shell: the brand sidebar, the demo profile pick,
// and the inbox or case screen in the main area. It loads the
// process, its versions and the published version like the studio
// loads its version, then renders the frame. The query provider
// comes from main.tsx.

import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ApiError,
  getVersion,
  listProcesses,
  listVersions,
} from "../studio/api";
import { listUsers } from "../studio/case-api";
import { fetchInbox } from "./app-api";
import { CaseScreen } from "./CaseScreen";
import { InboxScreen } from "./InboxScreen";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";
import type {
  ProcessDefinition,
  ProcessSummary,
  Theme,
  VersionSummary,
} from "../studio/types";

// hslOf gives the shadcn tuple of one hex color: "<h> <s>% <l>%",
// with rounded integers, from the max, min and delta of the r, g, b
// parts. The theme contract fixes the 6-digit "#rrggbb" form.
export function hslOf(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }
  if (h < 0) {
    h += 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// brandVars maps the theme to the two tokens the app overrides:
// --primary keeps the full hsl(...) form of styles.css, and the
// foreground goes dark when the brand color is light.
export function brandVars(theme: Theme): Record<string, string> {
  const tuple = hslOf(theme.primary_color);
  const lightness = Number.parseFloat(tuple.split(" ")[2]!);
  return {
    "--primary": `hsl(${tuple})`,
    "--primary-foreground":
      lightness <= 50 ? "hsl(0 0% 98%)" : "hsl(240 5.9% 10%)",
  };
}

// pickProcess takes the earliest process, then the lowest id (the
// StudioShell rule).
function pickProcess(
  rows: ProcessSummary[] | undefined,
): ProcessSummary | null {
  if (!rows || rows.length === 0) {
    return null;
  }
  return [...rows].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )[0]!;
}

// publishedVersion takes the row with the highest number among the
// published rows, else null.
function publishedVersion(
  rows: VersionSummary[] | undefined,
): VersionSummary | null {
  const published = (rows ?? []).filter((row) => row.status === "published");
  if (published.length === 0) {
    return null;
  }
  return published.reduce((best, row) =>
    row.number > best.number ? row : best,
  );
}

// roleNamesOf joins the role names of the ids; an unknown id stays
// raw.
function roleNamesOf(roleIds: string[], def: ProcessDefinition): string {
  return roleIds
    .map((id) => def.roles.find((role) => role.id === id)?.name ?? id)
    .join(", ");
}

// initials gives the two initials of a user name: the first
// character of each of the first two words, upper case.
function initials(name: string): string {
  return name
    .split(" ")
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

// Loading centers one muted line. The shell stages pass "Loading the
// app"; the main-area users and inbox stages pass "Loading".
function Loading({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      {text}
    </div>
  );
}

// ErrorScreen centers one heading and the message of one error, the
// screen shape of the studio.
function ErrorScreen({ heading, error }: { heading: string; error: unknown }) {
  const message = error instanceof ApiError ? error.message : String(error);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-semibold">{heading}</h1>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

// FullScreen holds the stages that render without the frame.
function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex h-screen flex-col">{children}</div>;
}

// NoPublishedVersion is the shell state with nothing to open: no
// process, or no published version.
function NoPublishedVersion() {
  return (
    <FullScreen>
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        No published version yet.
      </div>
    </FullScreen>
  );
}

export function AppShell() {
  // The URL state: empty means "the first user of the list" and
  // "no case open". The guard keeps the node test rows alive (they
  // have no location).
  const [userId, setUserId] = useState(() => {
    const q = typeof location === "undefined" ? "" : location.search;
    return new URLSearchParams(q).get("user") ?? "";
  });
  const [caseId, setCaseId] = useState(() => {
    const q = typeof location === "undefined" ? "" : location.search;
    return new URLSearchParams(q).get("case") ?? "";
  });

  const processesQuery = useQuery({
    queryKey: ["processes"],
    queryFn: listProcesses,
  });
  const process = pickProcess(processesQuery.data);
  const versionsQuery = useQuery({
    queryKey: ["versions", process?.id],
    queryFn: () => listVersions(process!.id),
    enabled: process !== null,
  });
  const published = publishedVersion(versionsQuery.data);
  const versionQuery = useQuery({
    queryKey: ["version", published?.id],
    queryFn: () => getVersion(published!.id),
    enabled: published !== null,
  });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const users = usersQuery.data ?? [];
  const effectiveUserId = userId === "" ? (users[0]?.id ?? "") : userId;
  const inboxQuery = useQuery({
    queryKey: ["inbox", effectiveUserId],
    queryFn: () => fetchInbox(effectiveUserId),
    enabled: usersQuery.data !== undefined && effectiveUserId !== "",
  });

  function writeParam(key: string, value: string | null) {
    const params = new URLSearchParams(location.search);
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    history.replaceState(null, "", `?${params.toString()}`);
  }

  function onPickUser(id: string) {
    writeParam("user", id);
    setUserId(id);
  }

  function openCase(id: string) {
    writeParam("case", id);
    setCaseId(id);
  }

  function back() {
    writeParam("case", null);
    setCaseId("");
  }

  // The full-screen stages of the shell, in load order. Each stage
  // counts only when its query is enabled.
  if (processesQuery.isError) {
    return (
      <FullScreen>
        <ErrorScreen
          heading="The app did not load."
          error={processesQuery.error}
        />
      </FullScreen>
    );
  }
  if (processesQuery.isPending) {
    return (
      <FullScreen>
        <Loading text="Loading the app" />
      </FullScreen>
    );
  }
  if (process === null) {
    return <NoPublishedVersion />;
  }
  if (versionsQuery.isError) {
    return (
      <FullScreen>
        <ErrorScreen
          heading="The app did not load."
          error={versionsQuery.error}
        />
      </FullScreen>
    );
  }
  if (versionsQuery.isPending) {
    return (
      <FullScreen>
        <Loading text="Loading the app" />
      </FullScreen>
    );
  }
  if (published === null) {
    return <NoPublishedVersion />;
  }
  if (versionQuery.isError) {
    return (
      <FullScreen>
        <ErrorScreen
          heading="The app did not load."
          error={versionQuery.error}
        />
      </FullScreen>
    );
  }
  if (versionQuery.isPending) {
    return (
      <FullScreen>
        <Loading text="Loading the app" />
      </FullScreen>
    );
  }

  const def = versionQuery.data.definition;
  const versionRow = versionQuery.data;
  // The inbox answer, null while the query is pending or disabled.
  // The badge and the card role names line render only through the
  // null check, so no stage renders them on a pending inbox.
  const inboxData = inboxQuery.data ?? null;
  const cardUser = users.find((u) => u.id === effectiveUserId) ?? null;

  let main: ReactNode;
  if (usersQuery.isError) {
    main = (
      <ErrorScreen heading="The users did not load." error={usersQuery.error} />
    );
  } else if (usersQuery.isPending) {
    main = <Loading text="Loading" />;
  } else if (inboxQuery.isError) {
    main = (
      <ErrorScreen heading="The inbox did not load." error={inboxQuery.error} />
    );
  } else if (inboxQuery.data === undefined) {
    main = <Loading text="Loading" />;
  } else if (caseId === "") {
    main = (
      <InboxScreen
        def={def}
        userId={effectiveUserId}
        cases={inboxQuery.data.cases}
        roleNames={roleNamesOf(inboxQuery.data.user.role_ids, def)}
        onOpenCase={openCase}
      />
    );
  } else {
    main = (
      <CaseScreen
        userId={effectiveUserId}
        caseId={caseId}
        users={users}
        onBack={back}
      />
    );
  }

  return (
    <div
      className="flex h-screen"
      style={brandVars(def.theme) as CSSProperties}
    >
      <aside className="flex w-[240px] shrink-0 flex-col border-r bg-card">
        <div className="flex items-center gap-2.5 px-4 pt-4">
          {def.theme.logo_url !== null ? (
            <img
              src={def.theme.logo_url}
              alt={def.theme.brand_name}
              className="size-[34px] rounded-lg object-contain"
            />
          ) : (
            <div
              className="flex size-[34px] shrink-0 items-center justify-center rounded-lg font-semibold text-white"
              style={{ backgroundColor: def.theme.primary_color }}
            >
              {def.theme.brand_name.charAt(0)}
            </div>
          )}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">
              {def.theme.brand_name}
            </span>
            <span className="text-xs text-muted-foreground">Credits</span>
          </div>
        </div>
        <nav className="mt-4 flex flex-col gap-0.5 px-3" aria-label="App">
          <span
            aria-current="page"
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium"
          >
            Inbox
            {inboxData !== null && (
              <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                {inboxData.cases.length}
              </span>
            )}
          </span>
          <button
            type="button"
            disabled
            title="Not built yet"
            className="rounded-md px-3 py-2 text-left text-sm text-muted-foreground"
          >
            Supervision
          </button>
          <button
            type="button"
            disabled
            title="Not built yet"
            className="rounded-md px-3 py-2 text-left text-sm text-muted-foreground"
          >
            Audit log
          </button>
        </nav>
        <div className="mt-4 px-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Process
          </p>
          <p className="mt-1 text-sm">{`${def.name} v${versionRow.number}`}</p>
        </div>
        <div className="mt-auto flex flex-col gap-3 border-t px-4 py-4">
          {usersQuery.data !== undefined && cardUser !== null && (
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                {initials(cardUser.name)}
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {cardUser.name}
                </span>
                {inboxData !== null && (
                  <span className="truncate text-xs text-muted-foreground">
                    {roleNamesOf(inboxData.user.role_ids, def)}
                  </span>
                )}
              </div>
            </div>
          )}
          {usersQuery.data !== undefined && (
            <Select value={effectiveUserId} onValueChange={onPickUser}>
              <SelectTrigger aria-label="Demo profile" className="w-full">
                <SelectValue>
                  {users.find((u) => u.id === effectiveUserId)?.name ?? ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">Powered by Zotra</p>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {main}
      </main>
    </div>
  );
}
