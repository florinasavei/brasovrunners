import { z } from "zod";
import { MEMBER_TIERS_MAX } from "@/modules/content/member-tiers/fields";
import { refuseOneLanguage } from "@/shared/forms/both-languages";

/**
 * What the club types for one discount code of the members' zone (§552).
 *
 * The partner's name and the code, required: a code nobody can place is no code. What it gives, a
 * line or two, in Romanian **and** English or in neither (§352). An optional https link where the
 * code is used, and an optional last day, `YYYY-MM-DD` — the day it stops being shown. One side of
 * the description written and the other empty is refused on the empty box, every other box kept
 * (§315). Who the code is for is chosen, not defaulted: levels or «Toți membrii» (§811, amended by §828).
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
    // «Pentru cine e codul» (§811, amended by §828): the member tiers that see the code, ticked as chips. Ids only —
    // whether each names a tier is the service's question, asked under a lock. The club's choice is explicit:
    // levels here, or «Toți membrii» in `forAll` below, one of the two and never both, never neither.
    tierIds: z
      .array(z.string())
      .max(MEMBER_TIERS_MAX)
      .optional()
      .default([])
      .transform((ids) => [...new Set(ids.map((id) => id.trim().toLowerCase()))])
      // One issue on the chips' box, whichever id is wrong.
      .refine((ids) => ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)), "not a member tier"),
    // «Toți membrii»: the chip that says the code is for members with or without a level. A post of its own, kept out
    // of the uuid list; a tick posts `1`, a caller may pass `true`. It is stored as the limit's absence (`tier_ids` null).
    forAll: z
      .union([z.boolean(), z.string()])
      .optional()
      .default(false)
      .transform((value) => value === true || (typeof value === "string" && ["1", "true", "on"].includes(value.trim().toLowerCase()))),
  })
  .superRefine((fields, ctx) => {
    // Who the code is for is chosen, never left empty (§811 amended): one issue, on the chips' box `tierIds`, whichever way it is wrong.
    if (fields.forAll === (fields.tierIds.length > 0)) {
      ctx.addIssue({ code: "custom", path: ["tierIds"], message: fields.forAll ? "choose all members or some levels, not both" : "choose who the code is for" });
    }
    refuseOneLanguage(ctx, { ro: fields.descriptionRo, en: fields.descriptionEn }, { ro: ["descriptionRo"], en: ["descriptionEn"] }, "the description");
  });

export type DiscountCodeFields = z.output<typeof discountCodeFieldsSchema>;

/**
 * Whether members see a code today (§552): not hidden, and its last day — the club's calendar day,
 * inclusive — not passed. The same rule as the members' read in SQL (`repository.ts`), for the
 * backoffice's line and the tests.
 */
export function codeShownToMembers(code: { hidden: boolean; validUntil: string | null }, today: string): boolean {
  return !code.hidden && (code.validUntil === null || code.validUntil >= today);
}
