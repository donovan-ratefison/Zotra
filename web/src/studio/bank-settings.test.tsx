// The test rows of the bank settings screen. The environment is node:
// renderToString for the view, no jsdom.

import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ApiError } from "./api";
import { BankSettingsView, bankInput, bankTheme, isHexColor } from "./BankSettings";
import type { Bank } from "./types";

const seed: Bank = {
  name: "Banque Ravina",
  primary_color: "#0f4c45",
  accent_color: "#b8913a",
  logo_url: null,
  updated_at: "2026-10-31T16:00:00Z",
};

function view(props: { bank?: Bank; error?: unknown; saving?: boolean; uploading?: boolean }): string {
  return renderToString(
    <BankSettingsView
      bank={props.bank}
      error={props.error ?? null}
      saving={props.saving ?? false}
      uploading={props.uploading ?? false}
      onSave={() => {}}
      onLogo={() => {}}
    />,
  );
}

function count(html: string, part: string): number {
  return html.split(part).length - 1;
}

// button gives the open tag of the button with the given text.
function button(html: string, text: string): string {
  const match = html.match(new RegExp(`<button[^>]*>${text}</button>`));
  expect(match).not.toBeNull();
  return match![0];
}

describe("bank settings", () => {
  test("H1: isHexColor", () => {
    const inputs = ["#0f4c45", "#0F4C45", "#0f4c4", "0f4c45", "#0f4c45 ", "#gggggg", ""];
    expect(inputs.map(isHexColor)).toEqual([true, true, false, false, false, false, false]);
  });

  test("I1: bankInput trims the name and lowers the colors", () => {
    expect(bankInput("  Banque Test ", "#ABCDEF", "#ffcc00")).toEqual({
      name: "Banque Test",
      primary_color: "#abcdef",
      accent_color: "#ffcc00",
    });
  });

  test("I2: bankInput refuses an empty or long name", () => {
    for (const name of ["", "   ", "é".repeat(81)]) {
      expect(bankInput(name, "#0f4c45", "#b8913a")).toBeNull();
    }
  });

  test("I3: bankInput accepts 80 code points", () => {
    expect(bankInput("é".repeat(80), "#0f4c45", "#b8913a")).not.toBeNull();
  });

  test("I4: bankInput refuses a bad color", () => {
    expect(bankInput("Banque", "#12", "#b8913a")).toBeNull();
    expect(bankInput("Banque", "#0f4c45", "red")).toBeNull();
  });

  test("T1: bankTheme", () => {
    expect(bankTheme(seed)).toEqual({ brand_name: "Banque Ravina", primary_color: "#0f4c45", logo_url: null });
  });

  test("V1: pending", () => {
    const html = view({});
    expect(html).toContain("Loading the bank settings");
    expect(html).toContain('src="/zotra-loader-light.svg"');
    expect(html).not.toContain(">Save<");
  });

  test("V2: error", () => {
    const html = view({ error: new ApiError(500, "internal", "boom") });
    expect(html).toContain("The bank settings did not load. boom");
    expect(html).not.toContain(">Save<");
  });

  test("V3: form and preview of the seed", () => {
    const html = view({ bank: seed });
    expect(html).toContain('value="Banque Ravina"');
    expect(count(html, 'value="#0f4c45"')).toBe(2);
    expect(count(html, 'value="#b8913a"')).toBe(2);
    expect(html).toContain(">Upload a logo<");
    expect(html).toContain("PNG or SVG, at most 1 MB");
    expect(button(html, "Save")).not.toContain('disabled=""');
    expect(html).toContain("--primary:hsl(173 67% 18%)");
    expect(html).toContain("border-top-color:#b8913a");
    expect(count(html, ">B<")).toBe(2);
    expect(html).toContain(">Approve<");
    expect(html).toContain('aria-label="Live preview"');
  });

  test("V4: a stored logo", () => {
    const html = view({ bank: { ...seed, logo_url: "/api/settings/bank/logo?v=1" } });
    expect(count(html, 'src="/api/settings/bank/logo?v=1"')).toBe(2);
    expect(html).toContain(">Replace<");
    expect(html).not.toContain(">B<");
  });

  test("V5: saving disables Save", () => {
    expect(button(view({ bank: seed, saving: true }), "Save")).toContain('disabled=""');
  });

  test("V6: an empty name", () => {
    const html = view({ bank: { ...seed, name: "" } });
    expect(html).toContain("Enter a name of 1 to 80 characters.");
    expect(button(html, "Save")).toContain('disabled=""');
  });

  test("V7: a bad primary color", () => {
    const html = view({ bank: { ...seed, primary_color: "#12" } });
    expect(html).toContain("Use the form #rrggbb.");
    expect(button(html, "Save")).toContain('disabled=""');
  });

  test("V8: uploading disables the logo button", () => {
    expect(button(view({ bank: seed, uploading: true }), "Upload a logo")).toContain('disabled=""');
  });
});
