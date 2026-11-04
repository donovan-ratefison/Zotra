// The replay banner: one thin line above the studio pages when the
// server replays the recorded AI answers. In every other case (other
// mode, loading, error) it renders nothing.

import { useQuery } from "@tanstack/react-query";

export const KEY_HELP_URL =
  "https://github.com/donovan-ratefison/Zotra#use-the-live-ai-with-your-own-meta-key";

// fetchHealth reads the health route. An answer that is not ok rejects.
export async function fetchHealth(): Promise<{ ai_mode?: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`health: ${res.status}`);
  }
  return res.json();
}

export function ReplayBanner() {
  const { data } = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  if (data?.ai_mode !== "replay") {
    return null;
  }
  return (
    <div
      role="status"
      className="flex h-7 shrink-0 items-center justify-center gap-1 border-b bg-muted px-4 text-center text-xs text-muted-foreground"
    >
      AI answers are replayed for the sample policies. Add your Meta key for live AI.
      <a href={KEY_HELP_URL} target="_blank" rel="noreferrer" className="underline">
        How to add a key
      </a>
    </div>
  );
}
