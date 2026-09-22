import type { EmailMessageType } from "@/db/schema/email-outbox";
import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { z } from "zod";

/**
 * Which of the club's own mailboxes hear about a registration (`DECISIONS.md` §244, §245).
 *
 * Two lists, one shape, both edited on `/admin/emails` beside the contact recipients (§164),
 * because they answer the same question in the same words: *who at the club receives this*.
 *
 * - **declarations** — the copy of every signed declaration (§99). It was `DECLARATIONS_ARCHIVE_TO`,
 *   a single address in the environment, which meant the club could not add a second reader
 *   without a developer and a deployment. `to`, `cc` and `bcc` now, set in the backoffice.
 * - **confirmations** — "somebody has confirmed", the new notice (§245). One list: this is a
 *   heads-up, not a document, and a message with three kinds of recipient invites the mistake
 *   below.
 * - **participants** — a hidden copy of every message a *real* participant receives
 *   (2026-09-22; the owner: "să putem seta și unde mai merg în BCC mailurile de înregistrare").
 *   One Bcc list. It is copied into each outbox row's payload the moment the message is queued
 *   (`enqueueEmail`), exactly as §244 does for the declaration's copies, so a list edited
 *   tomorrow changes tomorrow's copies and not the ones already queued; the sender puts them on
 *   the envelope, and outside production each faces the allowlist on its own. Never for a test
 *   registration (§12.6), and never for a message that has no registration behind it, because
 *   without one the platform cannot tell a real runner from a synthetic one.
 *
 * ## Why `bcc` is spelled out and warned about in the interface
 *
 * The declaration carries the participant's identity document, their name and the event they
 * signed for. A `cc` is visible to everybody on the message — the participant does not receive
 * this copy, but everybody who does can see who else did. A `bcc` is not: it hands the same
 * personal data to a mailbox that nobody on the message can see, which is exactly the property
 * that makes it useful for an archive and exactly the property that makes it a way to leak
 * quietly. The platform allows it and says so on the screen that sets it; the club decides.
 *
 * Pure: no database, no environment. The environment's old single address is still read as a
 * fallback by `resolveDeclarationCopies`, so a deployment that has not been touched keeps
 * behaving exactly as it did — the same reading order §164 gave `CONTACT_FORM_TO`.
 */

/** One address, by the same canonicalizer the whole platform uses (`AGENTS.md` §10.4). */
const address = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine((value) => isValidEmail(value), { message: "not a valid email address" });

/** A club's mailbox list, not a mailing list — the same ceiling §164 chose, for the same reason. */
export const CLUB_NOTICE_RECIPIENTS_MAX = 10;

const list = z.array(address).max(CLUB_NOTICE_RECIPIENTS_MAX).default([]);

/**
 * The same mailbox twice is one mailbox.
 *
 * The identical rule to §164's, and for the identical reason: an address typed in two boxes
 * becomes two envelope recipients, two copies of a declaration, and two messages against the
 * Mailgun allowance. Compared by spelling, case-insensitively — `a.b@gmail.com` and
 * `ab@gmail.com` are two addresses by §74, and a club that typed both meant both.
 */
function withoutRepeats(addresses: readonly string[], seen: Set<string>): string[] {
  const kept: string[] = [];
  for (const entry of addresses) {
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  return kept;
}

/**
 * The declaration's own mailbox is **one** address, as `DECLARATIONS_ARCHIVE_TO` was.
 *
 * A message has one "to" and any number of copies, and that is the shape the club asked for:
 * the archive mailbox, plus whoever else should get a copy. An empty string is "not set" —
 * what a cleared box posts — and reads as no archive at all.
 */
const singleAddress = z.union([address, z.literal("")]).default("");

export const clubNoticesSchema = z
  .object({
    declarations: z
      .object({ to: singleAddress, cc: list, bcc: list })
      .strict()
      .default({ to: "", cc: [], bcc: [] }),
    confirmations: z.object({ to: list }).strict().default({ to: [] }),
    // Absent on a row saved before the list existed (2026-09-22), and read as empty then.
    participants: z.object({ bcc: list }).strict().default({ bcc: [] }),
  })
  .strict()
  // Stored the way it will be sent, so the boxes show the club what it actually did.
  .transform((value) => {
    const declarations = new Set<string>(value.declarations.to ? [value.declarations.to.toLowerCase()] : []);
    const confirmations = new Set<string>();
    const participants = new Set<string>();
    return {
      declarations: {
        to: value.declarations.to,
        cc: withoutRepeats(value.declarations.cc, declarations),
        bcc: withoutRepeats(value.declarations.bcc, declarations),
      },
      // A separate message to separate people: an address may be on both lists, and often is.
      confirmations: { to: withoutRepeats(value.confirmations.to, confirmations) },
      // Its own set again: a hidden copy of the participant's confirmation and a copy of the
      // signed declaration are two messages, and a mailbox may well want both.
      participants: { bcc: withoutRepeats(value.participants.bcc, participants) },
    };
  });

export type ClubNotices = z.infer<typeof clubNoticesSchema>;

export const DEFAULT_CLUB_NOTICES: ClubNotices = {
  declarations: { to: "", cc: [], bcc: [] },
  confirmations: { to: [] },
  participants: { bcc: [] },
};

/** Where the declaration copy's "to" came from, for the sentence the task board prints. */
export type ClubNoticeSource = "setting" | "environment" | "none";

export type DeclarationCopies = {
  /** The mailbox the copy is addressed to, or `null` when the club has named none. */
  to: string | null;
  cc: readonly string[];
  bcc: readonly string[];
  source: ClubNoticeSource;
};

/**
 * The reading order, so no deployment loses its archive: the setting when it names at least one
 * "to", otherwise `DECLARATIONS_ARCHIVE_TO`, otherwise nobody and no copy is queued — which is
 * exactly what §99 did before the setting existed.
 *
 * `cc` and `bcc` are the setting's whichever way the "to" resolved, and are resolved *against*
 * it: a mailbox that is already receiving the copy is not sent a second one.
 */
export function resolveDeclarationCopies(
  setting: ClubNotices | null,
  environmentTo: string | undefined,
): DeclarationCopies {
  const stored = setting?.declarations ?? DEFAULT_CLUB_NOTICES.declarations;
  const resolve = (to: string | null, source: ClubNoticeSource): DeclarationCopies => {
    const seen = new Set<string>(to ? [to.toLowerCase()] : []);
    return { to, cc: withoutRepeats(stored.cc, seen), bcc: withoutRepeats(stored.bcc, seen), source };
  };
  if (stored.to !== "") return resolve(stored.to, "setting");
  if (environmentTo) return resolve(environmentTo, "environment");
  /*
    Nobody named. The copies are not sent to the `cc` list on its own: a message needs an
    address it is *for*, and quietly promoting a copy to the recipient would send a
    participant's declaration somewhere the club did not choose to send it.
  */
  return resolve(null, "none");
}

/**
 * Whether a signed declaration reaches the club at all — the question `/devs`, `/admin/tasks`
 * and the volume forecast each used to ask of `DECLARATIONS_ARCHIVE_TO` alone, and which has
 * had two possible answers since the club can name the mailbox itself (§244).
 */
export function declarationArchiveIsConfigured(
  setting: ClubNotices | null,
  environmentTo: string | undefined,
): boolean {
  return resolveDeclarationCopies(setting, environmentTo).to !== null;
}

/** Who is told that somebody confirmed (§245). No environment fallback: this never had one. */
export function confirmationNoticeRecipients(setting: ClubNotices | null): readonly string[] {
  return setting?.confirmations.to ?? [];
}

/** Who receives a hidden copy of every message to a real participant. No environment fallback either. */
export function participantMessageBcc(setting: ClubNotices | null): readonly string[] {
  return setting?.participants.bcc ?? [];
}

/**
 * The messages a participant receives, from §16.3's list — the ones the club's hidden copy
 * rides on. Spelled out as the exclusions rather than the inclusions, so a message type added
 * tomorrow *for a participant* is copied without anybody remembering this set, and one added
 * for the club or the staff has to be named here to stay out:
 *
 * - `DECLARATION_ARCHIVE` and `CLUB_CONFIRMATION_NOTICE` are the club's own (§244, §245) — a
 *   hidden copy of a copy would spend the allowance twice on the same mailbox;
 * - `STAFF_INVITATION` goes to a colleague, not a participant (§141);
 * - `REGISTRATION_OPENED` goes to an address left on an event page before the window (§146):
 *   there is no registration behind it, so nothing says whether the person is real, and the
 *   owner asked for the *registration* emails.
 */
const NOT_A_PARTICIPANT_MESSAGE: ReadonlySet<EmailMessageType> = new Set<EmailMessageType>([
  "DECLARATION_ARCHIVE",
  "CLUB_CONFIRMATION_NOTICE",
  "STAFF_INVITATION",
  "REGISTRATION_OPENED",
]);

export function isParticipantMessage(messageType: EmailMessageType): boolean {
  return !NOT_A_PARTICIPANT_MESSAGE.has(messageType);
}

/**
 * The hidden copies one participant message carries, merged into what the row already asked
 * for: the club's list, minus the participant's own address and minus anything already there,
 * compared by spelling without regard to case (§74's rule, as everywhere in this file). The
 * participant is never Bcc'd on their own message — an address in "to" is not also a copy.
 */
export function withParticipantBcc(
  payload: Record<string, unknown>,
  recipientEmail: string,
  bcc: readonly string[],
): Record<string, unknown> {
  if (bcc.length === 0) return payload;
  const already = Array.isArray(payload.bcc)
    ? payload.bcc.filter((entry): entry is string => typeof entry === "string")
    : [];
  const seen = new Set<string>([recipientEmail.toLowerCase(), ...already.map((entry) => entry.toLowerCase())]);
  const merged = [...already, ...withoutRepeats(bcc, seen)];
  return merged.length === 0 ? payload : { ...payload, bcc: merged };
}
