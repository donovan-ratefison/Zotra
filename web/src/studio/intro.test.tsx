// The test rows of the intro. The environment is node: renderToString
// for the components, no jsdom.

import { createElement, createRef } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LOGO_CONFIG } from "./logo-engine";
import {
  forceFromSearch,
  INTRO_FADE_MS,
  INTRO_HOLD_MS,
  INTRO_KEY,
  INTRO_SPEED,
  IntroSplash,
  IntroView,
  introLength,
  introTotal,
  markSeen,
  readSeen,
  shouldPlayIntro,
} from "./IntroSplash";

const base = { force: false, webdriver: false, reducedMotion: false, seen: false };
const view = (fading: boolean) =>
  renderToString(createElement(IntroView, { fading, svgRef: createRef<SVGSVGElement>(), onSkip: () => {} }));

describe("intro", () => {
  test("I1: the intro lasts 2084 ms", () => {
    expect(introLength()).toBe(2084);
  });

  test("I2: a first visit plays the intro", () => {
    expect(shouldPlayIntro(base)).toBe(true);
  });

  test("I3: a seen intro does not play", () => {
    expect(shouldPlayIntro({ ...base, seen: true })).toBe(false);
  });

  test("I4: an automated browser does not play the intro", () => {
    expect(shouldPlayIntro({ ...base, webdriver: true })).toBe(false);
  });

  test("I5: reduced motion does not play the intro", () => {
    expect(shouldPlayIntro({ ...base, reducedMotion: true })).toBe(false);
  });

  test("I6: force plays the intro in an automated browser, also when seen", () => {
    expect(shouldPlayIntro({ force: true, webdriver: true, reducedMotion: false, seen: true })).toBe(true);
  });

  test("I7: reduced motion wins over force", () => {
    expect(shouldPlayIntro({ force: true, webdriver: false, reducedMotion: true, seen: false })).toBe(false);
  });

  test("I8: the stored value 1 is seen", () => {
    expect(readSeen(() => ({ getItem: () => "1" }))).toBe(true);
  });

  test("I9: no stored value is not seen", () => {
    expect(readSeen(() => ({ getItem: () => null }))).toBe(false);
  });

  test("I10: another stored value is not seen", () => {
    expect(readSeen(() => ({ getItem: () => "yes" }))).toBe(false);
  });

  test("I11: a storage error counts as seen", () => {
    expect(
      readSeen(() => {
        throw new Error("SecurityError");
      }),
    ).toBe(true);
  });

  test("I12: markSeen stores the key, and a storage error does not throw", () => {
    const calls: string[][] = [];
    markSeen(() => ({ setItem: (k: string, v: string) => void calls.push([k, v]) }));
    expect(calls).toEqual([["zotra-intro-seen", "1"]]);
    expect(() =>
      markSeen(() => {
        throw new Error("SecurityError");
      }),
    ).not.toThrow();
  });

  test("I13: the view renders the overlay tree and the CSS", () => {
    const html = view(false);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="zintro fixed inset-0 z-[1000] flex items-center justify-center"');
    expect(html).toContain('style="opacity:1;transition:opacity 250ms ease"');
    expect(html).toContain('<svg class="h-auto w-[min(560px,80vw)]"');
    expect(html).toContain("--zl-north: #820ad1;");
    expect(html).toContain('font: 600 17px "Inter Variable", ui-sans-serif, system-ui, sans-serif;');
  });

  test("I14: the fading view has opacity 0", () => {
    expect(view(true)).toContain('style="opacity:0;transition:opacity 250ms ease"');
  });

  test("I15: the server render has no intro", () => {
    expect(renderToString(createElement(IntroSplash))).toBe("");
  });

  test("I16: LOGO_CONFIG keeps the source timings", () => {
    expect(LOGO_CONFIG.dur).toBe(5210);
    expect(LOGO_CONFIG.lock).toBe(4460);
    expect(LOGO_CONFIG.spin[0]).toBe(4460);
    expect(LOGO_CONFIG.line).toEqual([2300, 3960]);
    expect(LOGO_CONFIG.aT).toEqual([3960, 4460]);
    expect(LOGO_CONFIG.dotR).toBe(4.5);
  });

  test("I17: the constants", () => {
    expect(INTRO_KEY).toBe("zotra-intro-seen");
    expect(INTRO_SPEED).toBe(2.5);
    expect(INTRO_FADE_MS).toBe(250);
  });

  test("I-hold-1: the logo holds 1500 ms", () => {
    expect(INTRO_HOLD_MS).toBe(1500);
  });

  test("I-hold-2: the intro takes 3834 ms from the first frame to the removal", () => {
    expect(introTotal()).toBe(3834);
  });

  test("I-hold-3: the view of the phase hold is fully visible", () => {
    expect(view(false)).toContain("opacity:1");
  });

  test.each([
    ["I18", "?intro=1", true],
    ["I19", "", false],
    ["I20", "?intro=0", false],
    ["I21", "?intro=true", false],
  ])("%s: forceFromSearch(%j) is %s", (_row, search, expected) => {
    expect(forceFromSearch(search)).toBe(expected);
  });
});
