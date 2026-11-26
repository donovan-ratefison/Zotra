// The top line: one thin line above the pages. A public demo shows its
// notice. Else, when the server replays the recorded AI answers, the
// line says so. In every other case (other mode, loading, error) it
// renders nothing.

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export const KEY_HELP_URL =
  "https://github.com/donovan-ratefison/Zotra#use-the-live-ai-with-your-own-meta-key";

export const TOUR_URL = "https://github.com/donovan-ratefison/Zotra#tour-in-5-minutes";

type Health = { ai_mode?: string; demo_notice?: string };

// fetchHealth reads the health route. An answer that is not ok rejects.
export async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`health: ${res.status}`);
  }
  return res.json();
}

// bannerLine chooses the text and the link of the top line, or null.
export function bannerLine(
  health: Health | undefined,
): { text: string; linkText: string; href: string } | null {
  if (typeof health?.demo_notice === "string" && health.demo_notice.trim() !== "") {
    return { text: health.demo_notice, linkText: "Guided tour", href: TOUR_URL };
  }
  if (health?.ai_mode === "replay") {
    return {
      text: "AI answers are replayed for the sample policies. Add your Meta key for live AI.",
      linkText: "How to add a key",
      href: KEY_HELP_URL,
    };
  }
  return null;
}

export function ReplayBanner() {
  const { data } = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const line = bannerLine(data);
  if (!line) {
    return null;
  }
  return (
    <div
      role="status"
      className="flex min-h-7 shrink-0 flex-wrap items-center justify-center gap-1 border-b bg-muted px-4 py-1 text-center text-xs text-muted-foreground"
    >
      {line.text}
      <a href={line.href} target="_blank" rel="noreferrer" className="underline">
        {line.linkText}
      </a>
    </div>
  );
}

// BannerFrame puts the top line above the page. The banner takes its
// height from the page: the screens fill the rest, and the page scroll
// stays inside.
export function BannerFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <ReplayBanner />
      <div className="min-h-0 flex-1 overflow-y-auto [&>.h-screen]:h-full [&>.min-h-screen]:min-h-full">
        {children}
      </div>
    </div>
  );
}
