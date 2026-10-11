import { z } from "zod";
import { COLOR, COLOR_DARK, LOOK_ACCENT } from "@/theme/brand";
import { LOOK_ACCENT_TINT_VARIABLE, LOOK_PREVIEW, LOOK_PREVIEW_DARK, LOOK_ROOT, LOOK_ROOT_DARK } from "@/theme/look";
import { type AccentShade, type AccentShades, deriveAccentShades, judgeAccent } from "./accent-shades";
import { hexChannel } from "./site-tint";
import { HEX_COLOR } from "./tint-contrast";

/**
 * «Aspectul nou» — the facelift's look on the public pages, one switch and its accent colour (§708;
 * the accent since §NNN; `docs/REDESIGN.md`, decisions 1 and 12; the shape of «Aspectul site-ului»,
 * §488, and «Mărimea textului», §530).
 *
 * Pure: no database, no environment. Stored as `{ on }`, with the accent beside it once the club has
 * chosen one: `{ on, accent: "pink" | "blue" | "orange" }` or `{ on, accent: "custom", hex }`. No row
 * is off; no accent is pink, phase 1's default — so every row written before the accent existed reads
 * exactly as it did.
 *
 * How it reaches the page, in two parts, both from the locale layout and both nothing at all while
 * the setting is off — a database without the row renders byte for byte what it rendered before:
 *
 * 1. **The scope.** `data-look="2026"` on `<html>` (`theme/look.ts`): the theme's overrides — pill
 *    buttons, the headings in Inter 800 — and the header's «Vino cu noi», socials and watermark are
 *    written under it, public pages only (`:not(:has([data-backoffice]))`).
 * 2. **The accent as `primary`.** One small unlayered stylesheet (`siteLookStyle`) that redefines MUI's
 *    own `--mui-palette-primary-*` variables, and their channel twins (`alpha()` reads them), under
 *    the same scope, light and dark, and the one shade MUI has no slot for, the pale band
 *    (`--br-accent-tint`). Unlayered for the tint's reason (§488): MUI keeps its variables in a CSS
 *    layer, and a plain rule outranks every layer without a specificity contest — which is also why
 *    this cannot be a theme override. Every value is a preset of `brand.ts` or a shade derived from a
 *    checked `#rrggbb` (`accent-shades.ts`), never typed text.
 *
 * The emails, the PDFs, the race numbers and the share cards never read either: they keep the blue,
 * and so does the logo, under every accent (§711).
 */

/** The presets, in the order the form shows them: the default first. */
export const LOOK_ACCENT_PRESETS = ["pink", "blue", "orange"] as const satisfies readonly (keyof typeof LOOK_ACCENT)[];
export type LookAccentPreset = (typeof LOOK_ACCENT_PRESETS)[number];

/** «Personalizat»: a colour the club types. */
export const CUSTOM_LOOK_ACCENT = "custom";
/** The radio's values: every preset, then «Personalizat». */
export const LOOK_ACCENT_CHOICES = [...LOOK_ACCENT_PRESETS, CUSTOM_LOOK_ACCENT] as const;
export type LookAccentChoice = (typeof LOOK_ACCENT_CHOICES)[number];

/** Phase 1's pink (§708, decision 1's default). */
export const DEFAULT_LOOK_ACCENT: LookAccentPreset = "pink";

/** The accent part of the setting, read with its default filled in. */
export type LookAccentSetting = { accent: LookAccentPreset } | { accent: typeof CUSTOM_LOOK_ACCENT; hex: string };

/** The stored shape, strictly: the switch, with no accent (pink), a preset, or a checked colour (lower-cased). */
export const siteLookSchema = z.union([
  z.object({ on: z.boolean(), accent: z.enum(LOOK_ACCENT_PRESETS).optional() }).strict(),
  z
    .object({
      on: z.boolean(),
      accent: z.literal(CUSTOM_LOOK_ACCENT),
      hex: z
        .string()
        .regex(HEX_COLOR)
        .transform((hex) => hex.toLowerCase()),
    })
    .strict(),
]);

export type SiteLookSetting = z.infer<typeof siteLookSchema>;

/** Off until the club approves the new look on QA (decision 12). */
export const DEFAULT_SITE_LOOK_SETTING: SiteLookSetting = { on: false };

/** The setting's accent, the default filled in. */
export function lookAccentOf(setting: SiteLookSetting): LookAccentSetting {
  if (setting.accent === CUSTOM_LOOK_ACCENT) return { accent: CUSTOM_LOOK_ACCENT, hex: setting.hex };
  return { accent: setting.accent ?? DEFAULT_LOOK_ACCENT };
}

/** The four shades, light and dark, an accent setting wears: a preset's own, or derived from the typed colour. */
export function lookAccentShades(accent: LookAccentSetting): AccentShades {
  return accent.accent === CUSTOM_LOOK_ACCENT ? deriveAccentShades(accent.hex) : LOOK_ACCENT[accent.accent];
}

/** MUI's primary colour variables, as `theme.vars.palette.primary` names them (pinned by a test). */
export const PRIMARY_VARIABLES = {
  main: "--mui-palette-primary-main",
  light: "--mui-palette-primary-light",
  dark: "--mui-palette-primary-dark",
  contrastText: "--mui-palette-primary-contrastText",
} as const;

type Primary = Record<keyof typeof PRIMARY_VARIABLES, string>;

/**
 * The primary under the new look, by token name: the accent that carries words as `main` (a link, an
 * outline, a contained button's fill), the deeper one on hover as `dark`, the hot one as `light`,
 * and the colour of the words on the fill — white by day, the dark page after dark. Names, so the
 * design page can say which shade each is; the shade's value is the accent's (`LOOK_ACCENT`, or a
 * typed colour's derivation), the words' colour always the platform's.
 */
export const LOOK_PRIMARY_TOKENS = {
  light: { main: "accentInk", light: "accent", dark: "accentDeep", contrastText: "surface" },
  dark: { main: "accentInk", light: "accent", dark: "accentDeep", contrastText: "paper" },
} as const satisfies { light: Record<keyof typeof PRIMARY_VARIABLES, keyof typeof COLOR>; dark: Record<keyof typeof PRIMARY_VARIABLES, keyof typeof COLOR_DARK> };

/** One scheme's primary, from an accent's shades and the platform's colour for the words on its fill. */
function primaryOf(shade: AccentShade, contrastText: string): Primary {
  return { main: shade.accentInk, light: shade.accent, dark: shade.accentDeep, contrastText };
}

/** The primary of an accent, light and dark. */
export function lookPrimary(shades: AccentShades): { light: Primary; dark: Primary } {
  return {
    light: primaryOf(shades.light, COLOR[LOOK_PRIMARY_TOKENS.light.contrastText]),
    dark: primaryOf(shades.dark, COLOR_DARK[LOOK_PRIMARY_TOKENS.dark.contrastText]),
  };
}

/** The default (pink) primary, as the hex values `brand.ts` gives its tokens — what the design page's side-by-side draws. */
export const LOOK_PRIMARY: { light: Primary; dark: Primary } = lookPrimary(LOOK_ACCENT[DEFAULT_LOOK_ACCENT]);

/** One scheme's declarations: each primary variable and its `…Channel` twin, then the pale band. */
function declarations(primary: Primary, tint: string): string {
  return [
    ...(Object.keys(PRIMARY_VARIABLES) as (keyof typeof PRIMARY_VARIABLES)[]).map(
      (key) => `${PRIMARY_VARIABLES[key]}:${primary[key]};${PRIMARY_VARIABLES[key]}Channel:${hexChannel(primary[key])}`,
    ),
    `${LOOK_ACCENT_TINT_VARIABLE}:${tint}`,
  ].join(";");
}

/**
 * An accent as CSS, for the public scope and the preview box together: the light rule, then the dark
 * one, whose selectors carry `data-dark` and so outrank it in the dark scheme. Pink unless told.
 */
export function lookPaletteCss(shades: AccentShades = LOOK_ACCENT[DEFAULT_LOOK_ACCENT]): string {
  const primary = lookPrimary(shades);
  return `${LOOK_ROOT},${LOOK_PREVIEW}{${declarations(primary.light, shades.light.accentTint)}}${LOOK_ROOT_DARK},${LOOK_PREVIEW_DARK}{${declarations(primary.dark, shades.dark.accentTint)}}`;
}

/** The stylesheet the layout draws for a setting, or `null` while the look is off. */
export function siteLookStyle(setting: SiteLookSetting): string | null {
  return setting.on ? lookPaletteCss(lookAccentShades(lookAccentOf(setting))) : null;
}

/**
 * A stored value this code can read, or the default (off) — never a throw over a look. A typed accent
 * that would be refused today (a row written by hand, a rule tightened later) keeps the switch and
 * reads as the default pink: the page is never drawn in an accent the service would refuse.
 */
export function parseSiteLook(value: unknown): SiteLookSetting {
  const parsed = siteLookSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_SITE_LOOK_SETTING;
  if (parsed.data.accent === CUSTOM_LOOK_ACCENT && judgeAccent(parsed.data.hex) !== null) return { on: parsed.data.on };
  return parsed.data;
}

/** One word for the audit row and the log. */
export function describeSiteLook(setting: SiteLookSetting): "on" | "off" {
  return setting.on ? "on" : "off";
}

/** The accent in a word for the audit row: the preset's name, or `custom #rrggbb`. */
export function describeLookAccent(setting: SiteLookSetting): string {
  const accent = lookAccentOf(setting);
  return accent.accent === CUSTOM_LOOK_ACCENT ? `${CUSTOM_LOOK_ACCENT} ${accent.hex}` : accent.accent;
}
