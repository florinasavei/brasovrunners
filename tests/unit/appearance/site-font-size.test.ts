import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_FONT_SIZE,
  DEFAULT_SITE_FONT_SIZE_SETTING,
  parseSiteFontSize,
  SITE_FONT_SIZE_PERCENT,
  SITE_FONT_SIZE_SELECTOR,
  SITE_FONT_SIZES,
  siteFontSizePixels,
  siteFontSizeStyle,
} from "@/modules/appearance/domain/site-font-size";
import { theme } from "@/theme/theme";

/**
 * §NNN — «Mărimea textului»: four steps, drawn by the locale layout as one rule on the root font
 * size, for the public pages only and in both schemes.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("§NNN the site's text size", () => {
  it("offers four steps, smallest first, «Normal» the platform's own size and the default", () => {
    expect(SITE_FONT_SIZES).toEqual(["small", "normal", "large", "xlarge"]);
    expect(Object.keys(SITE_FONT_SIZE_PERCENT)).toEqual([...SITE_FONT_SIZES]);
    expect(DEFAULT_SITE_FONT_SIZE).toBe("normal");
    expect(SITE_FONT_SIZE_PERCENT.normal).toBe(100);
    const percents = SITE_FONT_SIZES.map((size) => SITE_FONT_SIZE_PERCENT[size]);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
  });

  it("lands every step on a whole pixel for a 16 px reader", () => {
    expect(SITE_FONT_SIZES.map(siteFontSizePixels)).toEqual([15, 16, 17, 18]);
  });

  it("draws nothing for the default, so a database with no row renders what it rendered before", () => {
    expect(siteFontSizeStyle(DEFAULT_SITE_FONT_SIZE_SETTING)).toBeNull();
  });

  it("draws one rule on the root font size, as a percentage, outside the backoffice only", () => {
    expect(siteFontSizeStyle({ size: "large" })).toBe("html:not(:has([data-backoffice])){font-size:106.25%}");
    expect(siteFontSizeStyle({ size: "xlarge" })).toBe(`${SITE_FONT_SIZE_SELECTOR}{font-size:112.5%}`);
    expect(siteFontSizeStyle({ size: "small" })).toBe(`${SITE_FONT_SIZE_SELECTOR}{font-size:93.75%}`);
    // Not tied to a scheme: the dark theme reads at the same size.
    expect(SITE_FONT_SIZE_SELECTOR).not.toContain("data-dark");
  });

  it("scales the text because the theme's typography is in rem from a 16 px root", () => {
    // MUI's `pxToRem` divides by `htmlFontSize`; a different value would make the steps lie about their pixels.
    expect(theme.typography.htmlFontSize).toBe(16);
    expect(theme.typography.body1.fontSize).toMatch(/rem$/);
    expect(theme.typography.h1.fontSize).toMatch(/rem$/);
  });

  it("reads anything it cannot understand as the default, never a throw", () => {
    expect(parseSiteFontSize({ size: "large" })).toEqual({ size: "large" });
    expect(parseSiteFontSize({ size: "huge" })).toEqual(DEFAULT_SITE_FONT_SIZE_SETTING);
    expect(parseSiteFontSize({ size: "large", extra: 1 })).toEqual(DEFAULT_SITE_FONT_SIZE_SETTING);
    expect(parseSiteFontSize(null)).toEqual(DEFAULT_SITE_FONT_SIZE_SETTING);
    expect(parseSiteFontSize("xlarge")).toEqual(DEFAULT_SITE_FONT_SIZE_SETTING);
  });

  it("is drawn by the locale layout, from the public cache, beside the tint", () => {
    const layout = source("src/app/[locale]/layout.tsx");
    expect(layout).toContain("siteFontSizeStyle(await cachedSiteFontSize())");
    expect(layout).toMatch(/<style data-site-font-size="">\{fontSizeStyle\}<\/style>/);
    expect(source("src/modules/public-cache/reads.ts")).toMatch(/publicRead\(\["settings\.site-font-size"\], \["settings"\]/);
  });
});
