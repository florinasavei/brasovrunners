import { z } from "zod";

/**
 * The contact form's three boxes (`DECISIONS.md` §149), and the contract between the action
 * and the page for a rejection.
 *
 * Validated like the registration form's own fields: the address goes through `z.email()`
 * before the canonicalizer sees it, the name has no line breaks because it becomes a header
 * (the subject and `Reply-To`), and the message is capped where a mailbox stops reading.
 */

/**
 * Long enough for a paragraph and a question; a message past it is not one person's question.
 * And short enough that a rejection keeps it: the draft cookie holds about 3 800 bytes sealed
 * (`registrations/form-draft.ts`), and the page promises "your message is still written
 * below" on every rejection — `tests/unit/contact/fields.test.ts` proves the longest message,
 * with the longest name and address, fits.
 */
export const CONTACT_MESSAGE_MAX = 2_000;

export const contactFields = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    // A newline in a name is a second header — a classic injection on a form that becomes mail.
    .refine((value) => !/[\r\n]/.test(value)),
  // Trimmed first, like the canonicalizer: a trailing space on a phone keyboard is not a typo.
  email: z.string().trim().max(320).pipe(z.email()),
  message: z.string().trim().min(1).max(CONTACT_MESSAGE_MAX),
  locale: z.enum(["ro", "en"]),
  honeypot: z.string().max(2000).optional(),
  renderedAt: z.iso.datetime().optional(),
});

export type ContactInput = z.infer<typeof contactFields>;

/**
 * The names a rejection may carry in `?fields=`, matched against this list rather than
 * trusted — the same reflected-content reasoning as `registrations/form-errors.ts`. `captcha`
 * is the widget, which has no input of its own.
 */
export const CONTACT_FORM_FIELDS = ["name", "email", "message", "captcha"] as const;

export type ContactFormField = (typeof CONTACT_FORM_FIELDS)[number];

export function parseContactErrorFields(value: string | undefined): ContactFormField[] {
  if (!value) return [];
  const named = new Set(value.split(","));
  return CONTACT_FORM_FIELDS.filter((field) => named.has(field));
}

/**
 * What `?error=` may say, and nothing else. `VALIDATION_ERROR` comes with `fields`; the other
 * three are whole-form answers: too many messages this hour, the club's mailbox could not be
 * reached, or the form is not configured on this deployment at all.
 */
export const CONTACT_ERRORS = ["VALIDATION_ERROR", "LIMITED", "DELIVERY", "UNAVAILABLE"] as const;

export type ContactError = (typeof CONTACT_ERRORS)[number];

export function parseContactError(value: string | undefined): ContactError | null {
  return CONTACT_ERRORS.find((code) => code === value) ?? null;
}

/** The anchor a rejected submission is sent back to (a `"use server"` module may not export it). */
export const CONTACT_ERROR_SUMMARY_ID = "contact-errors";
