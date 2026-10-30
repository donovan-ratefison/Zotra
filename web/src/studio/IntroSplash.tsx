// The intro of the studio: the animated logo plays one time per
// browser session, faster than the brand guide, then fades out.
import { useEffect, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import { buildLogo, LOGO_CONFIG } from "./logo-engine";

export const INTRO_SPEED = 2.5;
export const INTRO_FADE_MS = 250;
export const INTRO_KEY = "zotra-intro-seen";

// Wall time of the intro, in ms.
export function introLength(): number {
  return Math.round(LOGO_CONFIG.dur / INTRO_SPEED);
}

export function shouldPlayIntro(e: {
  force: boolean;
  webdriver: boolean;
  reducedMotion: boolean;
  seen: boolean;
}): boolean {
  if (e.reducedMotion) return false;
  if (e.force) return true;
  return !e.webdriver && !e.seen;
}

// The review capture and the demo video force the intro with ?intro=1.
export function forceFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("intro") === "1";
}

// With no storage, the intro must not play on each load: an error counts as seen.
export function readSeen(getStorage: () => Pick<Storage, "getItem">): boolean {
  try {
    return getStorage().getItem(INTRO_KEY) === "1";
  } catch {
    return true;
  }
}

export function markSeen(getStorage: () => Pick<Storage, "setItem">): void {
  try {
    getStorage().setItem(INTRO_KEY, "1");
  } catch {
    // No storage: the intro can play again, the studio keeps working.
  }
}

// The scope .zintro keeps the generic class names of the engine out of
// the app. The --zl-* names do not overwrite the app token --card.
const INTRO_CSS = `
.zintro { --zl-card: #ffffff; --zl-ink: #1a1523; --zl-north: #820ad1; --zl-south: #d9cfe6; background: var(--zl-card); }
.zintro .ink { fill: var(--zl-ink); }
.zintro .red, .zintro .glow { fill: var(--zl-north); }
.zintro .silver { fill: var(--zl-south); }
.zintro .hole { fill: var(--zl-card); }
.zintro .stroke, .zintro .trail { fill: none; stroke: var(--zl-ink); }
.zintro .desc { fill: var(--zl-ink); font: 600 17px "Inter Variable", ui-sans-serif, system-ui, sans-serif; }
`;

export function IntroView({
  fading,
  svgRef,
  onSkip,
}: {
  fading: boolean;
  svgRef: RefObject<SVGSVGElement | null>;
  onSkip: () => void;
}): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="zintro fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ opacity: fading ? 0 : 1, transition: `opacity ${INTRO_FADE_MS}ms ease` }}
      onClick={onSkip}
    >
      <style>{INTRO_CSS}</style>
      <svg ref={svgRef} className="h-auto w-[min(560px,80vw)]" />
    </div>
  );
}

type Phase = "play" | "fade" | "gone";

export function IntroSplash(): JSX.Element | null {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [phase, setPhase] = useState<Phase>(() => {
    if (typeof window === "undefined") return "gone";
    const play = shouldPlayIntro({
      force: forceFromSearch(location.search),
      webdriver: navigator.webdriver === true,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      seen: readSeen(() => sessionStorage),
    });
    return play ? "play" : "gone";
  });

  useEffect(() => {
    if (phase !== "play") return;
    markSeen(() => sessionStorage);
    const svg = svgRef.current;
    if (!svg) {
      setPhase("gone");
      return;
    }
    const frame = buildLogo(svg, LOGO_CONFIG);
    frame(0);
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) * INTRO_SPEED, LOGO_CONFIG.dur);
      frame(t);
      if (t >= LOGO_CONFIG.dur) setPhase("fade");
      else id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "fade") return;
    const id = setTimeout(() => setPhase("gone"), INTRO_FADE_MS);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "gone") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhase("gone");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  if (phase === "gone") return null;
  return <IntroView fading={phase === "fade"} svgRef={svgRef} onSkip={() => setPhase("gone")} />;
}
