import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_LOOK_SETTING,
  describeSiteLook,
  LOOK_PRIMARY,
  LOOK_PRIMARY_TOKENS,
  lookPaletteCss,
  parseSiteLook,
  PRIMARY_VARIABLES,
  siteLookStyle,
} from "@/modules/appearance/domain/site-look";
import { COLOR, COLOR_DARK } from "@/theme/brand";
import { LOOK_ATTRIBUTE, LOOK_PREVIEW, LOOK_PREVIEW_DARK, LOOK_ROOT, LOOK_ROOT_DARK, LOOK_VALUE, notUnderLook, onlyUnderLook, UNDER_LOOK } from "@/theme/look";
import { HOVER_OK } from "@/theme/motion";
import { accentOnHover } from "@/theme/surfaces";
import { theme } from "@/theme/theme";

/**
 * §708 — «Aspectul nou»: the facelift's look behind one setting, off by default. Off, nothing is
 * drawn and no rule can match, so every public page is what it was; on, the look is drawn on the
 * public pages only, never in the backoffice, which shares the layout and the header.
 */
const ROOT = path.resolve(__dirname, "../../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

describe("§708 the setting «Aspectul nou»", () => {
  it("is off until the club switches it on, and reads anything else as off", () => {
    expect(DEFAULT_SITE_LOOK_SETTING).toEqual({ on: false });
    expect(parseSiteLook({ on: true })).toEqual({ on: true });
    expect(parseSiteLook({ on: false })).toEqual({ on: false });
    expect(parseSiteLook({ on: "yes" })).toEqual(DEFAULT_SITE_LOOK_SETTING);
    expect(parseSiteLook({ on: true, extra: 1 })).toEqual(DEFAULT_SITE_LOOK_SETTING);
    expect(parseSiteLook(null)).toEqual(DEFAULT_SITE_LOOK_SETTING);
    expect(parseSiteLook("on")).toEqual(DEFAULT_SITE_LOOK_SETTING);
    expect(describeSiteLook({ on: true })).toBe("on");
    expect(describeSiteLook({ on: false })).toBe("off");
  });

  it("draws nothing while off, and the pink primary under the scope while on", () => {
    expect(siteLookStyle({ on: false })).toBeNull();
    expect(siteLookStyle({ on: true })).toBe(lookPaletteCss());
  });
});

describe("§708 the scope stops at the backoffice", () => {
  it("is the attribute on <html>, public pages only, and a preview box", () => {
    expect(LOOK_ROOT).toBe(`html[${LOOK_ATTRIBUTE}="${LOOK_VALUE}"]:not(:has([data-backoffice]))`);
    expect(LOOK_ROOT_DARK).toContain("[data-dark]");
    expect(LOOK_ROOT_DARK).toContain(":not(:has([data-backoffice]))");
    expect(LOOK_PREVIEW_DARK).toContain("[data-dark]");
    expect(UNDER_LOOK).toBe(`${LOOK_ROOT} &, ${LOOK_PREVIEW} &`);
    // The backoffice shell and its resting notice carry the marker the scope stops at (§488).
    expect(source("src/modules/staff-identity/ui/BackofficeShell.tsx")).toContain('data-backoffice=""');
  });

  it("puts the attribute on <html> and the stylesheet in the layout only while on", () => {
    const layout = source("src/app/[locale]/layout.tsx");
    expect(layout).toContain("const look = await cachedSiteLook();");
    expect(layout).toContain("siteLookStyle(look)");
    expect(layout).toContain("{...(look.on ? { [LOOK_ATTRIBUTE]: LOOK_VALUE } : {})}");
    expect(layout).toMatch(/\{lookStyle && <style data-site-look="">\{lookStyle\}<\/style>\}/);
    expect(layout).toContain("{look.on && <LookWatermark />}");
    expect(source("src/modules/public-cache/reads.ts")).toMatch(/publicRead\(\["settings\.site-look"\], \["settings"\]/);
  });

  it("hides what only the new look shows unless it is inside the scope", () => {
    expect(onlyUnderLook("flex")).toEqual({ display: "none", [UNDER_LOOK]: { display: "flex" } });
    expect(source("src/shared/ui/LookWatermark.tsx")).toContain('onlyUnderLook("flex")');
    expect(source("src/shared/ui/HeaderSocials.tsx")).toContain('display: "none", [UNDER_LOOK]: { display: { xs: "none", md: "flex" } }');
  });

  it("§NNN puts both languages on the footer's bar at every width under the look, and leaves today's two copies alone while off", () => {
    const layout = source("src/app/[locale]/layout.tsx");
    expect(layout).toContain("<SiteFooter />");
    const footer = source("src/shared/ui/SiteFooter.tsx");
    // §722's floating round button is gone; the footer reads no setting.
    expect(footer).not.toContain("FloatingLocaleSwitch");
    expect(existsSync(path.join(ROOT, "src/shared/ui/FloatingLocaleSwitch.tsx"))).toBe(false);
    // The phone's flags on the footer's bar, from `sm` too under the scope; the header's copy from `sm`, hidden under it.
    expect(footer).toContain('display: { xs: "flex", sm: "none" },\n            [UNDER_LOOK]: { display: "flex", ml: "auto" },');
    expect(source("src/shared/ui/SiteHeader.tsx")).toContain('...notUnderLook({ xs: "none", sm: "flex" })');
    expect(notUnderLook({ xs: "none", sm: "flex" })).toEqual({ display: { xs: "none", sm: "flex" }, [UNDER_LOOK]: { display: "none" } });
    // «Urmărește-ne»'s box in the header: no room taken outside the scope, nor below `md` inside it.
    expect(source("src/shared/ui/SiteHeader.tsx")).toContain('...onlyUnderLook({ xs: "none", md: "flex" })');
  });
});

describe("§708 the pink primary", () => {
  it("redefines MUI's own primary variables, which the theme reads", () => {
    const vars = theme.vars?.palette.primary;
    for (const [key, variable] of Object.entries(PRIMARY_VARIABLES)) {
      expect(vars?.[key as keyof typeof PRIMARY_VARIABLES], key).toMatch(new RegExp(`^var\\(${variable}[,)]`));
      expect(vars?.[`${key}Channel` as "mainChannel"], `${key}Channel`).toMatch(new RegExp(`^var\\(${variable}Channel[,)]`));
    }
  });

  it("takes every value from brand.ts, light and dark, each with its channel", () => {
    expect(LOOK_PRIMARY.light).toEqual({ main: COLOR.accentInk, light: COLOR.accent, dark: COLOR.accentDeep, contrastText: COLOR.surface });
    expect(LOOK_PRIMARY.dark).toEqual({ main: COLOR_DARK.accentInk, light: COLOR_DARK.accent, dark: COLOR_DARK.accentDeep, contrastText: COLOR_DARK.paper });
    expect(LOOK_PRIMARY_TOKENS.light.main).toBe("accentInk");
    const css = lookPaletteCss();
    const [light, dark] = css.split("}").filter(Boolean);
    expect(light.startsWith(`${LOOK_ROOT},${LOOK_PREVIEW}{`)).toBe(true);
    expect(dark.startsWith(`${LOOK_ROOT_DARK},${LOOK_PREVIEW_DARK}{`)).toBe(true);
    expect(light).toContain(`${PRIMARY_VARIABLES.main}:${COLOR.accentInk};${PRIMARY_VARIABLES.main}Channel:160 22 80`);
    expect(dark).toContain(`${PRIMARY_VARIABLES.contrastText}:${COLOR_DARK.paper}`);
    // No colour that is not a token: every hex in the sheet is one of the eight it names, or the pink's
    // pale band in either scheme (`--br-accent-tint`, §723).
    const tokens = new Set([...Object.values(LOOK_PRIMARY.light), ...Object.values(LOOK_PRIMARY.dark), COLOR.accentTint, COLOR_DARK.accentTint]);
    for (const hex of css.match(/#[0-9a-f]{3,8}/gi) ?? []) expect(tokens.has(hex), hex).toBe(true);
    // Nothing a browser would read as markup inside the <style> element.
    expect(css).not.toMatch(/[<>]/);
  });
});

describe("§708 the theme's new-look rules are all under the scope", () => {
  it("rounds the buttons into pills and sets the headings in Inter 800, under the scope and nowhere else", () => {
    const button = theme.components?.MuiButton?.styleOverrides?.root as Record<string, unknown>;
    expect(Object.keys(button)).toEqual([UNDER_LOOK]);
    expect(button[UNDER_LOOK]).toEqual({ borderRadius: 999 });
    const typography = theme.components?.MuiTypography?.styleOverrides as Record<string, Record<string, Record<string, unknown>>>;
    for (const variant of ["h1", "h2", "h3"]) {
      expect(Object.keys(typography[variant]), variant).toEqual([UNDER_LOOK]);
      expect(typography[variant][UNDER_LOOK]).toMatchObject({ fontWeight: 800, letterSpacing: "-0.02em" });
      expect(String(typography[variant][UNDER_LOOK].fontFamily)).toMatch(/^var\(--font-inter\)/);
    }
    // Today's headings are untouched: the theme's own variants keep Roboto at 500.
    expect(theme.typography.h1.fontWeight).toBe(500);
  });

  it("keeps the pink button's own hover under the scope, the blue ramp everywhere else", () => {
    const hover = accentOnHover[HOVER_OK] as Record<string, unknown>;
    expect(hover[UNDER_LOOK]).toEqual({ "&:hover": { backgroundImage: "none" } });
    expect(hover["&:hover"]).toBeDefined();
  });
});
