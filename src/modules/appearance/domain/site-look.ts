import { z } from "zod";
import { COLOR, COLOR_DARK } from "@/theme/brand";
import { LOOK_PREVIEW, LOOK_PREVIEW_DARK, LOOK_ROOT, LOOK_ROOT_DARK } from "@/theme/look";
import { hexChannel } from "./site-tint";

/**
 * «Aspectul nou» — the facelift's look on the public pages, one switch (§708; `docs/REDESIGN.md`,
 * decision 12; the shape of «Aspectul site-ului», §488, and «Mărimea textului», §530).
 *
 * Pure: no database, no environment. Stored as `{ on: true }` or `{ on: false }`; no row is off.
 *
 * How it reaches the page, in two parts, both from the locale layout and both nothing at all while
 * the setting is off — a database without the row renders byte for byte what it rendered before:
 *
 * 1. **The scope.** `data-look="2026"` on `<html>` (`theme/look.ts`): the theme's overrides — pill
 *    buttons, the headings in Inter 800 — and the header's «Vino cu noi», socials and watermark are
 *    written under it, public pages only (`:not(:has([data-backoffice]))`).
 * 2. **The pink `primary`.** One small unlayered stylesheet (`siteLookStyle`) that redefines MUI's
 *    own `--mui-palette-primary-*` variables, and their channel twins (`alpha()` reads them), under
 *    the same scope, light and dark. Unlayered for the tint's reason (§488): MUI keeps its variables
 *    in a CSS layer, and a plain rule outranks every layer without a specificity contest — which is
 *    also why this cannot be a theme override. Every value is a `brand.ts` token.
 *
 * The emails, the PDFs, the race numbers and the share cards never read either: they keep the blue.
 */

export const siteLookSchema = z.object({ on: z.boolean() }).strict();

export type SiteLookSetting = z.infer<typeof siteLookSchema>;

/** Off until the club approves the new look on QA (decision 12). */
export const DEFAULT_SITE_LOOK_SETTING: SiteLookSetting = { on: false };

/** MUI's primary colour variables, as `theme.vars.palette.primary` names them (pinned by a test). */
export const PRIMARY_VARIABLES = {
  main: "--mui-palette-primary-main",
  light: "--mui-palette-primary-light",
  dark: "--mui-palette-primary-dark",
  contrastText: "--mui-palette-primary-contrastText",
} as const;

type Primary = Record<keyof typeof PRIMARY_VARIABLES, string>;

/**
 * The primary under the new look, by token name: the pink that carries words as `main` (a link, an
 * outline, a contained button's fill), the deeper one on hover as `dark`, the hot pink as `light`,
 * and the colour of the words on the fill — white by day, the dark page after dark (`brand-pairs.ts`'s
 * `LOOK_PAIRS` hold every one of them at AA). Names, so the design page can say which token each is.
 */
export const LOOK_PRIMARY_TOKENS = {
  light: { main: "accentInk", light: "accent", dark: "accentDeep", contrastText: "surface" },
  dark: { main: "accentInk", light: "accent", dark: "accentDeep", contrastText: "paper" },
} as const satisfies { light: Record<keyof typeof PRIMARY_VARIABLES, keyof typeof COLOR>; dark: Record<keyof typeof PRIMARY_VARIABLES, keyof typeof COLOR_DARK> };

const resolve = <P extends Record<keyof typeof PRIMARY_VARIABLES, string>>(names: P, palette: Record<string, string>): Primary => ({
  main: palette[names.main],
  light: palette[names.light],
  dark: palette[names.dark],
  contrastText: palette[names.contrastText],
});

/** The same, as the hex values `brand.ts` gives those tokens. */
export const LOOK_PRIMARY: { light: Primary; dark: Primary } = {
  light: resolve(LOOK_PRIMARY_TOKENS.light, COLOR),
  dark: resolve(LOOK_PRIMARY_TOKENS.dark, COLOR_DARK),
};

/** One scheme's declarations: each variable and its `…Channel` twin. */
function declarations(primary: Primary): string {
  return (Object.keys(PRIMARY_VARIABLES) as (keyof typeof PRIMARY_VARIABLES)[])
    .map((key) => `${PRIMARY_VARIABLES[key]}:${primary[key]};${PRIMARY_VARIABLES[key]}Channel:${hexChannel(primary[key])}`)
    .join(";");
}

/**
 * The pink primary as CSS, for the public scope and the preview box together: the light rule, then
 * the dark one, whose selectors carry `data-dark` and so outrank it in the dark scheme.
 */
export function lookPaletteCss(): string {
  return `${LOOK_ROOT},${LOOK_PREVIEW}{${declarations(LOOK_PRIMARY.light)}}${LOOK_ROOT_DARK},${LOOK_PREVIEW_DARK}{${declarations(LOOK_PRIMARY.dark)}}`;
}

/** The stylesheet the layout draws for a setting, or `null` while the look is off. */
export function siteLookStyle(setting: SiteLookSetting): string | null {
  return setting.on ? lookPaletteCss() : null;
}

/** A stored value this code can read, or the default (off) — never a throw over a look. */
export function parseSiteLook(value: unknown): SiteLookSetting {
  const parsed = siteLookSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SITE_LOOK_SETTING;
}

/** One word for the audit row and the log. */
export function describeSiteLook(setting: SiteLookSetting): "on" | "off" {
  return setting.on ? "on" : "off";
}
