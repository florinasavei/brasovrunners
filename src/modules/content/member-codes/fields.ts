import { z } from "zod";
import { refuseOneLanguage } from "@/shared/forms/both-languages";

/**
 * What the club types for one discount code of the members' zone (§NNN).
 *
 * The partner's name and the code, required: a code nobody can place is no code. What it gives, a
 * line or two, in Romanian **and** English or in neither (§352). An optional https link where the
 * code is used, and an optional last day, `YYYY-MM-DD` — the day it stops being shown. One side of
 * the description written and the other empty is refused on the empty box, every other box kept
 * (§315).
 */

export const CODE_PARTNER_MAX = 80;
export const CODE_MAX = 60;
export const CODE_DESCRIPTION_MAX = 300;
export const CODE_LINK_MAX = 500;

/** One line: the partner and the code are never paragraphs. */
const oneLine = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

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
  .pipe(z.string().max(CODE_DESCRIPTION_MAX))
  .transform((value) => (value === "" ? null : value));

/** A calendar day that exists: "2027-02-30" is refused, not rolled into March. */
export function isCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const discountCodeFieldsSchema = z
  .object({
    partnerName: oneLine(CODE_PARTNER_MAX),
    code: oneLine(CODE_MAX),
    descriptionRo: description,
    descriptionEn: description,
    link: z
      .string()
      .optional()
      .default("")
      .transform((value) => value.trim())
      .pipe(z.string().max(CODE_LINK_MAX).refine((value) => value === "" || /^https:\/\/\S+$/.test(value), "the link must start with https://"))
      .transform((value) => (value === "" ? null : value)),
    validUntil: z
      .string()
      .optional()
      .default("")
      .transform((value) => value.trim())
      .refine((value) => value === "" || isCalendarDay(value), "not a day")
      .transform((value) => (value === "" ? null : value)),
  })
  .superRefine((fields, ctx) => {
    refuseOneLanguage(ctx, { ro: fields.descriptionRo, en: fields.descriptionEn }, { ro: ["descriptionRo"], en: ["descriptionEn"] }, "the description");
  });

export type DiscountCodeFields = z.output<typeof discountCodeFieldsSchema>;

/**
 * Whether members see a code today (§NNN): not hidden, and its last day — the club's calendar day,
 * inclusive — not passed. The same rule as the members' read in SQL (`repository.ts`), for the
 * backoffice's line and the tests.
 */
export function codeShownToMembers(code: { hidden: boolean; validUntil: string | null }, today: string): boolean {
  return !code.hidden && (code.validUntil === null || code.validUntil >= today);
}
