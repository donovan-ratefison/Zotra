import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { fetchHealth, ReplayBanner } from "./studio/ReplayBanner";

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
function bannerHtml(health?: { ai_mode: string }) {
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
