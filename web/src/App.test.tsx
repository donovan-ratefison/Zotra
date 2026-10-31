import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import App from "./App";

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
