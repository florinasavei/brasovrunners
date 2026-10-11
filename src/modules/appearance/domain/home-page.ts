import { z } from "zod";
import { imageCropSchema } from "@/modules/content/rich-text/domain/schema";
import { EMPTY_NUMBERS, numbersContentSchema } from "@/modules/home/domain/numbers";
import { EMPTY_STRIP, stripContentSchema } from "@/modules/home/domain/photo-strip";
import { EMPTY_STEPS, stepsContentSchema } from "@/modules/home/domain/steps";
import { EMPTY_WHY, whyContentSchema } from "@/modules/home/domain/why";
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
 * - `buttons` — the hero's three buttons' labels (both languages or neither) and «Cum funcționează»'s
 *   club page, by its id.
 * - `sections` — which sections the page draws: the hero, the next run, the weekly runs and the
 *   special events (on), and «Prima dată», «De ce», the photo strip and the numbers (off until the
 *   club switches each on, once it has its words, its pictures or its figures).
 * - `steps`, `why`, `strip`, `numbers` — what the club typed or chose for those four
 *   (`modules/home/domain/`): every box both languages or neither, an empty one the platform's words;
 *   the strip's pictures with their facts; the founding day and the runners' count.
 *
 * Every field but `on` is optional, and each of the four lower sections that no longer parses reads
 * as its empty value rather than turning the page off; the row is read loosely, so a field a later
 * release wrote is carried, never dropped, and never turns the page off after a rollback.
 */

/** The `platform_settings` key of the row. */
export const HOME_PAGE_SETTING_KEY = "homePage";

/** The longest headline the hero sets in its `h1`: two short lines at 320 pixels. */
export const HOME_HEADLINE_MAX = 80;
/** The longest subline under it. */
export const HOME_SUBLINE_MAX = 200;
/** The longest label on one of the hero's three buttons. */
export const HOME_BUTTON_MAX = 30;

/**
 * The page's sections, in the order the page draws them. The first four are on by default; the last
 * four — «Prima dată», «De ce», the photo strip, the numbers — are off until the club switches each
 * on (the plan's «each off by default»): their words start as the platform's, the strip has no
 * picture and the numbers no figure the club gave.
 */
export const HOME_SECTION_KEYS = ["hero", "nextRun", "weekly", "special", "steps", "why", "strip", "numbers"] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

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

const buttonLabel = bilingual(HOME_BUTTON_MAX).nullable().default(null);

/**
 * The hero's three buttons. «Vino cu noi» goes to the next weekly run and «Vezi calendarul» to the
 * calendar (the plan's targets, decision 5); a null label reads the platform's own word from the
 * catalogue. «Cum funcționează» goes to a club page («Pagini personalizate») the club chooses, by its
 * id — resolved to the page's own address in each language, since a page's address differs between
 * them — and is not drawn until one is chosen and published; its label is the club's or the
 * platform's. A value this code cannot read (an older shape) is no button, never the page off.
 */
const buttonsSchema = z.object({
  join: buttonLabel,
  calendar: buttonLabel,
  how: z.object({ label: buttonLabel, pageId: z.uuid() }).strict().nullable().default(null).catch(null),
});

const sectionsSchema = z.object({
  hero: z.boolean().default(true),
  nextRun: z.boolean().default(true),
  weekly: z.boolean().default(true),
  special: z.boolean().default(true),
  steps: z.boolean().default(false),
  why: z.boolean().default(false),
  strip: z.boolean().default(false),
  numbers: z.boolean().default(false),
});

const DEFAULT_BUTTONS = { join: null, calendar: null, how: null } as const;
const DEFAULT_SECTIONS = { hero: true, nextRun: true, weekly: true, special: true, steps: false, why: false, strip: false, numbers: false } as const;

// Read loosely: a row written by a later release (or read after a rollback from one) keeps what this
// code understands and carries what it does not, so an unknown key never turns the page off.
export const homePageSchema = z.looseObject({
  on: z.boolean(),
  hero: heroSchema.nullable().default(null),
  headline: bilingual(HOME_HEADLINE_MAX).nullable().default(null),
  subline: bilingual(HOME_SUBLINE_MAX).nullable().default(null),
  buttons: buttonsSchema.default(DEFAULT_BUTTONS),
  sections: sectionsSchema.default(DEFAULT_SECTIONS),
  // The four lower sections' contents: absent or unreadable, the empty section (the platform's words, no picture, no figure).
  steps: stepsContentSchema.catch(EMPTY_STEPS),
  why: whyContentSchema.catch(EMPTY_WHY),
  strip: stripContentSchema.catch(EMPTY_STRIP),
  numbers: numbersContentSchema.catch(EMPTY_NUMBERS),
});

export type HomeHeroPicture = z.infer<typeof heroSchema>;
export type HomePageSetting = z.infer<typeof homePageSchema>;
export type BilingualText = Record<TextLanguage, string>;

/** Off, with an empty photo slot and the platform's two lines: the plan's defaults (2026-10-11). */
export const DEFAULT_HOME_PAGE_SETTING: HomePageSetting = {
  on: false,
  hero: null,
  headline: null,
  subline: null,
  buttons: { ...DEFAULT_BUTTONS },
  sections: { ...DEFAULT_SECTIONS },
  steps: EMPTY_STEPS,
  why: EMPTY_WHY,
  strip: EMPTY_STRIP,
  numbers: EMPTY_NUMBERS,
};

/** Whether a section is drawn by default: the first four on, the four lower ones off. */
export const DEFAULT_SECTION_SHOWN: Readonly<Record<HomeSectionKey, boolean>> = DEFAULT_SECTIONS;

/** Whether a section is drawn: the club's switch, on for the first four and off for the lower four until switched. */
export const sectionShown = (setting: Pick<HomePageSetting, "sections">, key: HomeSectionKey): boolean => setting.sections[key];

/** A stored value this code can read, or the default (off) — never a throw over the site's root. */
export function parseHomePage(value: unknown): HomePageSetting {
  const parsed = homePageSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_HOME_PAGE_SETTING;
  // A film's poster (`yt-…`, §485) is never a photograph of the club: an empty slot, not a frame, and no tile in the strip.
  const poster = (keyPrefix: string) => keyPrefix.startsWith("yt-");
  const setting = parsed.data;
  return {
    ...setting,
    hero: setting.hero && poster(setting.hero.keyPrefix) ? null : setting.hero,
    strip: { ...setting.strip, pictures: setting.strip.pictures.filter((picture) => !poster(picture.keyPrefix)) },
  };
}

/** The label of a hero button in one language: what the club typed, or null for the platform's own word. */
export function buttonLabelIn(label: BilingualText | null, locale: TextLanguage): string | null {
  return label?.[locale] ?? null;
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
