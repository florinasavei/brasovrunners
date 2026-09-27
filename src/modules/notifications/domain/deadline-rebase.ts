import type { EmailMessageType } from "@/db/schema/email-outbox";
import { DEADLINE_RULES } from "@/modules/deadlines/domain/deadlines";
import { capHoldExpiry } from "@/modules/registrations/domain/hold-deadlines";

/**
 * «Termenul curge de când pleacă emailul» (§513): a participant's deadline counts from the moment
 * the email that carries it leaves, not from the moment it was queued.
 *
 * Under the scheduled delivery (the default on QA and production) a message waits for the outbox
 * job's next tick — up to fifteen minutes by day, an hour at night, longer under the budget
 * governor's floor (§447) or a spent Mailgun allowance (§40). A deadline written when the message
 * was queued would lose that wait: a thirty-minute declaration hold given at 23:05 and emailed at
 * midnight would be over before the runner could read the link. So when a message that carries a
 * deadline is SENT, the deadline moves later by exactly the time the message spent in the queue.
 *
 * **Which messages carry one** — every participant deadline the club's «Termene» sets (§377) that
 * starts in the same transaction as the email announcing it (`enqueueEmail` writes the row's
 * `created_at` from that transaction's own `now`, so the wait is exact):
 *
 * - `VERIFY_REGISTRATION_EMAIL` → the email link (`registrations.email_link_expires_at`, the
 *   «Termene» hours), while the row still waits for the click;
 * - `COMPLETE_DECLARATION` → the declaration hold (`registrations.hold_expires_at`, the «Termene»
 *   minutes), while the row still waits for the signature;
 * - `WAITLIST_SPOT_OFFER` → the waiting-list offer (`hold_expires_at`, the «Termene» hours), while
 *   the offer still stands;
 * - `REGISTER_ANOTHER_PERSON` → the family link (`pending_family_entries.expires_at`, the email-link
 *   hours).
 *
 * Every other deadline a participant meets is either minted at send already (the newsletter's
 * confirmation link, the manage and list links) or a date on the event itself, which no email
 * starts: the participation window's deadline (§104, «cu N zile înainte de start») is the same
 * date whenever the week-before request leaves, and it is left alone — a declaration hold longer
 * than the club's longest hold is that window's, never the club's minutes.
 *
 * The rules, each with its reason:
 *
 * - **Once, on the message that started it** (`STARTS_DEADLINE`): the type alone is not enough —
 *   the same four types are resent, reminded and copied, and each of those must move nothing.
 * - **Later, never earlier**, and **by the wait alone**: the new deadline is the stored one plus
 *   `sentAt − queuedAt` — the same length the club's setting gave at the time (§377: a later change
 *   of «Termene» never moves a deadline already given), counted from the send instead.
 * - **Capped as the allocator caps it** (`capHoldExpiry`): a hold or an offer never outlives the
 *   close or the start, re-based or not.
 * - **A wait under a minute changes nothing**: the deadlines are stated to the minute, and under the
 *   `immediate` timing a message leaves within seconds — no write, no lock, as before.
 * - **Nothing is revived that the queue had already let go**: a deadline already behind the moment
 *   the message was queued (a resend asked after the lapse) is not moved. A hold or an offer past
 *   its stored deadline at the send is re-based like a live one: while the message that starts it
 *   was queued it was never lapsed (`registrations/repository.ts#awaitingItsFirstEmail`, the offer's
 *   since §NNN) — it kept occupying its place and no sweep released it — so nobody else can have
 *   been given that place. That is the night case this exists for. The write asks, under the event's
 *   lock, that the row is still in the state the message was about (`deadline-rebase.ts`), so an
 *   offer the race's start did release stays released.
 *
 * Pure: the reads and the guarded write are `notifications/deadline-rebase.ts`'s.
 */

export type DeadlineKind = "emailLink" | "declarationHold" | "offer" | "familyLink";

/** The messages that start a participant's deadline, and which deadline each one carries. */
export const DEADLINE_KIND_BY_MESSAGE: Partial<Record<EmailMessageType, DeadlineKind>> = {
  VERIFY_REGISTRATION_EMAIL: "emailLink",
  COMPLETE_DECLARATION: "declarationHold",
  WAITLIST_SPOT_OFFER: "offer",
  REGISTER_ANOTHER_PERSON: "familyLink",
};

/**
 * The payload key of the one message that **starts** its deadline (§513): the email the allocator,
 * the offer or the form queued in the same transaction that wrote the deadline — the first send,
 * and only it. A resend (the backoffice's «Trimite din nou», §80; the runner's own «trimite-mi
 * linkul din nou», §39; the form sent again), a reminder (§104, §160) and the club's copies (§320)
 * carry no flag, so they move nothing: re-basing on the type alone pushed a hold or an offer on
 * with every resend.
 *
 * The same flag tells the lapsed-hold sweep that a declaration hold's clock has not started yet
 * (`registrations/repository.ts#awaitingItsFirstEmail`): while this message is still in the
 * queue, the hold is not lapsed, whatever its stored deadline says.
 */
export const STARTS_DEADLINE = "startsDeadline";

/** The payload of a message that starts its deadline, with whatever else it carries. */
export function startingDeadline(payload: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...payload, [STARTS_DEADLINE]: true };
}

/** Whether a queued row is the message that starts its deadline. */
export function startsItsDeadline(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && (payload as Record<string, unknown>)[STARTS_DEADLINE] === true;
}

/** A message that left within this long of being queued moves no deadline. */
export const REBASE_MIN_WAIT_MS = 60_000;

/** The club's longest declaration hold (§377): anything longer is the participation window's date. */
const LONGEST_CLUB_HOLD_MS = DEADLINE_RULES.holdMinutes.max * 60_000;

/**
 * The deadline a message's send moves the stored one to, or null when it stays as it is.
 *
 * `event` is the event's close and start, for a hold and an offer (the allocator's caps); the two
 * links are not capped by the event, as they never were.
 */
export function rebasedDeadline(input: {
  kind: DeadlineKind;
  stored: Date;
  queuedAt: Date;
  sentAt: Date;
  event?: { registrationClosesAt: Date | null; startsAt: Date } | null;
}): Date | null {
  const { kind, stored, queuedAt, sentAt, event } = input;
  const wait = sentAt.getTime() - queuedAt.getTime();
  if (wait < REBASE_MIN_WAIT_MS) return null;
  // Already over when the message was queued: a resend after the lapse moves nothing.
  if (stored.getTime() <= queuedAt.getTime()) return null;
  // The participation window's date (§104), not the club's minutes: no email starts it.
  if (kind === "declarationHold" && stored.getTime() - queuedAt.getTime() > LONGEST_CLUB_HOLD_MS) return null;

  let next = new Date(stored.getTime() + wait);
  if (kind === "declarationHold" || kind === "offer") {
    if (!event) return null;
    next = capHoldExpiry({ naiveExpiresAt: next, registrationClosesAt: event.registrationClosesAt, eventStartsAt: event.startsAt });
  }
  return next.getTime() > stored.getTime() ? next : null;
}
