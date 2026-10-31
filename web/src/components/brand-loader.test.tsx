// The test rows of the brand loader: the wrapper, the two theme images,
// the size, and the optional label.
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BrandLoader } from "./BrandLoader";

const count = (html: string, part: string) => html.split(part).length - 1;

describe("BrandLoader", () => {
  test("B1: a status with one light and one dark image", () => {
    const html = renderToString(<BrandLoader />);
    expect(html).toContain('role="status"');
    expect(count(html, 'src="/zotra-loader-light.svg"')).toBe(1);
    expect(count(html, 'src="/zotra-loader-dark.svg"')).toBe(1);
    expect(count(html, 'width="24"')).toBe(2);
    expect(count(html, 'height="24"')).toBe(2);
    expect(count(html, 'aria-hidden="true"')).toBe(2);
    expect(count(html, 'alt=""')).toBe(2);
  });

  test("B2: the dark class picks the image", () => {
    const html = renderToString(<BrandLoader />);
    expect(html).toMatch(/<img src="\/zotra-loader-light.svg"[^>]*class="shrink-0 dark:hidden"/);
    expect(html).toMatch(/<img src="\/zotra-loader-dark.svg"[^>]*class="hidden shrink-0 dark:block"/);
  });

  test("B3: the label comes after the images", () => {
    const html = renderToString(<BrandLoader label="Loading the case." />);
    expect(html).toContain("Loading the case.");
    expect(html.indexOf("Loading the case.")).toBeGreaterThan(html.indexOf('src="/zotra-loader-dark.svg"'));
  });

  test("B4: no label gives no text", () => {
    const html = renderToString(<BrandLoader />);
    expect(html.replace(/<[^>]+>/g, "")).toBe("");
  });

  test("B5: the size sets the width and the height", () => {
    const html = renderToString(<BrandLoader size={13} />);
    expect(count(html, 'width="13"')).toBe(2);
    expect(count(html, 'height="13"')).toBe(2);
    expect(html).not.toContain('width="24"');
  });
});
