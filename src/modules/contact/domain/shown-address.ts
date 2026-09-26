import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { z } from "zod";

/**
 * «Adresa de contact afișată» — which address readers are shown and reply to (§442; the owner,
 * 2026-09-26: "I want to be able to switch and show the club's Gmail, or show both").
 *
 * Pure: no database, no environment. Three modes:
 *
 * - `mailbox` — the deployment's own mailbox, `EMAIL_REPLY_TO` (the `mail.` subdomain's). The
 *   default, so a database with no row behaves exactly as before.
 * - `gmail` — the club's Gmail, typed on `/admin/emails`.
 * - `both` — the Gmail first, then the mailbox.
 *
 * The one list this resolves to is used wherever the address is shown (the footer, the contact
 * page, the legal club-email placeholder, the bib's small print) and as every email's Reply-To.
 * The *sender* never follows it: a Gmail `From` sent through Mailgun is not signed by gmail.com,
 * so it fails the recipient's DMARC alignment check and lands in spam or is refused; the messages
 * keep leaving from the `mail.` subdomain and only the Reply-To changes. The contact form's own
 * route (§149, `CONTACT_SMTP_*`) is untouched.
 */

export const CONTACT_ADDRESS_MODES = ["mailbox", "gmail", "both"] as const;
export type ContactAddressMode = (typeof CONTACT_ADDRESS_MODES)[number];

export type ShownContactAddress = { mode: ContactAddressMode; gmail: string | null };

export const DEFAULT_SHOWN_CONTACT_ADDRESS: ShownContactAddress = { mode: "mailbox", gmail: null };

export const shownContactAddressSchema = z
  .object({
    mode: z.enum(CONTACT_ADDRESS_MODES),
    gmail: z
      .string()
      .trim()
      .max(320)
      .nullable()
      .default(null)
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || isValidEmail(value), { message: "not a valid email address" }),
  })
  .strict()
  .superRefine((value, context) => {
    // The Gmail is what the two other modes show; without it they would show nothing.
    if (value.mode !== "mailbox" && value.gmail === null) {
      context.addIssue({ code: "custom", path: ["gmail"], message: "the club's Gmail is required for this choice" });
    }
  });

/**
 * The addresses in force, in order: what a page shows and what the Reply-To header carries.
 *
 * `mailbox` is `EMAIL_REPLY_TO`. A mode whose address is missing falls back to what exists —
 * a `both` on a deployment without the mailbox is the Gmail alone, a `mailbox` without the
 * variable is nothing (as before). Repeats are dropped by spelling, case-insensitively.
 */
export function resolveShownContactAddresses(
  setting: ShownContactAddress | null,
  mailbox: string | null | undefined,
): string[] {
  const chosen = setting ?? DEFAULT_SHOWN_CONTACT_ADDRESS;
  const box = mailbox?.trim() || null;
  const gmail = chosen.gmail?.trim() || null;
  const list =
    chosen.mode === "mailbox" ? [box] : chosen.mode === "gmail" ? [gmail ?? box] : [gmail, box];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of list) {
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

/** «… sau …» / «… or …»: how two addresses read inside a sentence, per language. */
export const CONTACT_ADDRESS_JOINER = { ro: " sau ", en: " or " } as const;

export function joinContactAddresses(addresses: readonly string[], locale: keyof typeof CONTACT_ADDRESS_JOINER): string {
  return addresses.join(CONTACT_ADDRESS_JOINER[locale]);
}

/** The Reply-To header's value: the addresses comma-separated (RFC 5322 address-list), or nothing. */
export function replyToHeader(addresses: readonly string[]): string | undefined {
  return addresses.length > 0 ? addresses.join(", ") : undefined;
}
