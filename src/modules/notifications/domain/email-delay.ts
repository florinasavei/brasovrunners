import type { EmailMessageType } from "@/db/schema/email-outbox";
import { BULK_MESSAGE_TYPES } from "./bulk";

/**
 * Whether the club's emails are late, as a person waiting for one is told (§623, amending §513 and
 * §547) — pure: the judgement. The outbox's facts are read by `public-delay.ts`, once a minute at
 * most, from the data cache.
 *
 * The owner, 2026-10-01: «In caz că mai pică sau avem coadă de mailuri, userii trebuie să vadă». On
 * the day registrations opened (§605), Mailgun's probation held the club's mail for hours, and the pages kept promising
 * «pleacă la 10:15»: people wrote to say they were waiting, and some registered a second time. So
 * the pages that wait for an email say, while it lasts, that the emails are late — how many wait,
 * the oldest's wait, an estimate when the platform has one — and the one rule that makes waiting
 * safe: a deadline runs from the moment the email leaves (§513), not from the form.
 */

/** Why the emails are late: Mailgun said stop, an allowance is spent, or the queue is simply behind. */
export type EmailDelayReason = "paused" | "allowance" | "backlog";

/** What the pages read (`readEmailDelay`, `cachedEmailDelay`). */
export type EmailDelay = {
  late: boolean;
  /** The dominant cause: a stopped road explains a backlog, so `paused` before `allowance` before `backlog`. */
  reason: EmailDelayReason | null;
  /** Messages a person is waiting for, not yet sent (below: not the newsletter, not a club copy). */
  queued: number;
  /** The oldest of them's wait, in whole minutes. */
  oldestWaitMinutes: number;
  /** At most how long until the queue is through, rounded up to five minutes; null when unknown. */
  estimateMinutes: number | null;
};

/** Nothing waits: what every page reads on a normal day, and renders as nothing. */
export const NO_EMAIL_DELAY: EmailDelay = { late: false, reason: null, queued: 0, oldestWaitMinutes: 0, estimateMinutes: null };

/**
 * How far past the wait the platform promises a message may be before the pages say it is late: ten
 * minutes. The promise is the pinger's tick under `scheduled` (§513: fifteen minutes by day, an hour
 * at night) and nothing under `immediate`; a run takes a minute or two, a retry's first backoff is a
 * minute (`domain/retry.ts`), and the pinger itself is a few minutes late at times. Ten minutes past
 * the promise is a wait no schedule explains — and still well before a person gives up and fills the
 * form in again, which is the one thing the notice exists to stop. `/api/health`'s ninety minutes
 * (§98) answer another question: when a person must be woken, not when a visitor should be told.
 */
export const LATE_MARGIN_MINUTES = 10;

/**
 * The messages nobody on a public page is waiting for (§445, §320): the newsletter and the new-event
 * alert, which wait for the allowance by design; the club's own copies and archives; a colleague's
 * or a member's invitation. A club copy queued as its own row carries the payload flag
 * (`CLUB_COPY_FLAG`) and is told apart by it, in the query.
 */
const NOT_WAITED_FOR: ReadonlySet<EmailMessageType> = new Set<EmailMessageType>([
  ...BULK_MESSAGE_TYPES,
  "DECLARATION_ARCHIVE",
  "GROUP_RUN_DECLARATION_ARCHIVE",
  "CLUB_CONFIRMATION_NOTICE",
  "STAFF_INVITATION",
  "MEMBER_INVITATION",
  // The Administrators' notice of a moved legal template (§639): nobody on a public page waits for it.
  "LEGAL_TEMPLATES_CHANGED",
  // The outage grace's two (§657): to the Administrators; nobody on a public page waits for them.
  "UNREACHABLE_WINDOW_OPENED",
  "UNREACHABLE_WINDOW_CLOSED",
  // An invitation (§647): sent by an Administrator's press, to somebody who is on no page waiting for it.
  "EVENT_INVITATION",
  // The members' shop (§683): the zone shows the order itself, whatever the email; nobody on a public page waits.
  "SHOP_ORDER_PLACED",
  "SHOP_ORDER_PAID",
  "SHOP_ORDER_CLUB_NOTICE",
]);

/** Whether somebody on a public page may be waiting for a message of this type (not a club copy). */
export function isWaitedFor(messageType: EmailMessageType, clubCopy: boolean): boolean {
  return !clubCopy && !NOT_WAITED_FOR.has(messageType);
}

/** The outbox, as `public-delay.ts` reads it in one query (`readEmailDelayFacts`). */
export type EmailDelayFacts = {
  /** Rows a person waits for, not yet sent (`isWaitedFor`): due, being sent, or held by a provider. */
  queued: number;
  /** Of them, the ones on Mailgun's road: what a Mailgun pause or a spent hour holds. */
  queuedOnMailgun: number;
  /**
   * Every non-newsletter row waiting on Mailgun's road, club copies included: what the hourly pace
   * must carry before the queue is through — the estimate's numerator.
   */
  aheadOnMailgun: number;
  /** Since when the oldest of `queued` has waited; null when nothing waits. */
  oldestWaitingSince: Date | null;
  /**
   * When Mailgun's hour frees its first place: the oldest send still inside the pace window, plus the
   * window; null when no send is in it. Nothing can leave a spent hour before it.
   */
  hourFreesAt: Date | null;
  /**
   * The earliest instant a provider (or Gmail's cap) put one of `queued` off to, more than an hour
   * ahead: a spent daily allowance, deferred to the reset. Null when none is.
   */
  deferredUntil: Date | null;
  /** When Mailgun's rate pause on its road ends, while it lasts (§605); null when there is none. */
  pausedUntil: Date | null;
  /** The email plan's hourly pace (§605); null when the club cleared it. */
  hourlyAllowance: number | null;
  /** What Mailgun's hour still takes (`hourlyRoom`); null without a pace. */
  hourlyRemaining: number | null;
  /** Whether the hour binds (`paceHolds`): Mailgun carried a full allowance recently or is carrying the rest now. */
  paceBinding: boolean;
};

/**
 * The judgement (§623).
 *
 * - Nothing waits: not late, whatever else is true — a page never says «0 mesaje așteaptă».
 * - **paused**: Mailgun told its road to wait and a waited-for message is on that road.
 * - **allowance**: Mailgun's hour is spent with a waited-for message on its road, or a provider put
 *   one off to its allowance's reset.
 * - **backlog**: the oldest has waited longer than the platform promises (`promisedWaitMinutes`,
 *   `emailWaitMinutes`: null under `immediate`) plus `LATE_MARGIN_MINUTES`.
 *
 * The estimate is a ceiling, so it is never optimistic. Mailgun's road leaves nothing until its pause
 * ends and nothing while its hour is spent, so: paused — the pause's end (or the hour's freeing, if
 * later) plus, when more waits than an hour carries, the queue at the pace; a spent hour — the
 * first place freeing (`hourFreesAt`) plus the queue at the pace, `aheadOnMailgun ÷ allowance × 60`;
 * deferred — the reset; a backlog while the pace binds — the queue at the pace; else unknown.
 * **And the scheduler's tick on each:** when a pause ends, an hour frees or an allowance resets,
 * nothing leaves until the next run (`wakeJobs` only forgets the cached quiet), so the promised wait
 * (the pinger's tick under `scheduled`, nothing under `immediate`) is added to every known estimate —
 * a pause ending at 01:05 under the hourly night cadence is «cel mult 65 de minute», not 5. **The tick
 * is the cadence at that instant** (`promisedWaitAt`, the caller's `pingerCadenceMinutes(instant)`),
 * not at the visitor's: the allowance resets at 02:05 or 03:05 club time, always in the hourly quiet
 * hours, so a daytime visitor is told reset + 60, not reset + 15; a pause or an hour freeing that
 * crosses 23:00 is the same. A queue spread over several runs ends at a run too, so the pace's
 * estimate carries the tick of now (`promisedWaitMinutes`: it drains over the coming runs). Rounded up to five minutes, never under five: «cel mult» is a ceiling, and a
 * precise number would read as a promise.
 */
export function judgeEmailDelay(
  facts: EmailDelayFacts,
  promisedWaitMinutes: number | null,
  now: Date,
  promisedWaitAt: (instant: Date) => number | null = () => promisedWaitMinutes,
): EmailDelay {
  if (facts.queued <= 0 || facts.oldestWaitingSince === null) return { ...NO_EMAIL_DELAY };
  const at = now.getTime();
  const oldestWaitMinutes = Math.max(0, Math.floor((at - facts.oldestWaitingSince.getTime()) / 60_000));

  const paused = facts.pausedUntil !== null && facts.pausedUntil.getTime() > at && facts.queuedOnMailgun > 0;
  const deferred = facts.deferredUntil !== null && facts.deferredUntil.getTime() > at;
  const hourSpent = facts.hourlyAllowance !== null && facts.hourlyRemaining === 0 && facts.queuedOnMailgun > 0;
  const behind = oldestWaitMinutes > (promisedWaitMinutes ?? 0) + LATE_MARGIN_MINUTES;

  const reason: EmailDelayReason | null = paused ? "paused" : deferred || hourSpent ? "allowance" : behind ? "backlog" : null;
  if (reason === null) return { ...NO_EMAIL_DELAY, queued: facts.queued, oldestWaitMinutes };

  const atPace = facts.hourlyAllowance !== null && facts.aheadOnMailgun > 0 ? (facts.aheadOnMailgun / facts.hourlyAllowance) * 60 : 0;
  const paceMinutes = facts.hourlyAllowance !== null && (facts.paceBinding || hourSpent) && facts.aheadOnMailgun > 0 ? atPace : null;
  const untilMinutes = (instant: Date | null) => (instant === null ? null : Math.max(0, (instant.getTime() - at) / 60_000));
  const untilHourFrees = hourSpent ? (untilMinutes(facts.hourFreesAt) ?? 0) : 0;
  // The next run after an instant waited for: nothing leaves between two runs (above). The tick is the
  // cadence AT that instant — a reset at 02:05 is met by the night's hourly run, whatever the visitor's hour.
  const tickAt = (instant: Date) => Math.max(0, promisedWaitAt(instant) ?? 0);
  const afterNow = (minutes: number) => new Date(at + minutes * 60_000);
  let estimate: number | null;
  if (reason === "paused") {
    const untilPause = untilMinutes(facts.pausedUntil);
    const overHour = facts.hourlyAllowance !== null && facts.aheadOnMailgun > facts.hourlyAllowance;
    if (untilPause === null) estimate = null;
    else {
      const until = Math.max(untilPause, untilHourFrees);
      estimate = until + tickAt(afterNow(until)) + (overHour || hourSpent ? atPace : 0);
    }
  } else if (deferred) {
    const until = untilMinutes(facts.deferredUntil) ?? 0;
    estimate = until + tickAt(afterNow(until));
  } else if (hourSpent) {
    estimate = paceMinutes === null ? null : untilHourFrees + tickAt(afterNow(untilHourFrees)) + paceMinutes;
  } else {
    // The queue drains over the coming runs, at the cadence of now.
    estimate = paceMinutes === null ? null : paceMinutes + Math.max(0, promisedWaitMinutes ?? 0);
  }

  return { late: true, reason, queued: facts.queued, oldestWaitMinutes, estimateMinutes: estimate === null ? null : roundUpToFive(estimate) };
}

/** Up to the next five minutes, never under five: 0 → 5, 12 → 15, 15 → 15, 90.2 → 95. */
export function roundUpToFive(minutes: number): number {
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}
