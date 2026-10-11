import { z } from "zod";
import type { Locale } from "@/i18n/routing";
import { isWrittenText, refuseOneLanguage } from "@/shared/forms/both-languages";

/**
 * A text the club types for the home page's sections (§714; `docs/REDESIGN.md`, phase 3): Romanian
 * **and** English, both or neither (§352, `shared/forms/both-languages.ts`). Neither means «the
 * platform's words»: every box of the four sections starts empty and the page draws the default
 * sentence from the catalogues (`HomeSections.*`) until the club writes its own, so the page has
 * something true to say on the day it is switched on and never mixes a Romanian box into an English
 * page.
 *
 * Pure: the setting's form (the wiring chain), the page and a test read one rule.
 */
export type HomeText = Readonly<{ ro: string; en: string }>;

/**
 * One pair of boxes, at most `max` characters a side, read as a `HomeText` when both are written
 * and `null` when neither is; one side alone is refused on the empty side's path (§352).
 */
export function homeTextSchema(max: number) {
  return z
    .object({ ro: z.string().trim().max(max).default(""), en: z.string().trim().max(max).default("") })
    .nullable()
    .default(null)
    .superRefine((pair, ctx) => {
      if (pair) refuseOneLanguage(ctx, pair, { ro: ["ro"], en: ["en"] }, "the text");
    })
    .transform((pair): HomeText | null => (pair && isWrittenText(pair.ro) && isWrittenText(pair.en) ? { ro: pair.ro, en: pair.en } : null));
}

/** The reader's half of a club text, or `null` when the club wrote none and the default stands. */
export function pickText(text: HomeText | null | undefined, locale: Locale): string | null {
  const value = text?.[locale]?.trim();
  return value ? value : null;
}
