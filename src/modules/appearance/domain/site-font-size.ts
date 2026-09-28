import { z } from "zod";

/**
 * «Mărimea textului» — the public pages' text size, a club setting beside the background tint
 * (§530, the shape of §488; the owner: "change the application's global font size, as a setting
 * in the backoffice, like the colour").
 *
 * Pure: no database, no environment. The club picks one of four steps; each is a percentage of
 * the root font size, so it multiplies whatever size the visitor's own browser asks for rather
 * than replacing it — a reader who set 20 px in their browser still reads larger than one who did
 * not. Stored as `{ size: "<step>" }`.
 *
 * How it reaches the page: the locale layout draws one small stylesheet (`siteFontSizeStyle`)
 * that sets `font-size` on `<html>`. MUI's typography is written in `rem` (`htmlFontSize` 16, the
 * default), so every heading, paragraph, button, field and MUI icon scales with it, and the page's
 * spacing and widths — in pixels — stay where they are. Set on the server, so the first paint is
 * already at the chosen size and no client code runs for it.
 *
 * - **Both schemes.** Unlike the tint, the size is not a colour: light and dark read the same.
 * - **Public pages only.** `html:not(:has([data-backoffice]))`: the backoffice shell carries the
 *   marker (§488), so staff always work at the platform's size. A browser without `:has()` drops
 *   the rule and shows the platform's size — accepted, as §488 accepts it.
 * - **Unlayered.** MUI's styles live in a CSS layer, so this plain rule needs no specificity contest.
 * - **The default draws nothing.** A database without a row renders byte for byte what it rendered
 *   before this setting existed.
 * - **Nothing typed reaches the `<style>` text.** The rule is written from the step's own number.
 */

/** Each step's size, as a percentage of the root font size the browser gives (16 px for most readers). */
export const SITE_FONT_SIZE_PERCENT = {
  small: 93.75,
  normal: 100,
  large: 106.25,
  xlarge: 112.5,
} as const;

export const SITE_FONT_SIZES = ["small", "normal", "large", "xlarge"] as const satisfies readonly (keyof typeof SITE_FONT_SIZE_PERCENT)[];
export type SiteFontSize = (typeof SITE_FONT_SIZES)[number];

export const DEFAULT_SITE_FONT_SIZE: SiteFontSize = "normal";

export type SiteFontSizeSetting = { size: SiteFontSize };

export const DEFAULT_SITE_FONT_SIZE_SETTING: SiteFontSizeSetting = { size: DEFAULT_SITE_FONT_SIZE };

/** The stored shape, strictly: one of the steps. */
export const siteFontSizeSchema = z.object({ size: z.enum(SITE_FONT_SIZES) }).strict();

/** Where the size applies: every scheme, never inside the backoffice (see above). */
export const SITE_FONT_SIZE_SELECTOR = "html:not(:has([data-backoffice]))";

/** The body text's size in pixels at a step, for a reader whose browser keeps the usual 16 px. */
export function siteFontSizePixels(size: SiteFontSize): number {
  return (16 * SITE_FONT_SIZE_PERCENT[size]) / 100;
}

/**
 * The stylesheet the layout draws for a setting, or `null` for the default — the platform's own
 * size needs no rule at all.
 */
export function siteFontSizeStyle(setting: SiteFontSizeSetting): string | null {
  if (setting.size === DEFAULT_SITE_FONT_SIZE) return null;
  const percent = SITE_FONT_SIZE_PERCENT[setting.size];
  if (typeof percent !== "number") return null;
  return `${SITE_FONT_SIZE_SELECTOR}{font-size:${percent}%}`;
}

/** A stored value this code can read, or the default — never a throw over a text size. */
export function parseSiteFontSize(value: unknown): SiteFontSizeSetting {
  const parsed = siteFontSizeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SITE_FONT_SIZE_SETTING;
}
