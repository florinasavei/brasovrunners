import { z } from "zod";
import { imageCropSchema } from "@/modules/content/rich-text/domain/schema";
import { isWrittenText, missingLanguage, type TextLanguage } from "@/shared/forms/both-languages";

/**
 * «Pagina principală» (the facelift's phase 3, §NNN; `docs/REDESIGN.md`, decision 3): a real home page
 * at `/ro` and `/en`, reached from the logo and never from a menu entry, switched on and off by the
 * club under «Setări» → «Aspect». Off — the default, and what a database without the row reads — the
 * root goes to the listing as it always did, and nothing on any page changes.
 *
 * Pure: no database, no environment. One `platform_settings` row (`homePage`):
 *
 * - `on` — whether the root is the home page (true) or the listing's redirect (false).
 * - `hero` — the hero's photograph: the stored picture's id, the facts the ladder's `srcset` is built
 *   from (its key prefix and size, copied at the save so the public read asks the store nothing, as an
 *   event's `cover` does, §709) and the crop the club drew, or null for an empty slot. Only a real
 *   photograph of the club, from the gallery or uploaded (decision 6): the picker offers nothing else.
 * - `headline`, `subline` — the hero's two lines, Romanian **and** English or neither (§352); neither
 *   reads the platform's own two lines from the catalogue (`Home.hero.*`).
 *
 * Part B of the phase adds the rest of the page's settings to the same row (the band, the strip, the
 * numbers); a value written by this part stays readable then, because every new field is optional.
 */

/** The `platform_settings` key of the row. */
export const HOME_PAGE_SETTING_KEY = "homePage";

/** The longest headline the hero sets in its `h1`: two short lines at 320 pixels. */
export const HOME_HEADLINE_MAX = 80;
/** The longest subline under it. */
export const HOME_SUBLINE_MAX = 200;

const bilingual = (max: number) =>
  z
    .object({ ro: z.string().trim().min(1).max(max), en: z.string().trim().min(1).max(max) })
    .strict();

const heroSchema = z
  .object({
    assetId: z.string().uuid(),
    keyPrefix: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    crop: imageCropSchema.nullable(),
  })
  .strict();

export const homePageSchema = z
  .object({
    on: z.boolean(),
    hero: heroSchema.nullable().default(null),
    headline: bilingual(HOME_HEADLINE_MAX).nullable().default(null),
    subline: bilingual(HOME_SUBLINE_MAX).nullable().default(null),
  })
  .strict();

export type HomeHeroPicture = z.infer<typeof heroSchema>;
export type HomePageSetting = z.infer<typeof homePageSchema>;
export type BilingualText = Record<TextLanguage, string>;

/** Off, with an empty photo slot and the platform's two lines: the plan's defaults (2026-10-11). */
export const DEFAULT_HOME_PAGE_SETTING: HomePageSetting = { on: false, hero: null, headline: null, subline: null };

/** A stored value this code can read, or the default (off) — never a throw over the site's root. */
export function parseHomePage(value: unknown): HomePageSetting {
  const parsed = homePageSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_HOME_PAGE_SETTING;
  // A film's poster (`yt-…`, §485) is never a photograph of the club: an empty slot, not a frame.
  if (parsed.data.hero?.keyPrefix.startsWith("yt-")) return { ...parsed.data, hero: null };
  return parsed.data;
}

/** One word for the audit row and the log. */
export function describeHomePage(setting: Pick<HomePageSetting, "on">): "on" | "off" {
  return setting.on ? "on" : "off";
}

/**
 * The two lines in one language: what the club typed, or null where it typed nothing, so the page
 * reads the platform's line from the catalogue. Never the other language's words (§28, §352).
 */
export function heroLines(setting: HomePageSetting, locale: TextLanguage): { headline: string | null; subline: string | null } {
  return { headline: setting.headline?.[locale] ?? null, subline: setting.subline?.[locale] ?? null };
}

/**
 * The headline as the hero draws it (the plan's «two-tone word a `span`, not a gradient»): the last
 * word in the accent, the rest in ink — so a typed headline gets the same look as the platform's
 * without the club marking anything. A one-word headline has no second tone.
 */
export function splitHeadline(headline: string): { lead: string; accent: string | null } {
  const words = headline.trim().split(/\s+/);
  if (words.length < 2) return { lead: headline.trim(), accent: null };
  return { lead: words.slice(0, -1).join(" "), accent: words[words.length - 1] };
}

/**
 * What the form posted for one pair of boxes: both written (trimmed), neither (null), or the language
 * left empty while the other is written — which the save refuses, naming that box (§352).
 */
export function postedPair(pair: Readonly<Record<TextLanguage, unknown>>): BilingualText | null | { missing: TextLanguage } {
  const text = { ro: typeof pair.ro === "string" ? pair.ro.trim() : "", en: typeof pair.en === "string" ? pair.en.trim() : "" };
  const missing = missingLanguage(text, isWrittenText);
  if (missing) return { missing };
  return isWrittenText(text.ro) ? text : null;
}
