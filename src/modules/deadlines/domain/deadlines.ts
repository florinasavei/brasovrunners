import { z } from "zod";
import { raceWeek } from "@/modules/events/domain/race-week";

/**
 * The club's deadlines — "Termene" (§377; the owner, 2026-09-24: "Why is this reminder
 * hardcoded?", then "this needs to be a configuration!", and, asked which ones: all of them).
 *
 * Every participant-facing timing the platform used to keep as a constant, as one club setting
 * (`platform_settings.deadlines`, the §100 shape): how long the email link lasts, how long a place
 * is held for the signature, how long a waiting-list offer stands, how long before the start the
 * reminder goes, when "I am here" opens, how many days the homepage counts down, and how far ahead
 * a standing series keeps its dates.
 *
 * **Unset means today's numbers.** Each default below is the constant it replaced, so nothing
 * changes on any deployment until an Administrator changes it — and a stored value this code can
 * no longer read falls back field by field to the same defaults (`readDeadlinesValue`).
 *
 * **Pure and client-safe.** No database, no `next/*`: the timing functions below are the only
 * arithmetic on these numbers anywhere, and the pages, the allocator, the job and the emails all
 * go through them. Reading the setting is `deadlines/deadlines.ts`'s; formatting a number as
 * words is `duration-words.ts`'s.
 *
 * **What is not here, deliberately.** The privacy notice's retention periods (three years, seven
 * days) are the club's legal commitment, not a knob; the participation window (§104) and the
 * minimum age (§329) are the event's own; the job cadence (§334) is the platform's cost, set on
 * Costuri; a token's own lifetime is a security property (§12.8).
 */

export const DEADLINE_KEYS = [
  "confirmationHours",
  "holdMinutes",
  "offerHours",
  "reminderHours",
  "selfCheckinHours",
  "raceWeekDays",
  "seriesHorizonDays",
  "publicListDays",
  "familySittingMinutes",
  "verificationRetryHours",
  "verificationRetries",
] as const;

export type DeadlineKey = (typeof DEADLINE_KEYS)[number];

/** `count` is a number of times, not a duration (§653: how many times the address link is re-sent). */
export type DeadlineUnit = "minutes" | "hours" | "days" | "count";

export type DeadlineRule = {
  unit: DeadlineUnit;
  /** The smallest value the panel and the service accept. */
  min: number;
  /** The largest. */
  max: number;
  /** The value when nobody has set one: the constant it replaced. */
  default: number;
};

/**
 * The bounds, the unit and the default of each deadline — one table, read by the schema, the
 * panel's boxes (`min`/`max`), the lenient reader and the tests.
 *
 * The bounds are what keeps a slip of the finger from doing harm, each with its reason:
 * - the **email link** at least 12 hours (a link that dies overnight is a registration lost) and
 *   at most a week (a registration nobody confirmed lingers that long);
 * - the **declaration hold** 10 to 120 minutes: shorter cannot be read and signed on a phone,
 *   longer is a place kept from the queue by somebody who walked away. Well under a day, which is
 *   what `render.ts` and `queueParticipationConfirmations` tell a window's hold apart by (§104);
 * - the **waiting-list offer** 6 to 72 hours: a night's sleep at least, three days at most, and
 *   always capped by the close and the start anyway (`capHoldExpiry`);
 * - the **reminder** 0 (none) to 168 hours — a week, the per-event column's CHECK as well;
 * - **"I am here"** 1 to 72 hours before the start;
 * - **race week** 0 (the race day only) to 21 days;
 * - the **series horizon** 14 to 182 days: two weeks is the least a listing should show ahead,
 *   half a year the most rows anybody should have created and not looked at (§122);
 * - the **public list** 1 to 365 days after the event, 30 by default (§421): how long a participant
 *   list the club switched on stays public before it closes by itself. A day at least, so a list is
 *   still there the evening after; a year at most, the ceiling the brief set, so a club that keeps a
 *   season's lists up can say so in its notice — the default is a month, because the names are a
 *   disclosure whose purpose (who is coming, who came) is spent soon after the event, and the
 *   registration itself is kept three years for other reasons.
 * - the **family sitting** 0 to 60 minutes, 10 by default (§519): how long, after «Da, încă o
 *   persoană» (§536: the first form's email is never held before that press), the sitting's one
 *   email waits for another person on the same address before it leaves by itself, when nobody
 *   presses «Gata» — counted again from every form sent and every «Da». Ten minutes is a second
 *   form filled on a phone; 0 holds nothing, every form's email leaving at once as before the
 *   sitting (the screen still offers the next person, saying the email has left); an hour is the
 *   most a verification email should wait, and the outbox's health reads a row held longer than
 *   that as stalled.
 * - the **verification email re-sent** (§653) 2 to 72 hours after the last one left, 20 by default:
 *   the address link once more, by itself, to whoever has not confirmed — under a day, so a link of
 *   the default 48 hours still has a day left when it arrives; two hours at least, so the person had
 *   time to look; three days is longer than the default link lives;
 * - **how many times** 0 to 3, 1 by default (a `count`, not a duration): every verification email for
 *   the address and the event counts toward one plus this number, the person's own «Retrimite» and a
 *   staff resend included, so nobody is nudged twice by a resend; 0 switches the mechanism off; three
 *   nudges is the most a reminder may be before it is a mailer. Neither moves the link's deadline.
 */
export const DEADLINE_RULES: Record<DeadlineKey, DeadlineRule> = {
  confirmationHours: { unit: "hours", min: 12, max: 168, default: 48 },
  holdMinutes: { unit: "minutes", min: 10, max: 120, default: 30 },
  offerHours: { unit: "hours", min: 6, max: 72, default: 24 },
  reminderHours: { unit: "hours", min: 0, max: 168, default: 48 },
  selfCheckinHours: { unit: "hours", min: 1, max: 72, default: 24 },
  raceWeekDays: { unit: "days", min: 0, max: 21, default: 7 },
  seriesHorizonDays: { unit: "days", min: 14, max: 182, default: 56 },
  publicListDays: { unit: "days", min: 1, max: 365, default: 30 },
  familySittingMinutes: { unit: "minutes", min: 0, max: 60, default: 10 },
  verificationRetryHours: { unit: "hours", min: 2, max: 72, default: 20 },
  verificationRetries: { unit: "count", min: 0, max: 3, default: 1 },
};

export type Deadlines = Record<DeadlineKey, number>;

export const DEFAULT_DEADLINES: Deadlines = Object.freeze(
  Object.fromEntries(DEADLINE_KEYS.map((key) => [key, DEADLINE_RULES[key].default])) as Deadlines,
);

/**
 * §456 (amending §377): the value the club is advised to keep for each deadline — the platform's
 * own default, one map so the panel's help, its «diferit de recomandat» chip and the fill button
 * read the same numbers and no catalogue carries one.
 */
export const RECOMMENDED: Deadlines = DEFAULT_DEADLINES;

/** The per-event reminder's column bounds (`events.reminder_hours_before`): 0 is "no reminder". */
export const EVENT_REMINDER_MAX_HOURS = DEADLINE_RULES.reminderHours.max;

/** The editor's choices for one event (§377), besides "as usual" (null) and "no reminder" (0). */
export const EVENT_REMINDER_CHOICES = [24, 48, 72, 96, 120] as const;

/**
 * One deadline as a save may post it: a number, or the digits a form box posts. An empty box is
 * refused rather than read as zero — `z.coerce` would turn "" into 0, and 0 is "no reminder", a
 * choice nobody makes by clearing a box.
 */
function bounded(key: DeadlineKey) {
  const rule = DEADLINE_RULES[key];
  return z.preprocess(
    (value) => (typeof value === "string" ? (/^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN) : value),
    z.number().int().min(rule.min).max(rule.max),
  );
}

/** What a save must be: every deadline, a whole number inside its bounds, and nothing else. */
export const deadlinesSettingSchema = z
  .object({
    confirmationHours: bounded("confirmationHours"),
    holdMinutes: bounded("holdMinutes"),
    offerHours: bounded("offerHours"),
    reminderHours: bounded("reminderHours"),
    selfCheckinHours: bounded("selfCheckinHours"),
    raceWeekDays: bounded("raceWeekDays"),
    seriesHorizonDays: bounded("seriesHorizonDays"),
    publicListDays: bounded("publicListDays"),
    familySittingMinutes: bounded("familySittingMinutes"),
    verificationRetryHours: bounded("verificationRetryHours"),
    verificationRetries: bounded("verificationRetries"),
  })
  .strict();

/**
 * The stored value as numbers, leniently: each field a whole number inside its bounds, or its
 * default. A row written by an older or newer version of this code — a key missing, one renamed,
 * one out of today's bounds — must never make the allocator throw or a page fail; the field this
 * code cannot read is today's constant, and the panel shows exactly what is in force.
 */
export function readDeadlinesValue(value: unknown): Deadlines {
  const stored = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = { ...DEFAULT_DEADLINES };
  for (const key of DEADLINE_KEYS) {
    const raw = stored[key];
    const rule = DEADLINE_RULES[key];
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= rule.min && raw <= rule.max) out[key] = raw;
  }
  return out;
}

/** The keys whose value differs — what the audit row names. */
export function changedDeadlines(before: Deadlines, after: Deadlines): DeadlineKey[] {
  return DEADLINE_KEYS.filter((key) => before[key] !== after[key]);
}

// --- The timings: the only arithmetic on these numbers -----------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When an email link sent now lapses unconfirmed (§377): stored on the registration at the moment
 * it is created (`registrations.email_link_expires_at`), so a later change of the setting never
 * moves a deadline somebody was already told.
 */
export function emailLinkExpiresAt(now: Date, deadlines: Pick<Deadlines, "confirmationHours">): Date {
  return new Date(now.getTime() + deadlines.confirmationHours * HOUR);
}

/**
 * Until when a family sitting holds its one email back (§519): the club's minutes from the last
 * form sent in it, or the last «Da, încă o persoană» — the press that opens it (§536). «Gata» sends
 * it before; each further form in the sitting, and each «Da», moves this forward. At 0 the sitting
 * holds nothing (`familySittingHolds`).
 */
export function familySittingHeldUntil(now: Date, deadlines: Pick<Deadlines, "familySittingMinutes">): Date {
  return new Date(now.getTime() + deadlines.familySittingMinutes * MINUTE);
}

/** Whether a family sitting holds its email at all (§519): 0 minutes is "every form's email at once". */
export function familySittingHolds(deadlines: Pick<Deadlines, "familySittingMinutes">): boolean {
  return deadlines.familySittingMinutes > 0;
}

/** The natural end of a declaration hold given now, before the close and the start cap it. */
export function declarationHoldEndsAt(now: Date, deadlines: Pick<Deadlines, "holdMinutes">): Date {
  return new Date(now.getTime() + deadlines.holdMinutes * MINUTE);
}

/** The natural end of a waiting-list offer made now, before the close and the start cap it. */
export function offerEndsAt(now: Date, deadlines: Pick<Deadlines, "offerHours">): Date {
  return new Date(now.getTime() + deadlines.offerHours * HOUR);
}

/**
 * How many hours before its start an event's reminder goes (§81): the event's own number when the
 * organizer chose one (`events.reminder_hours_before`), otherwise the club's. Zero is "no
 * reminder", from either.
 */
export function reminderHoursFor(
  event: { reminderHoursBefore?: number | null },
  deadlines: Pick<Deadlines, "reminderHours">,
): number {
  const own = event.reminderHoursBefore;
  return own === null || own === undefined ? deadlines.reminderHours : own;
}

/** The instant the reminder window opens for an event, or null when it has no reminder. */
export function reminderOpensAt(startsAt: Date, hours: number): Date | null {
  return hours > 0 ? new Date(startsAt.getTime() - hours * HOUR) : null;
}

/** From when a confirmed participant may say "I am here" from their own link (BR-REQ-037-08). */
export function selfCheckinOpensAt(startsAt: Date, deadlines: Pick<Deadlines, "selfCheckinHours">): Date {
  return new Date(startsAt.getTime() - deadlines.selfCheckinHours * HOUR);
}

/**
 * Whether an event is inside race week — the backoffice's "print the bibs now" attention (§311).
 * Counted exactly as the public countdown counts it (`events/domain/race-week.ts#raceWeek`, §377):
 * whole calendar days on the event's own wall clock, the start still ahead. So "0 = on race day
 * only", as the setting's help says, is what both do — the bib card and the homepage open on the
 * same morning.
 */
export function withinRaceWeek(
  event: { startsAt: Date; timezone: string },
  now: Date,
  deadlines: Pick<Deadlines, "raceWeekDays">,
): boolean {
  return raceWeek(event, now, deadlines) !== null;
}

/** Up to when a standing series keeps its dates created (§122), before the rule's own end. */
export function seriesHorizonEnd(now: Date, deadlines: Pick<Deadlines, "seriesHorizonDays">): Date {
  return new Date(now.getTime() + deadlines.seriesHorizonDays * DAY);
}

/**
 * When a public participant list closes by itself (§421): the club's number of days after the
 * event ends — its end when it has one, its start otherwise. Checked at request time by the page
 * that draws the list, never only by a cached query: the public cache (§333) expires on writes,
 * and the passing of a date is not one.
 */
export function publicListClosesAt(
  event: { startsAt: Date; endsAt?: Date | null },
  deadlines: Pick<Deadlines, "publicListDays">,
): Date {
  const end = event.endsAt ?? event.startsAt;
  return new Date(end.getTime() + deadlines.publicListDays * DAY);
}

/** Whether an event's public list is still inside the club's period (§421). */
export function publicListStillOpen(
  event: { startsAt: Date; endsAt?: Date | null },
  now: Date,
  deadlines: Pick<Deadlines, "publicListDays">,
): boolean {
  return now.getTime() <= publicListClosesAt(event, deadlines).getTime();
}
