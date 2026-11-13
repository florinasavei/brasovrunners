import type { RegistrationStatus } from "@/db/schema/registrations";
import { type BilingualText, isWrittenText, type TextLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";
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
 * «Doar anumiți participanți, pe care îi aleg din listă» (§945; the owner, 2026-11-13: «As vrea sa fac un test pentru
 * mailul asta, sa selectez doar anumiti participanti») — the fifth choice of «Cui îi trimiți», and not a group: the
 * registrations the organizer ticked on the composer, for a trial of a message before everybody gets it, or a word to a few.
 *
 * It widens nothing. Only the ticked that are of this event and in a state `ALL_ACTIVE` holds when the send queues them
 * are written to — never a cancelled, lapsed or unconfirmed-address registration, ticked or not — so the four groups
 * above stay the partition they were, and this stands beside them.
 */
export const CHOSEN_AUDIENCE = "CHOSEN";

/** What «Cui îi trimiți» posts: one of the four groups, or the people ticked. */
export type MessageReach = ParticipantMessageAudience | typeof CHOSEN_AUDIENCE;

export function isMessageReach(value: unknown): value is MessageReach {
  return value === CHOSEN_AUDIENCE || isParticipantMessageAudience(value);
}

/** The field the ticks post under, one value per registration ticked. */
export const CHOSEN_FIELD = "registrationIds";

/**
 * «Scrie la câți trimiți» (§945; the owner, 2026-11-13, of the same message: «si vreau extra extra confirmare»): the
 * field the organizer types the number of recipients into, beside «Trimite mesajul» — the confirmation every send from
 * this page insists on, as the bulk erase insists on its own (§287: «dar cu super extra confirmare!»). A number the
 * screen has just shown, which changes with the choice and the ticks, so it cannot become the habit a second «yes» does.
 * The name is the bulk erase's, so the form never hands it back after a refusal (`NEVER_KEPT`): it is typed again.
 */
export const CONFIRM_COUNT_FIELD = "confirmCount";

/**
 * Whether the number typed is exactly the number of real registrations the send is about to write to — test
 * registrations left out, as from every number the club reads (§12.6). Trimmed, because a typed number arrives with
 * whatever the keyboard added; otherwise exact: nothing typed, another number, «0184» or a word is no.
 */
export function typedCountMatches(typed: unknown, real: number): boolean {
  return typeof typed === "string" && typed.trim() === String(real);
}

/** The ticks as posted, read as registration ids: each a uuid, once. Anything else names nobody. */
export function chosenRegistrationIds(values: readonly unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && isUuid(value)).map((value) => value.toLowerCase()))];
}

/**
 * The placeholders this message fills, a subset of the closed set the club's own wording uses
 * (§247). Refused at the send, naming itself, is anything else between braces — the same rule
 * §247 applies — and so, deliberately, are the members of that set this message never carries:
 * `{staffRole}`, `{holdExpiresAtFormatted}`, `{signedAtFormatted}` would each print as nothing
 * in every copy, and the desk code (`{checkinCode}`) is something only the participant may hold,
 * which a message written for everybody at once has no business spelling out. It stays refused in
 * the words since §943 too: «Trimite și numărul de concurs și codul QR» puts each confirmed runner's
 * own code under the words (`organizerQrApplies`), never in them — the club's one copy repeats the words.
 *
 * `{bibNumber}` is the race number of a confirmed registration, empty for whoever is not
 * confirmed yet: a number exists only from the confirmation (§548).
 */
export const ORGANIZER_SUBJECT_PLACEHOLDERS = [
  "participantName",
  "eventTitle",
  "eventStartsAtFormatted",
  "eventLocationName",
  "bibNumber",
  "eventChecklist",
] as const satisfies readonly EmailCopyPlaceholder[];

/**
 * The body's set: the subject's, and `{feedbackLink}` — «Spune-ne cum a fost» for this event while
 * that form is open, the contact page otherwise (§676). A whole address belongs in the body alone: in
 * the subject it is refused like any field this message cannot fill there, and the composer's help
 * introduces it in its own sentence under the body, never in the subject's list.
 */
export const ORGANIZER_MESSAGE_PLACEHOLDERS = [...ORGANIZER_SUBJECT_PLACEHOLDERS, "feedbackLink"] as const satisfies readonly EmailCopyPlaceholder[];

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

/** The `{names}` this message cannot fill in that part, in the order they were written, once each. */
export function unknownOrganizerPlaceholders(text: string, part: "subject" | "body" = "body"): string[] {
  const known = new Set<string>(part === "subject" ? ORGANIZER_SUBJECT_PLACEHOLDERS : ORGANIZER_MESSAGE_PLACEHOLDERS);
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
    const names = unknownOrganizerPlaceholders(value, part);
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
 * Whether this row asks «Cere reconfirmarea» (the decision «Cere reconfirmarea»): the payload's `askReconfirm`, beside
 * the words — set by the send only on the rows whose registration it wrote an ask for, never send-wide; anything but
 * `true` — an unasked row, an older one, a hand-made one, a club copy — is no.
 */
export function readOrganizerAskReconfirm(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && (payload as { askReconfirm?: unknown }).askReconfirm === true);
}

/**
 * Whether this row carries «Trimite și numărul de concurs și codul QR» (§943): the payload's `sendQr`, beside the words —
 * set by the send only on the rows whose registration was confirmed when it was queued, never send-wide; anything but
 * `true` — a row of somebody not confirmed, an older one, a hand-made one, the club's copy — is no. A flag, never a code:
 * the code is read off the registration when the email leaves.
 */
export function readOrganizerSendQr(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && (payload as { sendQr?: unknown }).sendQr === true);
}

/**
 * The one state whose email gets the race number, the QR and the desk code (§943): a number and a code exist only from
 * the confirmation (§548, BR-REQ-037-08). The send asks it when it queues a row, the renderer again when the row leaves.
 */
export function isOrganizerQrStatus(status: RegistrationStatus): boolean {
  return status === "CONFIRMED";
}

/**
 * Whether the organizers' message draws the runner's own race number, QR and desk code under its words (§943): the row
 * carries the flag, it goes to the registration's own address, and the registration is confirmed **when it renders** —
 * a send drains over hours, and a runner who cancelled since reads the message without them. Never on a club copy
 * (§320): a club mailbox holds nobody's code.
 */
export function organizerQrApplies(params: {
  sendQr: boolean;
  clubCopy: boolean;
  /** The outbox row's participant: the address the message goes to. */
  recipientParticipantId: string | null;
  registration: { participantId: string; status: RegistrationStatus } | null | undefined;
}): boolean {
  const { sendQr, clubCopy, recipientParticipantId, registration } = params;
  if (!sendQr || clubCopy) return false;
  if (!registration || !recipientParticipantId || registration.participantId !== recipientParticipantId) return false;
  return isOrganizerQrStatus(registration.status);
}

/**
 * What the line before «Trimite» says about a send (the decision «Cere reconfirmarea», part two), worked out on the
 * server for the road the send's messages take, with no reserve: the outbox claims a send to many after every
 * registration's own message on its road (`domain/bulk.ts#SEND_TO_MANY_MESSAGE_TYPES`) and holds none of it back.
 *
 * - **Mailgun, no daily ceiling** (a monthly plan, or none): every message can go now, or this month's part of it;
 *   `hours` at the queue's pace for those, behind what waits ahead.
 * - **Mailgun, a daily ceiling** (Free): what can go today is what the day's allowance has left less what waits ahead
 *   of the send; `hours` for today's part only, the rest at most the allowance a day over `restDays` more days, and
 *   `daysUsed` the days the send takes the day's allowance — the registrations' own emails share it meanwhile.
 * - **Gmail**: its own room in the rolling day less what waits ahead on its road, at its own pace a pass.
 *
 * `hours` is at least one when anything leaves now, zero when nothing can; it promises no start: when the first leaves
 * is «Când pleacă emailurile»'s. `ahead` is every row waiting on the same road but the bulk kind, which goes after it.
 */
export type OrganizerSendOutlook =
  | { road: "mailgun"; period: "none"; messages: number; now: number; deferred: 0; hours: number }
  | { road: "mailgun"; period: "month"; messages: number; now: number; deferred: number; hours: number }
  | { road: "mailgun"; period: "day"; messages: number; now: number; deferred: number; hours: number; restDays: number; perDay: number; daysUsed: number }
  | { road: "gmail"; messages: number; now: number; waiting: number; hours: number; perPass: number };

export function organizerSendOutlook(
  input: {
    messages: number;
    ahead: number;
    batchSize: number;
    minutesPerRun: number;
  } & (
    | { road: "mailgun"; period: "day" | "month" | "none"; allowance: number | null; remaining: number | null; hourlyAllowance: number | null }
    | { road: "gmail"; gmailRoom: number; gmailPerPass: number }
  ),
): OrganizerSendOutlook {
  const messages = Math.max(0, input.messages);
  const ahead = Math.max(0, input.ahead);
  const minutes = Math.max(1, input.minutesPerRun);
  const hoursFor = (count: number, perHour: number) => (count <= 0 ? 0 : Math.max(1, Math.ceil((ahead + count) / Math.max(1, perHour))));
  if (input.road === "gmail") {
    const perPass = Math.max(1, input.gmailPerPass);
    const now = Math.min(messages, Math.max(0, input.gmailRoom - ahead));
    return { road: "gmail", messages, now, waiting: messages - now, hours: hoursFor(now, (perPass * 60) / minutes), perPass };
  }
  const byRuns = (Math.max(1, input.batchSize) * 60) / minutes;
  const perHour = input.hourlyAllowance === null ? byRuns : Math.min(byRuns, Math.max(1, input.hourlyAllowance));
  if (input.period === "none" || input.allowance === null || input.remaining === null) {
    return { road: "mailgun", period: "none", messages, now: messages, deferred: 0, hours: hoursFor(messages, perHour) };
  }
  const now = Math.min(messages, Math.max(0, input.remaining - ahead));
  const deferred = messages - now;
  const hours = hoursFor(now, perHour);
  if (input.period === "month") return { road: "mailgun", period: "month", messages, now, deferred, hours };
  const perDay = Math.max(1, Math.floor(input.allowance));
  const restDays = deferred > 0 ? Math.ceil(deferred / perDay) : 0;
  return { road: "mailgun", period: "day", messages, now, deferred, hours, restDays, perDay, daysUsed: (now > 0 ? 1 : 0) + restDays };
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
