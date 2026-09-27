import type { EmailMessageType } from "@/db/schema/email-outbox";
import { DEADLINE_RULES } from "@/modules/deadlines/domain/deadlines";
import { capHoldExpiry } from "@/modules/registrations/domain/hold-deadlines";

/**
 * «Termenul curge de când pleacă emailul» (§NNN): a participant's deadline counts from the moment
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
 * - **Later, never earlier**, and **by the wait alone**: the new deadline is the stored one plus
 *   `sentAt − queuedAt` — the same length the club's setting gave at the time (§377: a later change
 *   of «Termene» never moves a deadline already given), counted from the send instead.
 * - **Capped as the allocator caps it** (`capHoldExpiry`): a hold or an offer never outlives the
 *   close or the start, re-based or not.
 * - **A wait under a minute changes nothing**: the deadlines are stated to the minute, and under the
 *   `immediate` timing a message leaves within seconds — no write, no lock, as before.
 * - **Nothing is revived that the queue had already let go**: a deadline already behind the moment
 *   the message was queued (a resend asked after the lapse) is not moved, and an offer already
 *   past its deadline at the send is not either — an offer occupies its place only while its
 *   deadline is ahead (`countOccupied`), so reviving one could hand out a place twice. A
 *   declaration hold occupies by its status whatever its deadline (§160), so a lapsed one is
 *   re-based like a live one: that is the night case this exists for.
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
  // A lapsed offer occupies nothing (`countOccupied`): the place may be somebody else's by now.
  if (kind === "offer" && stored.getTime() <= sentAt.getTime()) return null;

  let next = new Date(stored.getTime() + wait);
  if (kind === "declarationHold" || kind === "offer") {
    if (!event) return null;
    next = capHoldExpiry({ naiveExpiresAt: next, registrationClosesAt: event.registrationClosesAt, eventStartsAt: event.startsAt });
  }
  return next.getTime() > stored.getTime() ? next : null;
}
