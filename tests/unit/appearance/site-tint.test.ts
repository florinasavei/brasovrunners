import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_TINT,
  DEFAULT_SITE_TINT_SETTING,
  describeSiteTint,
  hexChannel,
  PAGE_COLOR_VARIABLE,
  parseSiteTint,
  SITE_TINT_CHOICES,
  SITE_TINT_PRESETS,
  SITE_TINT_SELECTOR,
  siteTintColor,
  siteTintStyle,
} from "@/modules/appearance/domain/site-tint";
import { contrastRatio, judgeTint, MAX_CARD_STEP, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import { COLOR, SITE_TINT } from "@/theme/brand";
import { theme } from "@/theme/theme";

/**
 * §488 — «Aspectul site-ului»: a preset from the club's colours or a typed «Personalizat» colour
 * that keeps text readable and stays light, drawn by the locale layout as one rule on MUI's
 * page-colour variable, for the light scheme and the public pages only.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("§488 the site's background tint", () => {
  it("offers exactly the presets brand.ts names, the platform's paper first and by default, then «Personalizat»", () => {
    expect([...SITE_TINT_PRESETS].sort()).toEqual(Object.keys(SITE_TINT).sort());
    expect(SITE_TINT_PRESETS).toEqual(["paper", "faintBlue", "lightBlue", "blueGrey"]);
    expect(SITE_TINT_CHOICES.at(-1)).toBe("custom");
    expect(DEFAULT_SITE_TINT).toBe("paper");
    expect(siteTintColor({ tint: "paper" })).toBe(COLOR.paper);
    expect(siteTintColor({ tint: "custom", hex: "#f0f4ff" })).toBe("#f0f4ff");
  });

  it("draws nothing for the default, so a database with no row renders what it rendered before", () => {
    expect(siteTintStyle(DEFAULT_SITE_TINT_SETTING)).toBeNull();
  });

  it("sets MUI's own page colour and its channel, in the light scheme, outside the backoffice", () => {
    const css = siteTintStyle({ tint: "lightBlue" });
    expect(css).toBe(
      `:root:not([data-dark]) body:not(:has([data-backoffice])){--mui-palette-background-default:${SITE_TINT.lightBlue};--mui-palette-background-defaultChannel:${hexChannel(SITE_TINT.lightBlue)}}`,
    );
    expect(SITE_TINT_SELECTOR).toContain(":not([data-dark])");
    // Nothing in it that could close the <style> element it is drawn in.
    for (const tint of SITE_TINT_PRESETS) expect(siteTintStyle({ tint }) ?? "").not.toMatch(/[<>&"']/);
  });

  it("draws a custom colour lower-cased, and never anything but #rrggbb into the <style> text", () => {
    expect(siteTintStyle({ tint: "custom", hex: "#F0F4FF" })).toBe(
      `${SITE_TINT_SELECTOR}{${PAGE_COLOR_VARIABLE}:#f0f4ff;${PAGE_COLOR_VARIABLE}Channel:240 244 255}`,
    );
    // A value that slipped past every other check still writes nothing.
    expect(siteTintStyle({ tint: "custom", hex: "#fff}</style><script>" })).toBeNull();
    expect(siteTintStyle({ tint: "custom", hex: "red" })).toBeNull();
  });

  it("names the variable the theme paints the page with, and the channel form MUI keeps", () => {
    // If MUI ever renames the variable or the theme changes its prefix, the tint would silently
    // stop applying; this is where that shows.
    expect(theme.vars?.palette.background.default).toMatch(new RegExp(`^var\\(${PAGE_COLOR_VARIABLE}[,)]`));
    expect(theme.vars?.palette.background.defaultChannel).toMatch(new RegExp(`^var\\(${PAGE_COLOR_VARIABLE}Channel[,)]`));
    expect(hexChannel("#fafaf7")).toBe("250 250 247");
    expect(() => hexChannel("red")).toThrow();
  });

  it("reads a stored value it cannot understand, or a custom colour it would refuse today, as the default", () => {
    expect(parseSiteTint({ tint: "faintBlue" })).toEqual({ tint: "faintBlue" });
    expect(parseSiteTint({ tint: "custom", hex: "#F0F4FF" })).toEqual({ tint: "custom", hex: "#f0f4ff" });
    expect(parseSiteTint({ tint: "sand" })).toEqual(DEFAULT_SITE_TINT_SETTING);
    expect(parseSiteTint({ tint: "custom", hex: "#333333" })).toEqual(DEFAULT_SITE_TINT_SETTING);
    expect(parseSiteTint({ tint: "custom", hex: "blue" })).toEqual(DEFAULT_SITE_TINT_SETTING);
    expect(parseSiteTint({ tint: "custom" })).toEqual(DEFAULT_SITE_TINT_SETTING);
    expect(parseSiteTint(null)).toEqual(DEFAULT_SITE_TINT_SETTING);
    expect(parseSiteTint("lightBlue")).toEqual(DEFAULT_SITE_TINT_SETTING);
  });

  it("says a setting in one word for the audit row", () => {
    expect(describeSiteTint({ tint: "blueGrey" })).toBe("blueGrey");
    expect(describeSiteTint({ tint: "custom", hex: "#f0f4ff" })).toBe("custom #f0f4ff");
  });

  it("is drawn by the locale layout from the public cache, and the backoffice carries the marker it stops at", () => {
    const layout = source("src/app/[locale]/layout.tsx");
    expect(layout).toContain("siteTintStyle(await cachedSiteTint())");
    expect(layout).toMatch(/\{tintStyle && <style data-site-tint="">\{tintStyle\}<\/style>\}/);
    expect(source("src/modules/staff-identity/ui/BackofficeShell.tsx")).toMatch(/<Container id="main"[^>]*data-backoffice=""/);
    expect(source("src/modules/resilience/ui/AdminRestingNotice.tsx")).toMatch(/<Box component="main" id="main"[^>]*data-backoffice=""/);
    expect(source("src/modules/public-cache/reads.ts")).toMatch(/publicRead\(\["settings\.site-tint"\], \["settings"\]/);
  });
});

describe("§488 a «Personalizat» colour keeps text readable and stays light", () => {
  it("computes WCAG's known ratios, so the helper itself is not the thing under test", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("accepts every preset and a light colour of the club's", () => {
    for (const hex of Object.values(SITE_TINT)) expect(judgeTint(hex)).toBeNull();
    expect(judgeTint("#f0f4ff")).toBeNull();
    expect(judgeTint("#FFFFFF")).toBeNull();
  });

  it("refuses what is not #rrggbb", () => {
    for (const typed of ["", "red", "#fff", "#ggggggg", "f0f4ff", "#f0f4ff;", "rgb(0,0,0)"]) expect(judgeTint(typed)).toBe("notAColour");
  });

  it("refuses a colour on which body or muted text falls under 4.5 : 1", () => {
    // Mid-grey: body text still passes, muted text does not.
    expect(contrastRatio(COLOR.ink, "#999999")).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(COLOR.inkMuted, "#999999")).toBeLessThan(MIN_TEXT_CONTRAST);
    expect(judgeTint("#999999")).toBe("unreadable");
    expect(judgeTint("#0000ff")).toBe("unreadable");
    expect(judgeTint("#333333")).toBe("unreadable");
  });

  it("refuses a colour that keeps text readable but is too dark for a light page", () => {
    // Readable, yet a white card on it is past the ceiling.
    expect(contrastRatio(COLOR.inkMuted, "#dcdcdc")).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(COLOR.surface, "#dcdcdc")).toBeGreaterThan(MAX_CARD_STEP);
    expect(judgeTint("#dcdcdc")).toBe("tooDark");
    expect(judgeTint("#d0e0ff")).toBe("tooDark");
  });
});
