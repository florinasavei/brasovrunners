import { z } from "zod";
import { refuseOneLanguage } from "@/shared/forms/both-languages";
import { DEFAULT_TIER_GLYPH, isTierGlyphKey } from "./glyph-keys";

/**
 * What the club types for one member tier (§NNN).
 *
 * A name in Romanian **and** English — a level without a name in either language cannot be shown — at
 * most `TIER_NAME_MAX` characters, one line. A description of what the level gives, plain words, in both
 * languages or in neither (§352), at most `TIER_DESCRIPTION_MAX`. A glyph from the closed set
 * (`glyph-keys.ts`), `star` when none is posted. One side of a pair written and the other empty is
 * refused on the empty box, every other box kept (§315).
 */

export const TIER_NAME_MAX = 40;
export const TIER_DESCRIPTION_MAX = 400;
/** How many levels a club may have: a handful is the use; more is a list nobody reads. */
export const MEMBER_TIERS_MAX = 12;

/** One line: a name is never a paragraph. */
const name = z
  .string()
  .optional()
  .default("")
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().max(TIER_NAME_MAX));

/** A short description: trimmed, Windows line breaks made one, at most one empty line in a row. */
const description = z
  .string()
  .optional()
  .default("")
  .transform((value) =>
    value
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  )
  .pipe(z.string().max(TIER_DESCRIPTION_MAX))
  .transform((value) => (value === "" ? null : value));

export const tierFieldsSchema = z
  .object({
    nameRo: name,
    nameEn: name,
    descriptionRo: description,
    descriptionEn: description,
    glyph: z
      .string()
      .optional()
      .default("")
      .transform((value) => (value.trim() === "" ? DEFAULT_TIER_GLYPH : value.trim()))
      .refine(isTierGlyphKey, "not a glyph of the tiers' table"),
  })
  .superRefine((fields, ctx) => {
    // The name is owed in both languages: the zone and the public page draw it in the reader's own.
    if (fields.nameRo === "") ctx.addIssue({ code: "custom", path: ["nameRo"], message: "the name is required in Romanian" });
    if (fields.nameEn === "") ctx.addIssue({ code: "custom", path: ["nameEn"], message: "the name is required in English" });
    refuseOneLanguage(ctx, { ro: fields.descriptionRo, en: fields.descriptionEn }, { ro: ["descriptionRo"], en: ["descriptionEn"] }, "the description");
  });

export type TierFields = z.output<typeof tierFieldsSchema>;

/** A typed position: a whole number from 1, or none. Anything else is refused on the box. */
export function parseTierPosition(value: string | undefined): { ok: true; value: number | null } | { ok: false } {
  const typed = (value ?? "").trim();
  if (typed === "") return { ok: true, value: null };
  if (!/^\d{1,3}$/.test(typed)) return { ok: false };
  const number = Number(typed);
  return number >= 1 ? { ok: true, value: number } : { ok: false };
}
