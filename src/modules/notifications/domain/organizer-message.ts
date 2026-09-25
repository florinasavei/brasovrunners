import type { RegistrationStatus } from "@/db/schema/registrations";
import { type BilingualText, isWrittenText, type TextLanguage } from "@/shared/forms/both-languages";
import { type EmailCopyPlaceholder, placeholdersIn } from "./email-copy";

/**
 * "Trimite un mesaj participanților" (`DECISIONS.md` §364; the owner, 2026-09-24: "I also want
 * to be able to send custom emails to people, in case something happens, e.g. bad weather,
 * cancelled event, etc!") — the rules of the message itself, pure: who it can go to, what it may
 * say, and how its words are read back out of the outbox.
 *
 * The closest existing thing is the organizer's update notice and the cancellation (§331), and
 * this follows them wherever they already decided something: the same four statuses are "active",
 * the same test rows are written to and counted nowhere, the words are typed in both languages
 * and read in the registrant's (§354). What is new is that the organizer chooses *which* of the
 * active registrations hear it, and writes the whole message rather than a note under the
 * platform's sentences.
 */

/**
 * Who hears it, as the composer offers it: everybody active, or one of its three parts.
 *
 * Never a cancelled or lapsed registration (§9: "never sent to cancelled or expired
 * registrations"), and never `PENDING_EMAIL_CONFIRMATION` — an address nobody has vouched for
 * gets the confirmation and nothing else, the reason §331 gives for its own notices.
 */
export const PARTICIPANT_MESSAGE_AUDIENCES = ["ALL_ACTIVE", "CONFIRMED", "WAITLIST", "PENDING_DECLARATION"] as const;
export type ParticipantMessageAudience = (typeof PARTICIPANT_MESSAGE_AUDIENCES)[number];

/**
 * The statuses behind each choice. `ALL_ACTIVE` is exactly the §331 notices' set
 * (`EVENT_NOTICE_STATUSES`, held to this by a test), and the three parts partition it: the
 * confirmed; the waiting list, an open offer included — somebody offered a place is still
 * somebody waiting until they sign; and the registered who owe the declaration.
 */
export const AUDIENCE_STATUSES: Readonly<Record<ParticipantMessageAudience, readonly RegistrationStatus[]>> = {
  ALL_ACTIVE: ["PENDING_DECLARATION", "WAITLIST_OFFERED", "CONFIRMED", "WAITLISTED"],
  CONFIRMED: ["CONFIRMED"],
  WAITLIST: ["WAITLISTED", "WAITLIST_OFFERED"],
  PENDING_DECLARATION: ["PENDING_DECLARATION"],
};

export function isParticipantMessageAudience(value: unknown): value is ParticipantMessageAudience {
  return typeof value === "string" && (PARTICIPANT_MESSAGE_AUDIENCES as readonly string[]).includes(value);
}

/**
 * The placeholders this message fills, a subset of the closed set the club's own wording uses
 * (§247). Refused at the send, naming itself, is anything else between braces — the same rule
 * §247 applies — and so, deliberately, are the members of that set this message never carries:
 * `{staffRole}`, `{holdExpiresAtFormatted}`, `{signedAtFormatted}` would each print as nothing
 * in every copy, and the desk code (`{checkinCode}`) is something only the participant may hold,
 * which a message written for everybody at once has no business spelling out.
 *
 * `{bibNumber}` is the settled race number, empty for whoever does not have one yet: a
 * provisional number printed without its "provisional" line (§237) would read as final.
 */
export const ORGANIZER_MESSAGE_PLACEHOLDERS = [
  "participantName",
  "eventTitle",
  "eventStartsAtFormatted",
  "eventLocationName",
  "bibNumber",
  "eventChecklist",
] as const satisfies readonly EmailCopyPlaceholder[];

/**
 * Per language, as typed — the composer's help says "each". The subject a runner receives joins the
 * two with " / " (§96) after the placeholders are filled, so it can run past twice this: a long
 * subject is cut short by the mail client, never refused by the provider, and the stored §247
 * wording of every other message allows 200 a language. Keeping each box to 150 keeps the
 * registrant's own language, which comes first, whole on the screens that cut.
 */
export const ORGANIZER_SUBJECT_MAX = 150;
/** A message, not a newsletter: the facts of a morning, with room to explain. */
export const ORGANIZER_BODY_MAX = 4000;

/** The four boxes, as the form posts them. */
export type OrganizerMessageBox = "subjectRo" | "subjectEn" | "bodyRo" | "bodyEn";

const BOX: Record<"subject" | "body", Record<TextLanguage, OrganizerMessageBox>> = {
  subject: { ro: "subjectRo", en: "subjectEn" },
  body: { ro: "bodyRo", en: "bodyEn" },
};

export type OrganizerMessage = { subject: BilingualText; body: BilingualText };

export type OrganizerMessageIssue =
  | { box: OrganizerMessageBox; problem: "empty" | "tooLong" }
  | { box: OrganizerMessageBox; problem: "unknownPlaceholder"; names: string[] };

/**
 * One line, as a subject is: every line break a space, the edges trimmed. A subject typed with
 * Enter in it would otherwise be a header a mail client folds or refuses.
 */
function subjectLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** The body as typed, with the platform's line ending (`\n`) and no whitespace at its two ends. */
function bodyText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

/** The `{names}` this message cannot fill, in the order they were written, once each. */
export function unknownOrganizerPlaceholders(text: string): string[] {
  const known = new Set<string>(ORGANIZER_MESSAGE_PLACEHOLDERS);
  return [...new Set(placeholdersIn(text).filter((name) => !known.has(name)))];
}

/**
 * The message as the form posted it, checked: both languages of both texts written (bilingual
 * always — every registrant is written to in the language they registered in, so the words have
 * to exist in it), each within its ceiling, and no placeholder this message cannot fill.
 *
 * Every problem is returned, one per box, so the refusal names every box to fix at once (§47)
 * and the rest of the form comes back as typed (§315). `message` is the normalized text when
 * there is no problem, and `null` otherwise.
 */
export function checkOrganizerMessage(input: {
  subject: Readonly<Partial<Record<TextLanguage, string | null>>>;
  body: Readonly<Partial<Record<TextLanguage, string | null>>>;
}): { message: OrganizerMessage | null; issues: OrganizerMessageIssue[] } {
  const subject = { ro: subjectLine(input.subject.ro ?? ""), en: subjectLine(input.subject.en ?? "") };
  const body = { ro: bodyText(input.body.ro ?? ""), en: bodyText(input.body.en ?? "") };
  const issues: OrganizerMessageIssue[] = [];
  const check = (part: "subject" | "body", value: string, language: TextLanguage, max: number) => {
    const box = BOX[part][language];
    if (!isWrittenText(value)) return issues.push({ box, problem: "empty" });
    if (value.length > max) return issues.push({ box, problem: "tooLong" });
    const names = unknownOrganizerPlaceholders(value);
    if (names.length > 0) issues.push({ box, problem: "unknownPlaceholder", names });
  };
  for (const language of ["ro", "en"] as const) check("subject", subject[language], language, ORGANIZER_SUBJECT_MAX);
  for (const language of ["ro", "en"] as const) check("body", body[language], language, ORGANIZER_BODY_MAX);
  return { message: issues.length === 0 ? { subject, body } : null, issues };
}

/**
 * The body as paragraphs of lines: a blank line starts a paragraph, a single line break stays a
 * line break inside it — what somebody typing in a plain box means by each. Empty paragraphs
 * (three Enters in a row) are dropped rather than sent as empty `<p>`s that some clients collapse
 * and others do not.
 */
export function organizerParagraphs(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    )
    .filter((lines) => lines.length > 0);
}

/**
 * The words out of an outbox row's payload, `{ subject: { ro, en }, body: { ro, en } }`, or
 * `null` when the row does not carry a readable pair of both — only a hand-made row can. Total:
 * the renderer must send *something* for any row, and falls back to the platform's own subject
 * and framing sentence, without an organizer body, rather than throwing.
 */
export function readOrganizerMessagePayload(payload: unknown): OrganizerMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const { subject, body } = payload as { subject?: unknown; body?: unknown };
  const pair = (value: unknown): BilingualText | null => {
    if (!value || typeof value !== "object") return null;
    const { ro, en } = value as { ro?: unknown; en?: unknown };
    return typeof ro === "string" && typeof en === "string" && isWrittenText(ro) && isWrittenText(en) ? { ro, en } : null;
  };
  const subjects = pair(subject);
  const bodies = pair(body);
  return subjects && bodies ? { subject: subjects, body: bodies } : null;
}

/**
 * What one send costs against the Mailgun allowance (§100), in messages: every recipient's own —
 * a test row's `@test.invalid` address still spends a message — plus **one** club copy per address
 * on the club's list for the whole send (§419; one per registration under §320), and none when the
 * send reaches no real participant.
 */
export function organizerMessageCost(recipients: { real: number; test: number }, clubCopyAddresses: number): number {
  const copies = recipients.real > 0 ? Math.max(0, Math.floor(clubCopyAddresses)) : 0;
  return recipients.real + recipients.test + copies;
}

/**
 * How many of those messages can leave now and how many wait for the allowance to come back
 * (§40: a spent allowance defers a message, it never discards one). `headroom` is what the plan
 * has left over its period minus what is already queued ahead of this send; `null` is a plan
 * with no ceiling.
 */
export function organizerMessageDeferral(messages: number, headroom: number | null): { now: number; deferred: number } {
  if (headroom === null) return { now: messages, deferred: 0 };
  const now = Math.max(0, Math.min(messages, headroom));
  return { now, deferred: messages - now };
}
