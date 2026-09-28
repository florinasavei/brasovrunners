import { z } from "zod";

/**
 * «Mărimea textului» — the public pages' text size (§530, shaped like §488). Pure. Each step is a
 * percentage on `<html>`, so it multiplies the reader's own browser size; MUI's typography is in
 * `rem`, so text scales while pixel spacing stays. Both schemes, public pages only, unlayered; the
 * default draws nothing and the rule is written from the step's own number.
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

export const siteFontSizeSchema = z.object({ size: z.enum(SITE_FONT_SIZES) }).strict();

/** Where the size applies: every scheme, never inside the backoffice (see above). */
export const SITE_FONT_SIZE_SELECTOR = "html:not(:has([data-backoffice]))";

/** The body text's size in pixels at a step, for a reader whose browser keeps the usual 16 px. */
export function siteFontSizePixels(size: SiteFontSize): number {
  return (16 * SITE_FONT_SIZE_PERCENT[size]) / 100;
}

/** The layout's stylesheet, or `null` for the default. */
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
