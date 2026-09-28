import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { z } from "zod";

/**
 * «Adresa de contact afișată» (§442, §443 as amended): the address shown and used as every
 * email's Reply-To. `mailbox` is `EMAIL_REPLY_TO`; `gmail` is the configured `CONTACT_SMTP_USER`,
 * never typed; `both` is Gmail then mailbox. With no row: the Gmail if configured, else the
 * mailbox. The sender never follows it: a Gmail `From` through Mailgun fails DMARC alignment.
 */

export const CONTACT_ADDRESS_MODES = ["mailbox", "gmail", "both"] as const;
export type ContactAddressMode = (typeof CONTACT_ADDRESS_MODES)[number];

export type ShownContactAddress = { mode: ContactAddressMode; gmail: string | null };

export const DEFAULT_SHOWN_CONTACT_ADDRESS: ShownContactAddress = { mode: "mailbox", gmail: null };

/** The choice in force before the club saves one (§442 as amended). */
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

export function configuredGmailAddress(configuredGmail: string | null | undefined): string | null {
  const gmail = configuredGmail?.trim() || null;
  return gmail && isValidEmail(gmail) ? gmail : null;
}

/** The configured Gmail; an older row's typed address counts only where none is configured. */
export function effectiveGmail(stored: string | null | undefined, configuredGmail: string | null | undefined): string | null {
  return configuredGmailAddress(configuredGmail) ?? (stored?.trim() || null);
}

/**
 * The addresses in force, in order. A mode whose address is missing falls back to what exists;
 * repeats are dropped case-insensitively.
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

export const CONTACT_ADDRESS_JOINER = { ro: " sau ", en: " or " } as const;

export function joinContactAddresses(addresses: readonly string[], locale: keyof typeof CONTACT_ADDRESS_JOINER): string {
  return addresses.join(CONTACT_ADDRESS_JOINER[locale]);
}

/** RFC 5322 address-list. */
export function replyToHeader(addresses: readonly string[]): string | undefined {
  return addresses.length > 0 ? addresses.join(", ") : undefined;
}
