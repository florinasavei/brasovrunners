import { z } from "zod";
import { SITE_TINT } from "@/theme/brand";
import { HEX_COLOR, judgeTint } from "./tint-contrast";

/**
 * «Aspectul site-ului» — the public pages' background tint (§488). Pure. A preset from `SITE_TINT`
 * or a `#rrggbb` that passes `tint-contrast.ts`.
 *
 * The layout overrides MUI's own page-colour variable on `<body>` (server-drawn, no client code);
 * a test pins its name against `theme.vars`. Light scheme only, public pages only, unlayered so it
 * beats `CssBaseline`'s layered rule. The default draws nothing, and only a checked hex ever
 * reaches the `<style>` text.
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

/** Light scheme, never the backoffice. Without `:has()` the rule is dropped — accepted (§488). */
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

export function siteTintColor(setting: SiteTintSetting): string {
  return setting.tint === CUSTOM_SITE_TINT ? setting.hex : SITE_TINT[setting.tint];
}

/** One short word for the audit row and the log: the preset's name, or `custom #rrggbb`. */
export function describeSiteTint(setting: SiteTintSetting): string {
  return setting.tint === CUSTOM_SITE_TINT ? `${CUSTOM_SITE_TINT} ${setting.hex}` : setting.tint;
}

/** The layout's stylesheet, or `null` for the default or anything not `#rrggbb` (never unchecked text in `<style>`). */
export function siteTintStyle(setting: SiteTintSetting): string | null {
  if (setting.tint === DEFAULT_SITE_TINT) return null;
  const hex = siteTintColor(setting).toLowerCase();
  if (!HEX_COLOR.test(hex)) return null;
  return `${SITE_TINT_SELECTOR}{${PAGE_COLOR_VARIABLE}:${hex};${PAGE_COLOR_VARIABLE}Channel:${hexChannel(hex)}}`;
}

/** The stored value, or the default — never a throw; a custom colour the rules now refuse reads as the default. */
export function parseSiteTint(value: unknown): SiteTintSetting {
  const parsed = siteTintSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_SITE_TINT_SETTING;
  if (parsed.data.tint === CUSTOM_SITE_TINT && judgeTint(parsed.data.hex) !== null) return DEFAULT_SITE_TINT_SETTING;
  return parsed.data;
}
