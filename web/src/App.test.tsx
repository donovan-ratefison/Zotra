import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import App from "./App";

describe("App", () => {
  test("shows the start page", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Zotra");
    expect(html).toContain("Open the studio");
  });
});
