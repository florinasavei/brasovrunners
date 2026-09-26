import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { z } from "zod";

/**
 * «Adresa de contact afișată» — which address readers are shown and reply to (§442; the owner,
 * 2026-09-26: "I want to be able to switch and show the club's Gmail, or show both").
 *
 * Pure: no database, no environment. Three modes:
 *
 * - `mailbox` — the deployment's own mailbox, `EMAIL_REPLY_TO` (the `mail.` subdomain's).
 * - `gmail` — the club's Gmail: the deployment's own `CONTACT_SMTP_USER`, the account the contact
 *   form sends through, read from configuration and shown read-only on `/admin/emails` (§442 and
 *   §443 as amended, 2026-09-26). It is never typed: a row saved before this change may still
 *   carry a typed address, and the configured one wins over it wherever one is configured.
 * - `both` — the Gmail first, then the mailbox.
 *
 * Until the club chooses (no row), the default is the club's Gmail — the account the deployment
 * sends the contact form through, `CONTACT_SMTP_USER` — and the mailbox only where no Gmail is
 * configured (§442 and §443 as amended; the owner, 2026-09-26: "I want the Mailgun reply-to to be the club's Gmail").
 * A reply then reaches the inbox people read, without the forward the `mail.` mailbox needs.
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

/** The default where the deployment has no Gmail of its own: the mailbox, §442's default. */
export const DEFAULT_SHOWN_CONTACT_ADDRESS: ShownContactAddress = { mode: "mailbox", gmail: null };

/**
 * The choice in force before the club saves one (§442 as amended): the configured Gmail (`CONTACT_SMTP_USER`)
 * when there is a valid one, the mailbox otherwise. Saving any mode on `/admin/emails` overrides it.
 */
export function defaultShownContactAddress(configuredGmail: string | null | undefined): ShownContactAddress {
  const gmail = configuredGmailAddress(configuredGmail);
  return gmail ? { mode: "gmail", gmail } : DEFAULT_SHOWN_CONTACT_ADDRESS;
}

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
  .strict();

/** The configured Gmail when it is an address, else nothing. */
export function configuredGmailAddress(configuredGmail: string | null | undefined): string | null {
  const gmail = configuredGmail?.trim() || null;
  return gmail && isValidEmail(gmail) ? gmail : null;
}

/**
 * The Gmail a `gmail` or `both` choice shows: the configured one; a typed address kept in a row
 * saved before the Gmail came from configuration counts only where none is configured.
 */
export function effectiveGmail(stored: string | null | undefined, configuredGmail: string | null | undefined): string | null {
  return configuredGmailAddress(configuredGmail) ?? (stored?.trim() || null);
}

/**
 * The addresses in force, in order: what a page shows and what the Reply-To header carries.
 *
 * `mailbox` is `EMAIL_REPLY_TO`. A mode whose address is missing falls back to what exists —
 * a `both` on a deployment without the mailbox is the Gmail alone, a `mailbox` without the
 * variable is nothing (as before). Repeats are dropped by spelling, case-insensitively. No setting
 * (`null`) is the default of `defaultShownContactAddress(configuredGmail)`. The Gmail shown is
 * `effectiveGmail`: the configured one first.
 */
export function resolveShownContactAddresses(
  setting: ShownContactAddress | null,
  mailbox: string | null | undefined,
  configuredGmail?: string | null,
): string[] {
  const chosen = setting ?? defaultShownContactAddress(configuredGmail);
  const box = mailbox?.trim() || null;
  const gmail = effectiveGmail(chosen.gmail, configuredGmail);
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
