import { z } from "zod";
import { SITE_TINT } from "@/theme/brand";
import { HEX_COLOR, judgeTint } from "./tint-contrast";

/**
 * «Aspectul site-ului» — the public pages' background tint (§NNN; the owner: a setting for the
 * site's light background, "a slight shade of blue (club colours)").
 *
 * Pure: no database, no environment. The club picks one of the presets in `SITE_TINT`
 * (`theme/brand.ts`, the only file allowed to name a colour) or «Personalizat», a `#rrggbb` it
 * types — refused unless body and muted text clear AA on it and a white card still reads as a
 * card (`tint-contrast.ts`). Stored as `{ tint: "<preset>" }` or `{ tint: "custom", hex }`.
 *
 * How it reaches the page: the locale layout draws one small stylesheet (`siteTintStyle`) that
 * sets MUI's own page-colour variable, `--mui-palette-background-default`, and its channel twin,
 * on `<body>` — the variable `CssBaseline` paints the page with, and the only thing in `src/` that
 * reads `background.default`. One variable, set on the server, so the first paint is already
 * tinted and no client code runs for it. Why MUI's variable rather than a `--br-page-bg` of our
 * own that the theme would read: MUI's variable is already the one the page is painted with, in
 * both schemes; a second variable would mean the light scheme's theme reading
 * `var(--br-page-bg, …)` while the dark one did not — a change to the theme for one consumer.
 * Overriding the one variable at the point of use leaves the theme object and the dark scheme
 * exactly as they were, and a unit test pins the variable's name against `theme.vars`, so a
 * rename in MUI fails loudly rather than silently dropping the tint.
 *
 * - **Light only.** The selector names `:root:not([data-dark])`: the dark scheme (§93) keeps its
 *   own page colour, and with JavaScript off (no `data-light` yet) the light default still takes
 *   the tint.
 * - **Public pages only.** `body:not(:has([data-backoffice]))`: the backoffice shell and its
 *   resting notice carry the marker, so staff always work on the platform's neutral paper.
 * - **Unlayered.** MUI's styles live in a CSS layer (`modularCssLayers`), so this plain rule wins
 *   over `CssBaseline`'s without a specificity contest.
 * - **The default draws nothing.** `paper` is the theme's own colour; a database without a row
 *   renders byte for byte what it rendered before this setting existed.
 * - **Nothing typed reaches the `<style>` text unchecked.** A custom colour is `#` and six hex
 *   digits, lower-cased, checked again as the rule is drawn.
 */

export const SITE_TINT_PRESETS = ["paper", "faintBlue", "lightBlue", "blueGrey"] as const satisfies readonly (keyof typeof SITE_TINT)[];
export type SiteTintPreset = (typeof SITE_TINT_PRESETS)[number];

/** The radio's values: every preset, then «Personalizat». */
export const CUSTOM_SITE_TINT = "custom";
export const SITE_TINT_CHOICES = [...SITE_TINT_PRESETS, CUSTOM_SITE_TINT] as const;
export type SiteTintChoice = (typeof SITE_TINT_CHOICES)[number];

export const DEFAULT_SITE_TINT: SiteTintPreset = "paper";

export type SiteTintSetting = { tint: SiteTintPreset } | { tint: typeof CUSTOM_SITE_TINT; hex: string };

export const DEFAULT_SITE_TINT_SETTING: SiteTintSetting = { tint: DEFAULT_SITE_TINT };

/** The stored shape, strictly: a preset name, or `custom` with a `#rrggbb` (lower-cased). */
export const siteTintSchema = z.union([
  z.object({ tint: z.enum(SITE_TINT_PRESETS) }).strict(),
  z
    .object({
      tint: z.literal(CUSTOM_SITE_TINT),
      hex: z
        .string()
        .regex(HEX_COLOR)
        .transform((hex) => hex.toLowerCase()),
    })
    .strict(),
]);

/** Where the tint applies: the light scheme, and never inside the backoffice (see above). */
export const SITE_TINT_SELECTOR = ":root:not([data-dark]) body:not(:has([data-backoffice]))";

/** MUI's page colour, as `theme.vars.palette.background.default` names it (pinned by a test). */
export const PAGE_COLOR_VARIABLE = "--mui-palette-background-default";

/** `#rrggbb` → `"r g b"`, the form MUI keeps its `…Channel` variables in (`alpha()` reads it). */
export function hexChannel(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  return match
    .slice(1)
    .map((pair) => Number.parseInt(pair, 16))
    .join(" ");
}

/** The colour a setting paints the page with. */
export function siteTintColor(setting: SiteTintSetting): string {
  return setting.tint === CUSTOM_SITE_TINT ? setting.hex : SITE_TINT[setting.tint];
}

/** One short word for the audit row and the log: the preset's name, or `custom #rrggbb`. */
export function describeSiteTint(setting: SiteTintSetting): string {
  return setting.tint === CUSTOM_SITE_TINT ? `${CUSTOM_SITE_TINT} ${setting.hex}` : setting.tint;
}

/**
 * The stylesheet the layout draws for a setting, or `null` for the default — which is the theme's
 * own colour and needs no rule at all — and `null` for anything that is not `#rrggbb`, so no text
 * but a checked colour is ever written into the `<style>` element.
 */
export function siteTintStyle(setting: SiteTintSetting): string | null {
  if (setting.tint === DEFAULT_SITE_TINT) return null;
  const hex = siteTintColor(setting).toLowerCase();
  if (!HEX_COLOR.test(hex)) return null;
  return `${SITE_TINT_SELECTOR}{${PAGE_COLOR_VARIABLE}:${hex};${PAGE_COLOR_VARIABLE}Channel:${hexChannel(hex)}}`;
}

/**
 * A stored value this code can read, or the default — never a throw over a page colour. A custom
 * colour that no longer keeps the two rules (a row written by hand, a rule tightened later) is read
 * as the default too: the page is never drawn in a colour the service would refuse today.
 */
export function parseSiteTint(value: unknown): SiteTintSetting {
  const parsed = siteTintSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_SITE_TINT_SETTING;
  if (parsed.data.tint === CUSTOM_SITE_TINT && judgeTint(parsed.data.hex) !== null) return DEFAULT_SITE_TINT_SETTING;
  return parsed.data;
}
