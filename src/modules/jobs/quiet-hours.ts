/**
 * The club's day and night, for the scheduler (AGENTS.md §16.2, `DECISIONS.md` §68).
 *
 * The site is allowed to be slower at night. Between 23:00 and 07:00 in Brașov nobody is
 * registering, no hold is expiring that a runner is waiting on, and the one thing a ping
 * buys — a warm database — costs the same CU-hours it does at noon. So the production
 * monitors run every fifteen minutes by day and once an hour by night, and the health check
 * knows which is which: a job last seen fifty minutes ago is `stale` at 10:00 and `ok` at
 * 03:00. Romania time, by name, so the clock follows the club through daylight saving.
 */
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { env } from "@/shared/config/env";

// The club's zone is defined once, in the date helper (§349); the scheduler reads the same one.

/** Quiet from `from` o'clock up to (not including) `to` o'clock, club time. */
export const QUIET_HOURS = { from: 23, to: 7 } as const;

/**
 * The monitor cadence the health check is measured against, in minutes. The day's is the
 * deployment's own (`PINGER_CADENCE_MINUTES`, `DECISIONS.md` §148): production is pinged every
 * fifteen minutes, QA once an hour to spare its free CU-hours (§68) — and a QA measured against
 * fifteen was "degraded" for most of every hour, which is what the owner's inbox of "cronjob
 * failed" was. Night is hourly everywhere.
 */
export const PINGER_CADENCE_MINUTES = { day: 15, night: 60 } as const;

export function pingerCadenceMinutes(now: Date, dayCadence: number = env.PINGER_CADENCE_MINUTES): number {
  return isQuietHour(now) ? Math.max(PINGER_CADENCE_MINUTES.night, dayCadence) : dayCadence;
}

export function clubHour(now: Date): number {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLUB_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return Number(text);
}

export function isQuietHour(now: Date): boolean {
  const hour = clubHour(now);
  return hour >= QUIET_HOURS.from || hour < QUIET_HOURS.to;
}

/** Twice the cadence in force, plus five minutes for a run — so one slow run never flips it. */
export function jobStalenessThresholdMs(now: Date, dayCadence?: number): number {
  return (2 * pingerCadenceMinutes(now, dayCadence) + 5) * 60_000;
}
