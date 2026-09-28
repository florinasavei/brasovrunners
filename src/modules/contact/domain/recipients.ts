import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { z } from "zod";

/**
 * Who receives the contact form's messages (§164). Stored in `platform_settings` and shown back,
 * so it may hold addresses but never the Gmail password (AGENTS.md §14.5). `CONTACT_FORM_TO` is
 * the fallback "to"; Cc and Bcc are app-only. Bcc is for an unseen archive mailbox.
 */

/** One address, trimmed, validated by the same canonicalizer the whole platform uses (§10.4). */
const address = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine((value) => isValidEmail(value), { message: "not a valid email address" });

/** A generous ceiling: a club mailbox list, not a mailing list. */
export const CONTACT_RECIPIENTS_MAX = 10;

/**
 * The same mailbox twice is one mailbox (§164): otherwise Nodemailer sends it twice. Compared
 * case-insensitively, not canonically — Gmail dots are two addresses (§74). First spelling kept.
 */
function withoutRepeats(addresses: readonly string[], alreadySeen?: Set<string>): string[] {
  const seen = alreadySeen ?? new Set<string>();
  const kept: string[] = [];
  for (const entry of addresses) {
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  return kept;
}

export const contactRecipientsSchema = z
  .object({
    to: z.array(address).max(CONTACT_RECIPIENTS_MAX).default([]),
    cc: z.array(address).max(CONTACT_RECIPIENTS_MAX).default([]),
    // Absent on rows saved before the list existed.
    bcc: z.array(address).max(CONTACT_RECIPIENTS_MAX).default([]),
  })
  .strict()
  // Stored as sent; one `seen` set across the lists, so an address in "to" is not also copied.
  .transform((value) => {
    const seen = new Set<string>();
    return {
      to: withoutRepeats(value.to, seen),
      cc: withoutRepeats(value.cc, seen),
      bcc: withoutRepeats(value.bcc, seen),
    };
  });

export type ContactRecipients = z.infer<typeof contactRecipientsSchema>;

export const DEFAULT_CONTACT_RECIPIENTS: ContactRecipients = { to: [], cc: [], bcc: [] };

/**
 * Commas, semicolons and whitespace all separate (an address never holds whitespace; §457);
 * empty entries are dropped.
 */
export function parseAddressList(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** Entries the list schemas refuse, each once, in typed order, so a refusal can name them; the same test as `address` (§457). */
export function invalidAddresses(entries: readonly string[]): string[] {
  const invalid: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed === "" || (trimmed.length <= 320 && isValidEmail(trimmed))) continue;
    if (!invalid.includes(trimmed)) invalid.push(trimmed);
  }
  return invalid;
}

/**
 * Why address boxes were refused (§457), as `Admin.errors` keys and their values; `null` when the
 * refusal was something else.
 */
export function addressListRefusal(
  lists: readonly (readonly string[])[],
  max: number,
): { error: "INVALID_ADDRESSES"; errorValues: { addresses: string } } | { error: "TOO_MANY_ADDRESSES"; errorValues: { max: string } } | null {
  const invalid = invalidAddresses(lists.flat());
  if (invalid.length > 0) return { error: "INVALID_ADDRESSES", errorValues: { addresses: invalid.join(", ") } };
  if (lists.some((list) => list.length > max)) return { error: "TOO_MANY_ADDRESSES", errorValues: { max: String(max) } };
  return null;
}

export function formatAddressList(addresses: readonly string[]): string {
  return addresses.join(", ");
}

/** Where the "to" list came from, for the sentence `/devs` and `/admin/tasks` print. */
export type ContactRecipientsSource = "setting" | "environment" | "none";

export type ResolvedContactRecipients = {
  to: readonly string[];
  cc: readonly string[];
  /** The hidden copies: envelope recipients, named in no header the others read. */
  bcc: readonly string[];
  source: ContactRecipientsSource;
};

/**
 * "to" is the setting's when it has one, else `CONTACT_FORM_TO`, else none (the form is off). Cc
 * and Bcc always come from the setting, deduplicated against the resolved "to" and each other.
 */
export function resolveContactRecipients(
  setting: ContactRecipients | null,
  environmentTo: readonly string[],
): ResolvedContactRecipients {
  const settingCc = setting?.cc ?? [];
  const settingBcc = setting?.bcc ?? [];
  const resolve = (rawTo: readonly string[], source: ContactRecipientsSource): ResolvedContactRecipients => {
    const seen = new Set<string>();
    const to = withoutRepeats(rawTo, seen);
    const cc = withoutRepeats(settingCc, seen);
    return { to, cc, bcc: withoutRepeats(settingBcc, seen), source };
  };
  if (setting && setting.to.length > 0) return resolve(setting.to, "setting");
  if (environmentTo.length > 0) return resolve(environmentTo, "environment");
  return resolve([], "none");
}
