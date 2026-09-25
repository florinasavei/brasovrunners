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
 * - **participants** — the club's copy of every message a *real* participant receives
 *   (2026-09-22; the owner: "să putem seta și unde mai merg în BCC mailurile de înregistrare").
 *   One list, still labelled "Bcc" on the screen because the participant never sees it. Since
 *   §320 it is **not** a Bcc on the participant's envelope: each address gets a separate outbox
 *   row — the *club copy* — queued beside the participant's own in the same transaction
 *   (`enqueueEmail`), so a list edited tomorrow changes tomorrow's copies and not the ones
 *   already queued (§244's rule). A club copy is rendered with no token minted, no action link,
 *   no QR and no attachment (`render.ts`): the GDPR audit of 2026-09-23 found the Bcc receiving
 *   the runner's live single-use links and the signed declaration with the identity document,
 *   so anybody reading a club mailbox could act for the runner. Never for a test registration
 *   (§12.6), and never for a message that has no registration behind it, because without one
 *   the platform cannot tell a real runner from a synthetic one.
 *
 * ## Why `bcc` is spelled out and warned about in the interface
 *
 * The declaration carries the participant's identity document, their name and the event they
 * signed for. A `cc` is visible to everybody on the message — the participant does not receive
 * this copy, but everybody who does can see who else did. A `bcc` is not: it hands the same
 * personal data to a mailbox that nobody on the message can see, which is exactly the property
 * that makes it useful for an archive and exactly the property that makes it a way to leak
 * quietly. The platform allows it and says so on the screen that sets it; the club decides.
 * Since §320 the club's copy of the declaration carries the identity document masked
 * (`maskIdDocument`), so what a hidden copy hands on is the name, the event and the signature.
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

/** Who receives a club copy of every message to a real participant (§320). No environment fallback either. */
export function participantMessageBcc(setting: ClubNotices | null): readonly string[] {
  return setting?.participants.bcc ?? [];
}

/**
 * The messages a participant receives, from §16.3's list — the ones the club gets a copy of
 * (§320). Spelled out as the exclusions rather than the inclusions, so a message type added
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
  // The group run's archive copy (§393): the club's own, like the race's.
  "GROUP_RUN_DECLARATION_ARCHIVE",
  "CLUB_CONFIRMATION_NOTICE",
  "STAFF_INVITATION",
  "REGISTRATION_OPENED",
]);

export function isParticipantMessage(messageType: EmailMessageType): boolean {
  return !NOT_A_PARTICIPANT_MESSAGE.has(messageType);
}

/**
 * Who receives a club copy of one participant message (§320): the club's list, minus the
 * participant's own address, one spelling each, compared without regard to case (§74's rule, as
 * everywhere in this file). A participant whose address is also on the club's list gets their
 * own message, never also the stripped copy of it.
 *
 * Each address is one outbox row of its own rather than one row with the rest in `bcc`, the
 * shape §245 chose for the confirmation notice and for the same reasons: the addresses were typed
 * into a *hidden*-copy box, so none of them sees the others; one mailbox that bounces does not
 * mark the others' copy failed; and outside production each faces the allowlist as the address
 * the message is *for* (`delivery.ts`), so an authorized mailbox is not captured because the
 * first one on the list was not. One row is also exactly one message on the allowance, which is
 * what the day's counts on `/admin/emails` add up.
 */
export function clubCopyRecipients(recipientEmail: string, bcc: readonly string[]): string[] {
  return withoutRepeats(bcc, new Set<string>([recipientEmail.toLowerCase()]));
}

/**
 * The payload flag that makes an outbox row a club copy. Read by `render.ts`, which then mints
 * no token and attaches nothing, and by the backoffice's timeline, which labels the row.
 */
export const CLUB_COPY_FLAG = "clubCopy";

/** Whether an outbox row's payload is a club copy's. Anything but the literal `true` is not. */
export function isClubCopy(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && (payload as Record<string, unknown>)[CLUB_COPY_FLAG] === true;
}

/**
 * The club copy's payload: what the participant's row asked the template for — "you were already
 * registered", the thank-you's link, a number given by hand — plus the flag. Never a `cc` or a
 * `bcc` of its own, so a copy cannot fan out further than the one address its row is for.
 */
export function clubCopyPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const kept = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "cc" && key !== "bcc"));
  return { ...kept, [CLUB_COPY_FLAG]: true };
}

/**
 * Which signed-declaration PDF a message carries, if any (§95, §99, §320).
 *
 * - `participant` — the whole document, identity document included: the runner's own copy, on
 *   the confirmation and on the declaration's own message.
 * - `club` — the identity document masked (`maskIdDocument`): the archive copy that leaves the
 *   platform for the club's mailboxes, where nobody deletes it after seven days as the database
 *   does (§95).
 * - `null` — no PDF: every other type, and every club copy of a participant's message, which
 *   attaches nothing at all.
 */
export function declarationPdfAudience(messageType: EmailMessageType, clubCopy: boolean): "participant" | "club" | null {
  if (clubCopy) return null;
  if (messageType === "DECLARATION_ARCHIVE" || messageType === "GROUP_RUN_DECLARATION_ARCHIVE") return "club";
  if (messageType === "REGISTRATION_CONFIRMED" || messageType === "DECLARATION_SIGNED" || messageType === "GROUP_RUN_DECLARATION_SIGNED") return "participant";
  return null;
}
