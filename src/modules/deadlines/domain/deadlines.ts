import { z } from "zod";

/**
 * The club's deadlines — "Termene" (§NNN; the owner, 2026-09-24: "Why is this reminder
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
] as const;

export type DeadlineKey = (typeof DEADLINE_KEYS)[number];

export type DeadlineUnit = "minutes" | "hours" | "days";

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
 *   at most a week (an unconfirmed address holds a provisional race number meanwhile, §214);
 * - the **declaration hold** 10 to 120 minutes: shorter cannot be read and signed on a phone,
 *   longer is a place kept from the queue by somebody who walked away. Well under a day, which is
 *   what `render.ts` and `queueParticipationConfirmations` tell a window's hold apart by (§104);
 * - the **waiting-list offer** 6 to 72 hours: a night's sleep at least, three days at most, and
 *   always capped by the close and the start anyway (`capHoldExpiry`);
 * - the **reminder** 0 (none) to 168 hours — a week, the per-event column's CHECK as well;
 * - **"I am here"** 1 to 72 hours before the start;
 * - **race week** 0 (the race day only) to 21 days;
 * - the **series horizon** 14 to 182 days: two weeks is the least a listing should show ahead,
 *   half a year the most rows anybody should have created and not looked at (§122).
 */
export const DEADLINE_RULES: Record<DeadlineKey, DeadlineRule> = {
  confirmationHours: { unit: "hours", min: 12, max: 168, default: 48 },
  holdMinutes: { unit: "minutes", min: 10, max: 120, default: 30 },
  offerHours: { unit: "hours", min: 6, max: 72, default: 24 },
  reminderHours: { unit: "hours", min: 0, max: 168, default: 48 },
  selfCheckinHours: { unit: "hours", min: 1, max: 72, default: 24 },
  raceWeekDays: { unit: "days", min: 0, max: 21, default: 7 },
  seriesHorizonDays: { unit: "days", min: 14, max: 182, default: 56 },
};

export type Deadlines = Record<DeadlineKey, number>;

export const DEFAULT_DEADLINES: Deadlines = Object.freeze(
  Object.fromEntries(DEADLINE_KEYS.map((key) => [key, DEADLINE_RULES[key].default])) as Deadlines,
);

/** The per-event reminder's column bounds (`events.reminder_hours_before`): 0 is "no reminder". */
export const EVENT_REMINDER_MAX_HOURS = DEADLINE_RULES.reminderHours.max;

/** The editor's choices for one event (§NNN), besides "as usual" (null) and "no reminder" (0). */
export const EVENT_REMINDER_CHOICES = [24, 48, 72] as const;

function bounded(key: DeadlineKey) {
  const rule = DEADLINE_RULES[key];
  return z.coerce.number().int().min(rule.min).max(rule.max);
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
 * When an email link sent now lapses unconfirmed (§NNN): stored on the registration at the moment
 * it is created (`registrations.email_link_expires_at`), so a later change of the setting never
 * moves a deadline somebody was already told.
 */
export function emailLinkExpiresAt(now: Date, deadlines: Pick<Deadlines, "confirmationHours">): Date {
  return new Date(now.getTime() + deadlines.confirmationHours * HOUR);
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
 * Whether an event is inside race week measured in plain elapsed time — the backoffice's "print the
 * bibs now" attention (§311). The public countdown counts calendar days on the event's own wall
 * clock instead (`events/domain/race-week.ts`); both read the same number of days.
 */
export function withinRaceWeek(startsAt: Date, now: Date, deadlines: Pick<Deadlines, "raceWeekDays">): boolean {
  const until = startsAt.getTime() - now.getTime();
  return until >= 0 && until <= deadlines.raceWeekDays * DAY;
}

/** Up to when a standing series keeps its dates created (§122), before the rule's own end. */
export function seriesHorizonEnd(now: Date, deadlines: Pick<Deadlines, "seriesHorizonDays">): Date {
  return new Date(now.getTime() + deadlines.seriesHorizonDays * DAY);
}
