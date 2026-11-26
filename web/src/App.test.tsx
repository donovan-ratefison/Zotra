import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { bannerLine, fetchHealth, KEY_HELP_URL, ReplayBanner, TOUR_URL } from "./studio/ReplayBanner";

describe("App", () => {
  test("27: with no answer from the API, the shell renders the loading state", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    try {
      const html = renderToString(<App />);
      expect(html).toContain("Loading the studio");
      expect(html).toContain('src="/zotra-loader-light.svg"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// The banner rows: the query cache holds the health answer, so the
// server render shows the state with no fetch.
function bannerHtml(health?: { ai_mode?: string; demo_notice?: string }) {
  const client = new QueryClient();
  if (health) {
    client.setQueryData(["health"], health);
  }
  return renderToString(
    <QueryClientProvider client={client}>
      <ReplayBanner />
    </QueryClientProvider>,
  );
}

describe("replay banner", () => {
  test("ux2a: replay mode shows the text and the key link", () => {
    const html = bannerHtml({ ai_mode: "replay" });
    expect(html).toContain('role="status"');
    expect(html).toContain(
      "AI answers are replayed for the sample policies. Add your Meta key for live AI.",
    );
    expect(html).toContain("How to add a key");
    expect(html).toContain(
      'href="https://github.com/donovan-ratefison/Zotra#use-the-live-ai-with-your-own-meta-key"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  test("ux2b: live mode shows no banner", () => {
    expect(bannerHtml({ ai_mode: "live" })).toBe("");
  });

  test("ux2c: cache mode shows no banner", () => {
    expect(bannerHtml({ ai_mode: "cache" })).toBe("");
  });

  test("ux2d: a failed health request rejects, and no answer shows no banner", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("boom", { status: 500 })));
    try {
      await expect(fetchHealth()).rejects.toThrow("health: 500");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(bannerHtml()).toBe("");
  });

  test("ux2e: fetchHealth reads the mode of the health route", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", (path: string) => {
      paths.push(path);
      return Promise.resolve(Response.json({ status: "ok", version: "v", ai_mode: "replay" }));
    });
    try {
      expect((await fetchHealth()).ai_mode).toBe("replay");
      expect(paths).toEqual(["/api/health"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("banner line", () => {
  const replayLine = {
    text: "AI answers are replayed for the sample policies. Add your Meta key for live AI.",
    linkText: "How to add a key",
    href: KEY_HELP_URL,
  };

  test.each([
    ["notice wins over replay", { demo_notice: "Demo", ai_mode: "replay" }, { text: "Demo", linkText: "Guided tour", href: TOUR_URL }],
    ["blank notice falls back to replay", { demo_notice: "  ", ai_mode: "replay" }, replayLine],
    ["replay mode", { ai_mode: "replay" }, replayLine],
    ["cache mode", { ai_mode: "cache" }, null],
    ["no answer", undefined, null],
  ])("demo1: %s", (_name, health, want) => {
    expect(bannerLine(health)).toEqual(want);
  });

  test("demo1: the banner shows the notice and the tour link", () => {
    const html = bannerHtml({ demo_notice: "Demo" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Demo");
    expect(html).toContain("Guided tour");
    expect(html).toContain(`href="${TOUR_URL}"`);
  });
});
