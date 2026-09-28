import { z } from "zod";

/** The contact form's fields (§149) and the action–page contract for a rejection. */

/**
 * Short enough that a rejection keeps the draft in its ~3 800-byte sealed cookie
 * (`registrations/form-draft.ts`); `tests/unit/contact/fields.test.ts` proves the worst case fits.
 */
export const CONTACT_MESSAGE_MAX = 2_000;

export const contactFields = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    // The name becomes a header: a newline would inject another.
    .refine((value) => !/[\r\n]/.test(value)),
  email: z.string().trim().max(320).pipe(z.email()),
  message: z.string().trim().min(1).max(CONTACT_MESSAGE_MAX),
  locale: z.enum(["ro", "en"]),
  honeypot: z.string().max(2000).optional(),
  renderedAt: z.iso.datetime().optional(),
});

export type ContactInput = z.infer<typeof contactFields>;

/** Allowed `?fields=` names, never reflected unchecked (as `registrations/form-errors.ts`); `captcha` is the widget. */
export const CONTACT_FORM_FIELDS = ["name", "email", "message", "captcha"] as const;

export type ContactFormField = (typeof CONTACT_FORM_FIELDS)[number];

export function parseContactErrorFields(value: string | undefined): ContactFormField[] {
  if (!value) return [];
  const named = new Set(value.split(","));
  return CONTACT_FORM_FIELDS.filter((field) => named.has(field));
}

/** What `?error=` may say. `VALIDATION_ERROR` comes with `fields`; the rest are whole-form answers. */
export const CONTACT_ERRORS = ["VALIDATION_ERROR", "LIMITED", "DELIVERY", "UNAVAILABLE"] as const;

export type ContactError = (typeof CONTACT_ERRORS)[number];

export function parseContactError(value: string | undefined): ContactError | null {
  return CONTACT_ERRORS.find((code) => code === value) ?? null;
}

/** The anchor a rejected submission is sent back to (a `"use server"` module may not export it). */
export const CONTACT_ERROR_SUMMARY_ID = "contact-errors";
