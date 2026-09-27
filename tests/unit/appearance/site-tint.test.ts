import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_TINT,
  hexChannel,
  PAGE_COLOR_VARIABLE,
  parseSiteTint,
  SITE_TINT_SELECTOR,
  SITE_TINTS,
  siteTintColor,
  siteTintStyle,
} from "@/modules/appearance/domain/site-tint";
import { COLOR, SITE_TINT } from "@/theme/brand";
import { theme } from "@/theme/theme";

/**
 * §NNN — «Fundalul site-ului»: a preset from the club's colours, drawn by the locale layout as one
 * rule on MUI's page-colour variable, for the light scheme and the public pages only.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("§NNN the site's background tint", () => {
  it("offers exactly the presets brand.ts names, the platform's paper first and by default", () => {
    expect([...SITE_TINTS].sort()).toEqual(Object.keys(SITE_TINT).sort());
    expect(SITE_TINTS[0]).toBe("paper");
    expect(DEFAULT_SITE_TINT).toBe("paper");
    expect(siteTintColor("paper")).toBe(COLOR.paper);
  });

  it("draws nothing for the default, so a database with no row renders what it rendered before", () => {
    expect(siteTintStyle(DEFAULT_SITE_TINT)).toBeNull();
  });

  it("sets MUI's own page colour and its channel, in the light scheme, outside the backoffice", () => {
    const css = siteTintStyle("sky");
    expect(css).toBe(
      `:root:not([data-dark]) body:not(:has([data-backoffice])){--mui-palette-background-default:${SITE_TINT.sky};--mui-palette-background-defaultChannel:${hexChannel(SITE_TINT.sky)}}`,
    );
    expect(SITE_TINT_SELECTOR).toContain(":not([data-dark])");
    // Nothing in it that could close the <style> element it is drawn in.
    for (const tint of SITE_TINTS) expect(siteTintStyle(tint) ?? "").not.toMatch(/[<>&"']/);
  });

  it("names the variable the theme paints the page with, and the channel form MUI keeps", () => {
    // If MUI ever renames the variable or the theme changes its prefix, the tint would silently
    // stop applying; this is where that shows.
    expect(theme.vars?.palette.background.default).toMatch(new RegExp(`^var\\(${PAGE_COLOR_VARIABLE}[,)]`));
    expect(theme.vars?.palette.background.defaultChannel).toMatch(new RegExp(`^var\\(${PAGE_COLOR_VARIABLE}Channel[,)]`));
    expect(hexChannel("#fafaf7")).toBe("250 250 247");
    expect(() => hexChannel("red")).toThrow();
  });

  it("reads a stored value it cannot understand as the default, never a throw", () => {
    expect(parseSiteTint({ tint: "blue" })).toBe("blue");
    expect(parseSiteTint({ tint: "magenta" })).toBe("paper");
    expect(parseSiteTint(null)).toBe("paper");
    expect(parseSiteTint("sky")).toBe("paper");
  });

  it("is drawn by the locale layout from the public cache, and the backoffice shell carries the marker it stops at", () => {
    const layout = source("src/app/[locale]/layout.tsx");
    expect(layout).toContain("siteTintStyle(await cachedSiteTint())");
    expect(layout).toMatch(/\{tintStyle && <style data-site-tint="">\{tintStyle\}<\/style>\}/);
    expect(source("src/modules/staff-identity/ui/BackofficeShell.tsx")).toMatch(/<Container id="main"[^>]*data-backoffice=""/);
    expect(source("src/modules/public-cache/reads.ts")).toMatch(/publicRead\(\["settings\.site-tint"\], \["settings"\]/);
  });
});
