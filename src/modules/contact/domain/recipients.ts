import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { z } from "zod";

/**
 * Who reads what the contact form sends (`DECISIONS.md` §164; the owner: "I wanna allow CC on
 * the contact form so that Amalia can receive emails… I need these CC's to be configurable in
 * the app").
 *
 * Pure: no database, no environment. The club edits these on `/admin/emails`, they are stored
 * under `platform_settings.contactRecipients`, and they are shown back on the screen that sets
 * them — which is exactly why an address may live in that table and the Gmail app password may
 * not (`db/schema/platform-settings.ts`, AGENTS.md §14.5).
 *
 * The environment keeps `CONTACT_FORM_TO` as a fallback, so a deployment whose database has no
 * row yet still reaches somebody: the setting wins when it names at least one "to", the
 * environment answers when it does not, and with neither the form is off, as before. The Cc
 * list is app-only — there is no environment variable for it, and there will not be one: a
 * copy for a colleague is a club decision, not a deployment's.
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
 * The same mailbox twice is one mailbox (§164).
 *
 * Nodemailer builds the envelope from `to` and `cc` together, so an address typed in both
 * boxes — the obvious thing to do with the club's own Gmail — becomes two `RCPT TO` commands
 * and a message that names the same person in both headers. Compared case-insensitively and
 * not through the canonicalizer: `a.b@gmail.com` and `ab@gmail.com` are two addresses by
 * §74, and a club that typed both meant both; only the *spelling* is deduplicated, and the
 * first spelling is the one kept, because that is the one the club typed first.
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
  })
  .strict()
  // Stored the way it will be sent, so the boxes show the club what it actually did.
  .transform((value) => {
    const seen = new Set<string>();
    return { to: withoutRepeats(value.to, seen), cc: withoutRepeats(value.cc, seen) };
  });

export type ContactRecipients = z.infer<typeof contactRecipientsSchema>;

export const DEFAULT_CONTACT_RECIPIENTS: ContactRecipients = { to: [], cc: [] };

/**
 * A typed line — "club@…, amalia@…" — as a list. Commas and semicolons both, because both are
 * what people type, and the empty entries a trailing separator leaves are dropped rather than
 * rejected: `env.ts`'s `allowlist` reads the same way, and the two must agree.
 */
export function parseAddressList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** The list as the form shows it back, so a save round-trips to the same text. */
export function formatAddressList(addresses: readonly string[]): string {
  return addresses.join(", ");
}

/** Where the "to" list came from, for the sentence `/devs` and `/admin/tasks` print. */
export type ContactRecipientsSource = "setting" | "environment" | "none";

export type ResolvedContactRecipients = {
  to: readonly string[];
  cc: readonly string[];
  source: ContactRecipientsSource;
};

/**
 * The reading order, so a deployment always works: the setting when it holds at least one
 * "to", otherwise `CONTACT_FORM_TO`, otherwise nobody and the form is off.
 *
 * The Cc list is the setting's whichever way the "to" list resolved — a copy to a colleague
 * must not depend on whether the club has got round to moving the main list into the app.
 * It is resolved *against* the "to" list, and against the environment's too: a colleague who
 * is already a recipient is not copied as well, whichever half named her.
 */
export function resolveContactRecipients(
  setting: ContactRecipients | null,
  environmentTo: readonly string[],
): ResolvedContactRecipients {
  const settingCc = setting?.cc ?? [];
  const resolve = (rawTo: readonly string[], source: ContactRecipientsSource): ResolvedContactRecipients => {
    const seen = new Set<string>();
    const to = withoutRepeats(rawTo, seen);
    return { to, cc: withoutRepeats(settingCc, seen), source };
  };
  if (setting && setting.to.length > 0) return resolve(setting.to, "setting");
  if (environmentTo.length > 0) return resolve(environmentTo, "environment");
  return resolve([], "none");
}
