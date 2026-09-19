import { z } from "zod";
import { addWallClockInterval, fromWallTimeInput, wallClockWeekday } from "./zoned-time";

/**
 * A standing recurrence (`DECISIONS.md` §122): "every Monday and Wednesday, until 20 December
 * — or for ever". Stored on the source event as `repeat_rule`; the maintenance job keeps the
 * next `HORIZON_DAYS` of occurrences created from it, each its own row, so one date can be
 * cancelled or moved on its own. The owner: "for a recurring event I need a start and end date
 * but I also need to update a certain edition"; "indefinitely, not set how many weeks".
 */

/** How often a repeated event recurs. Three cadences, because three is what the club runs. */
export const REPEAT_CADENCES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const;
export type RepeatCadence = (typeof REPEAT_CADENCES)[number];

/** ISO weekdays, 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** How far ahead the job keeps a series created: eight weeks, so "next month" is always there. */
export const HORIZON_DAYS = 56;

/** At most this many occurrences in one pass, whatever the rule says — a typo's ceiling. */
export const MAX_OCCURRENCES_PER_PASS = 104;

export const repeatRuleSchema = z
  .object({
    cadence: z.enum(REPEAT_CADENCES),
    /** With WEEKLY or FORTNIGHTLY; empty means the source's own weekday. MONTHLY ignores it. */
    weekdays: z.array(z.number().int().min(1).max(7)).max(7),
    /** The last day an occurrence may fall on (`YYYY-MM-DD`, the event's zone), or null: for ever. */
    until: z.iso.date().nullable(),
    /** Publish each occurrence as it is made, when the source is itself published. */
    publish: z.boolean(),
  })
  .strict();

export type RepeatRule = z.infer<typeof repeatRuleSchema>;

export function readRepeatRule(json: unknown): RepeatRule | null {
  const parsed = repeatRuleSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

const CADENCE_INTERVAL: Record<RepeatCadence, { days?: number; months?: number }> = {
  WEEKLY: { days: 7 },
  FORTNIGHTLY: { days: 14 },
  MONTHLY: { months: 1 },
};

/** The first instant after the rule's last day in `timeZone`, or null for no end. */
export function untilEnd(rule: RepeatRule, timeZone: string): Date | null {
  if (!rule.until) return null;
  const [year, month, day] = rule.until.split("-").map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return fromWallTimeInput(`${nextDay}T00:00`, timeZone);
}

/** Up to where the job creates: the rule's end or the horizon, whichever comes first. */
export function horizonEnd(rule: RepeatRule, timeZone: string, now: Date): Date {
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const end = untilEnd(rule, timeZone);
  return end && end.getTime() < horizon.getTime() ? end : horizon;
}

/**
 * The instants the rule puts after `after` and before `before` (both exclusive), each at the
 * source's own wall time — a Sunday 08:00 run stays 08:00 across a clock change (§64). Every
 * occurrence is a whole number of periods from the source, so a series stopped and started
 * again lands on the same dates, and two passes of the job never disagree.
 */
export function occurrencesBetween(
  source: { startsAt: Date; timezone: string },
  rule: RepeatRule,
  after: Date,
  before: Date,
): Date[] {
  const interval = CADENCE_INTERVAL[rule.cadence];
  const weekdays = rule.cadence === "MONTHLY" ? [] : [...new Set(rule.weekdays)].sort((a, b) => a - b);
  const sourceWeekday = wallClockWeekday(source.startsAt, source.timezone);
  const shift = (step: { days?: number; months?: number }) => addWallClockInterval(source.startsAt, source.timezone, step);

  const out: Date[] = [];
  // Period by period — a week, a fortnight, a month — until a period begins past `before`;
  // within a period, each chosen weekday at its offset from the source's own day.
  for (let period = 0; period < 5000 && out.length < MAX_OCCURRENCES_PER_PASS; period += 1) {
    const base = { days: (interval.days ?? 0) * period, months: (interval.months ?? 0) * period };
    const candidates =
      weekdays.length === 0
        ? [shift(base)]
        : weekdays.map((day) => shift({ days: base.days + day - sourceWeekday, months: base.months }));
    if (Math.min(...candidates.map((at) => at.getTime())) >= before.getTime()) break;
    for (const at of candidates) {
      if (at.getTime() > after.getTime() && at.getTime() < before.getTime()) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, MAX_OCCURRENCES_PER_PASS);
}
