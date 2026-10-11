import { describe, expect, it } from "vitest";
import { type AccentShades, deriveAccentShades, judgeAccent, MIN_CHROMA } from "@/modules/appearance/domain/accent-shades";
import {
  CUSTOM_LOOK_ACCENT,
  DEFAULT_SITE_LOOK_SETTING,
  describeLookAccent,
  LOOK_ACCENT_PRESETS,
  lookAccentOf,
  lookAccentShades,
  lookPaletteCss,
  lookPrimary,
  parseSiteLook,
  PRIMARY_VARIABLES,
  siteLookStyle,
} from "@/modules/appearance/domain/site-look";
import { contrastRatio, relativeLuminance } from "@/modules/appearance/domain/tint-contrast";
import { HOME_BAND_SX } from "@/modules/home/ui/home-surfaces";
import { COLOR, COLOR_DARK, LOOK_ACCENT, SITE_TINT } from "@/theme/brand";
import { accentPairsOf, LOOK_ACCENT_PAIRS, LOOK_PAIRS, LOOK_PAIRS_DARK } from "@/theme/brand-pairs";
import { LOOK_ACCENT_TINT, LOOK_ACCENT_TINT_VARIABLE, LOOK_PREVIEW, LOOK_PREVIEW_DARK, LOOK_ROOT, LOOK_ROOT_DARK, UNDER_LOOK } from "@/theme/look";

/**
 * §723 (amending §708) — the new look's accent is the club's setting: a preset (pink, the default;
 * blue; orange) or a colour it types, from which the server derives the four shades the look wears,
 * by day and after dark. Held here: every preset and a spread of typed colours clear AA on every pair
 * the look draws in both schemes; the shades keep their order (the hover deeper by day, lighter after
 * dark) and the words' shade stays no lighter than the muted ink, so every page tint carries it; the
 * pink is phase 1's tokens unchanged and the orange is the derivation's; a grey and a malformed value
 * are refused; and the home band wears the accent through the layout's variables (the weekly tag
 * went with the home page's own cards, §NNN). That no page names the pink or a preset itself is
 * `tests/unit/design/accent-tokens.test.ts`'s walk of `src/`, beside the design system's other guards.
 */
const SIX_DIGIT = /^#[0-9a-f]{6}$/;

/** `hsl(h, s%, l%)` as `#rrggbb`, for a spread of typed colours. */
function hsl(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Every hue in 15° steps, at four saturations and five lightnesses: 480 colours, the greys taken out. */
const TYPED = Array.from({ length: 24 }, (_, step) => step * 15)
  .flatMap((hue) => [35, 60, 85, 100].flatMap((saturation) => [15, 30, 45, 60, 80].map((lightness) => hsl(hue, saturation, lightness))))
  .filter((hex) => judgeAccent(hex) === null);

function assertReadable(name: string, shades: AccentShades) {
  for (const { foreground, background } of accentPairsOf(name, shades)) {
    expect(contrastRatio(foreground.hex, background.hex), `${foreground.name} on ${background.name}`).toBeGreaterThanOrEqual(4.5);
  }
  for (const scheme of [shades.light, shades.dark]) for (const hex of Object.values(scheme)) expect(hex, name).toMatch(SIX_DIGIT);
  // The words' shade no lighter than the muted ink: §488 holds that ink at AA on every page tint, a typed one included.
  expect(relativeLuminance(shades.light.accentInk), `${name} accentInk vs inkMuted`).toBeLessThanOrEqual(relativeLuminance(COLOR.inkMuted));
  for (const [tint, background] of Object.entries(SITE_TINT)) expect(contrastRatio(shades.light.accentInk, background), `${name} on ${tint}`).toBeGreaterThanOrEqual(4.5);
  // The order the blues have: resting, then the hover — deeper by day, lighter after dark.
  expect(relativeLuminance(shades.light.accentDeep), `${name} light order`).toBeLessThan(relativeLuminance(shades.light.accentInk));
  expect(relativeLuminance(shades.dark.accentDeep), `${name} dark order`).toBeGreaterThan(relativeLuminance(shades.dark.accentInk));
}

describe("§723 the accent presets", () => {
  it("offers pink first, the default, then blue and orange", () => {
    expect(LOOK_ACCENT_PRESETS).toEqual(["pink", "blue", "orange"]);
    expect(Object.keys(LOOK_ACCENT)).toEqual([...LOOK_ACCENT_PRESETS]);
  });

  for (const preset of LOOK_ACCENT_PRESETS) {
    it(`keeps «${preset}» readable on every pair, in both schemes`, () => assertReadable(`LOOK_ACCENT.${preset}`, LOOK_ACCENT[preset]));
  }

  it("is phase 1's pink, token for token, so a club that never chose an accent sees what it saw", () => {
    expect(LOOK_ACCENT.pink.light).toEqual({ accent: COLOR.accent, accentInk: COLOR.accentInk, accentDeep: COLOR.accentDeep, accentTint: COLOR.accentTint });
    expect(LOOK_ACCENT.pink.dark).toEqual({ accent: COLOR_DARK.accent, accentInk: COLOR_DARK.accentInk, accentDeep: COLOR_DARK.accentDeep, accentTint: COLOR_DARK.accentTint });
    // The pink's pairs are LOOK_PAIRS' accent rows: the same ten a scheme the other accents are held to.
    const names = accentPairsOf("COLOR", { light: LOOK_ACCENT.pink.light, dark: LOOK_ACCENT.pink.dark }).map((p) => `${p.foreground.hex}/${p.background.hex}`);
    const look = [...LOOK_PAIRS, ...LOOK_PAIRS_DARK].map((p) => `${p.foreground.hex}/${p.background.hex}`);
    for (const name of names) expect(look, name).toContain(name);
  });

  it("wears the club's own blue as today's look does, and the orange the derivation makes of the club's orange", () => {
    expect(LOOK_ACCENT.blue.light.accent).toBe(COLOR.blue);
    expect(LOOK_ACCENT.blue.light.accentInk).toBe(COLOR.blueInk);
    expect(LOOK_ACCENT.blue.dark.accent).toBe(COLOR_DARK.blue);
    expect(LOOK_ACCENT.blue.dark.accentInk).toBe(COLOR_DARK.blueInk);
    expect(LOOK_ACCENT.orange).toEqual(deriveAccentShades(COLOR.orange));
    // The pairs the design page draws for them are exactly the presets' pairs.
    expect(LOOK_ACCENT_PAIRS).toEqual([...accentPairsOf("LOOK_ACCENT.blue", LOOK_ACCENT.blue), ...accentPairsOf("LOOK_ACCENT.orange", LOOK_ACCENT.orange)]);
  });
});

describe("§723 a typed accent", () => {
  it("is refused when it is not #rrggbb or is a grey, and accepted otherwise", () => {
    for (const bad of ["red", "#fff", "#12345g", "d6176f", "#d6176f00", ""]) expect(judgeAccent(bad), bad).toBe("notAColour");
    for (const grey of ["#808080", "#000000", "#ffffff", COLOR.inkMuted, COLOR.ink, COLOR.paper]) expect(judgeAccent(grey), grey).toBe("tooGrey");
    for (const colour of [COLOR.accent, COLOR.orange, COLOR.blue, "#1f6feb", "#2e7d32"]) expect(judgeAccent(colour), colour).toBeNull();
    expect(MIN_CHROMA).toBe(40);
  });

  it(`derives readable, ordered shades for ${TYPED.length} typed colours across the wheel`, () => {
    expect(TYPED.length).toBe(432);
    for (const hex of TYPED) assertReadable(hex, deriveAccentShades(hex));
  });

  it("keeps the club's colour as typed wherever it already reads, and walks it only as far as a rule needs", () => {
    expect(deriveAccentShades(COLOR.accent).light.accent).toBe(COLOR.accent);
    expect(deriveAccentShades(COLOR.orange).dark.accent).toBe(COLOR.orange);
    expect(deriveAccentShades("#D6176F")).toEqual(deriveAccentShades(COLOR.accent));
    // Too light to carry words by day: walked towards black until it does, and no further than a step.
    const orange = deriveAccentShades(COLOR.orange).light.accent;
    expect(contrastRatio(orange, COLOR.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(orange, COLOR.paper)).toBeLessThan(4.8);
    expect(() => deriveAccentShades("red")).toThrow();
  });
});

describe("§723 the setting carries the accent", () => {
  it("reads every row written before the accent existed as the pink, and a typed grey as the pink too", () => {
    expect(lookAccentOf({ on: true })).toEqual({ accent: "pink" });
    expect(parseSiteLook({ on: true, accent: "blue" })).toEqual({ on: true, accent: "blue" });
    expect(parseSiteLook({ on: false, accent: "orange" })).toEqual({ on: false, accent: "orange" });
    expect(parseSiteLook({ on: true, accent: "custom", hex: "#1F6FEB" })).toEqual({ on: true, accent: "custom", hex: "#1f6feb" });
    expect(parseSiteLook({ on: true, accent: "custom", hex: "#808080" })).toEqual({ on: true });
    expect(parseSiteLook({ on: true, accent: "custom" })).toEqual(DEFAULT_SITE_LOOK_SETTING);
    expect(parseSiteLook({ on: true, accent: "green" })).toEqual(DEFAULT_SITE_LOOK_SETTING);
    expect(parseSiteLook({ on: true, accent: "blue", hex: "#1f6feb" })).toEqual(DEFAULT_SITE_LOOK_SETTING);
    expect(describeLookAccent({ on: true })).toBe("pink");
    expect(describeLookAccent({ on: true, accent: CUSTOM_LOOK_ACCENT, hex: "#1f6feb" })).toBe("custom #1f6feb");
  });

  it("writes the chosen accent into the layout's stylesheet, light and dark, the band's variable beside MUI's primary", () => {
    expect(siteLookStyle({ on: false, accent: "blue" })).toBeNull();
    expect(siteLookStyle({ on: true })).toBe(lookPaletteCss(LOOK_ACCENT.pink));
    expect(lookPaletteCss()).toBe(lookPaletteCss(LOOK_ACCENT.pink));

    const blue = siteLookStyle({ on: true, accent: "blue" }) ?? "";
    const [light, dark] = blue.split("}").filter(Boolean);
    expect(light.startsWith(`${LOOK_ROOT},${LOOK_PREVIEW}{`)).toBe(true);
    expect(dark.startsWith(`${LOOK_ROOT_DARK},${LOOK_PREVIEW_DARK}{`)).toBe(true);
    expect(light).toContain(`${PRIMARY_VARIABLES.main}:${COLOR.blueInk};`);
    expect(light).toContain(`${PRIMARY_VARIABLES.contrastText}:${COLOR.surface};`);
    expect(light).toContain(`${LOOK_ACCENT_TINT_VARIABLE}:${LOOK_ACCENT.blue.light.accentTint}`);
    expect(dark).toContain(`${PRIMARY_VARIABLES.main}:${COLOR_DARK.blueInk};`);
    expect(dark).toContain(`${PRIMARY_VARIABLES.contrastText}:${COLOR_DARK.paper};`);
    expect(dark).toContain(`${LOOK_ACCENT_TINT_VARIABLE}:${LOOK_ACCENT.blue.dark.accentTint}`);

    const typed = { on: true, accent: CUSTOM_LOOK_ACCENT, hex: "#1f6feb" } as const;
    const shades = lookAccentShades(lookAccentOf(typed));
    expect(shades).toEqual(deriveAccentShades("#1f6feb"));
    const css = siteLookStyle(typed) ?? "";
    // No colour that is not a shade of the accent or the words on its fill, and nothing a browser would read as markup.
    const primary = lookPrimary(shades);
    const allowed = new Set([...Object.values(primary.light), ...Object.values(primary.dark), shades.light.accentTint, shades.dark.accentTint]);
    for (const hex of css.match(/#[0-9a-f]{3,8}/gi) ?? []) expect(allowed.has(hex), hex).toBe(true);
    expect(css).not.toMatch(/[<>]/);
  });
});

describe("§723 everything that wears the accent follows the setting", () => {
  it("draws the home band from the layout's variables, one rule for both schemes", () => {
    expect(LOOK_ACCENT_TINT).toBe(`var(${LOOK_ACCENT_TINT_VARIABLE})`);
    expect(HOME_BAND_SX[UNDER_LOOK]).toEqual({ bgcolor: LOOK_ACCENT_TINT });
  });
});
