import { z } from "zod";
import { homeTextSchema, type HomeText } from "./home-text";

/**
 * «De ce» — the home page's four reasons and the quote (§NNN; `docs/REDESIGN.md` § What exists
 * versus what is new: «the words, four icons; Caveat on the home page»). Four items, each a glyph,
 * a short title and one sentence; under them, a sentence someone said about the club, in the
 * handwriting face, with who said it.
 *
 * **The quote is never the platform's.** A quote is a person's words; the platform has none to lend
 * (decision 8's rule for figures, BUSINESS.md §7, read for words too): until the club types one, in
 * both languages, nothing is drawn where it would be. The four items do have the platform's
 * sentences, plain ones the club rewrites.
 */
export const WHY_GLYPHS = ["together", "mountains", "free", "everyone"] as const;
export type WhyGlyph = (typeof WHY_GLYPHS)[number];

/** How many reasons the list draws: one per glyph. */
export const WHY_COUNT = WHY_GLYPHS.length;

export type WhyItemContent = { title: HomeText | null; body: HomeText | null };

/** What the club types: the heading, the four reasons and the quote, every box both languages or neither. */
export type WhyContent = {
  title: HomeText | null;
  items: readonly WhyItemContent[];
  quote: HomeText | null;
  /** Who said it; drawn only beside a quote. */
  quoteBy: HomeText | null;
};

export const EMPTY_WHY: WhyContent = {
  title: null,
  items: WHY_GLYPHS.map(() => ({ title: null, body: null })),
  quote: null,
  quoteBy: null,
};

export const whyContentSchema = z.object({
  title: homeTextSchema(80),
  items: z.array(z.object({ title: homeTextSchema(60), body: homeTextSchema(200) })).length(WHY_COUNT),
  quote: homeTextSchema(280),
  quoteBy: homeTextSchema(80),
});

/** A stored value that no longer parses reads as the empty list: the platform's reasons, no quote. */
export function readWhyContent(value: unknown): WhyContent {
  const parsed = whyContentSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_WHY;
}
