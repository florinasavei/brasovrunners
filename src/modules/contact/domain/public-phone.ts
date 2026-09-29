import { z } from "zod";

/**
 * «Telefon public» — the one telephone number the club chooses to show on the site (§NNN; the
 * owner, 2026-09-29: the club's identity «in the footer, more clearly», after another running
 * club's footer that shows its phone under «Contact»).
 *
 * Pure: no database, no environment. Optional, and unset by default: the site shows no number
 * until an Administrator types one on «Pagini» → «Contact», and a cleared box takes it off again.
 * The value is what the club typed, spaces and all ("+40 7xx xxx xxx" reads better than a run of
 * digits); the `tel:` link is the same number with everything but its digits and a leading `+`
 * taken out. Never a value in the repository — it is a setting, like the contact address (§442).
 */

/** Digits, spaces, a leading `+`, brackets, dots and dashes: what a number is written with. */
const PHONE_SHAPE = /^\+?[\d\s().-]+$/;
const MIN_DIGITS = 6;
const MAX_DIGITS = 15; // E.164's ceiling.

export const PUBLIC_PHONE_MAX = 30;

export type PublicPhone = { phone: string | null };

export const DEFAULT_PUBLIC_PHONE: PublicPhone = { phone: null };

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

/** The stored value's shape: a number as typed (trimmed, inner runs of spaces made one), or null. */
export const publicPhoneSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .max(PUBLIC_PHONE_MAX)
      .nullable()
      .default(null)
      .transform((value) => (value ? value.replace(/\s+/g, " ") : null))
      .refine(
        (value) => value === null || (PHONE_SHAPE.test(value) && digitCount(value) >= MIN_DIGITS && digitCount(value) <= MAX_DIGITS),
        { message: "not a telephone number" },
      ),
  })
  .strict();

/** The `tel:` address of a shown number: its digits, and a leading `+` when it has one. */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
}
