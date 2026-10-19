import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { fromWallTimeInput, toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * «Vii?» (§818, settings §NNN; the owner, 2026-10-18: «I need this "Going" to be via email or something … super easy», then
 * 2026-10-19: «I need to set how these emails are sent») — WHEN the question goes out, pure. The rest (who, the links, the row that makes
 * it once) is `rsvp/ask.ts`.
 *
 * **The club sets two numbers** («Termene» → «Înainte de start»): `rsvpAskDaysBefore` (0–7, one by default; 0 asks nobody) and
 * `rsvpAskHour` (0–23 club time, eight by default). Both arrive here as `RsvpAskTiming`; the defaults below are today's behaviour, so
 * nothing moves on a deployment until the club changes them.
 *
 * **The window.** An event's question is asked from the club's calendar day N days BEFORE the day its start falls on (Europe/Bucharest,
 * the club's zone — never "N × 24 hours before", which is the wrong day twice a year), by the first run of the maintenance job at or after
 * the chosen hour on that day, and until the midnight that opens the start's day. So, with the defaults (one day, 08:00):
 *
 *   - an event at 10:00 on Sunday is asked on Saturday from 08:00;
 *   - an event at 00:30 on Sunday is asked on Saturday from 08:00 too — "tomorrow" is the calendar's word, not the clock's;
 *   - **an event ticked only on the day itself is never asked**: the window closed at the midnight before it, and a question
 *     about "tomorrow" asked on the day would be a lie. The page's «Vin!» and the calendar still take the answer;
 *   - an event ticked at 22:00 the evening before is asked at once (the window is open), at the first run after the save;
 *
 * and with three days, an event on Sunday is asked from Thursday's hour — and, ticked later than that, at once, until Saturday's midnight.
 * **Zero days is no question at all** (`rsvpAskWindow` is null): it is the club's «not at all», the same as unticking the event.
 *
 * **Both changes of the clock.** The window's opening is found on the wall clock with `fromWallTimeInput`, never by adding hours. The hours
 * the changes touch need a rule, because a club may choose any of them: on the last Sunday of March the wall clock skips 03:00–03:59
 * (03:00 becomes 04:00), and `fromWallTimeInput` places a skipped hour at the first instant after the gap — the question opens at 04:00,
 * the first moment that is "at or after 03:00"; on the last Sunday of October the wall clock reads 03:00–03:59 twice, and it places
 * the hour at its LATER reading (the one after the clock went back), so the question opens an hour after the first 03:00. Neither is ever
 * earlier than the hour the club typed and neither skips the day; the midnight that closes the window is never inside a change.
 */

/** The two numbers the club sets («Termene», `rsvpAskDaysBefore` and `rsvpAskHour`). */
export type RsvpAskTiming = { daysBefore: number; hour: number };

/** What the platform did before the club could choose: the day before, from 08:00 club time. */
export const DEFAULT_RSVP_ASK_TIMING: RsvpAskTiming = Object.freeze({ daysBefore: 1, hour: 8 });

/** The hour as the wall clock writes it, "08:00" — for the words that state it (`/admin/emails`, the deadline's closed line). */
export function rsvpAskClock(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** The calendar day `days` before "YYYY-MM-DD", as the same shape. Calendar arithmetic only: no hour is added. */
function daysBefore(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - days)).toISOString().slice(0, 10);
}

/** The club day an instant falls on, "YYYY-MM-DD". */
function clubDay(at: Date): string {
  return toWallTimeInput(at, CLUB_TIME_ZONE).slice(0, 10);
}

/**
 * The window of the question for an event starting at `startsAt`: it opens at the club's hour on the day N days before the start's day,
 * and closes at the midnight that opens the start's day. Null when the club sends none (zero days) or when the wall clock cannot place
 * the hour (a time zone that skips it — not the club's, whose skipped hour is placed after the gap).
 */
export function rsvpAskWindow(startsAt: Date, timing: RsvpAskTiming = DEFAULT_RSVP_ASK_TIMING): { opensAt: Date; closesAt: Date } | null {
  if (timing.daysBefore <= 0) return null;
  const startDay = clubDay(startsAt);
  const opensAt = fromWallTimeInput(`${daysBefore(startDay, timing.daysBefore)}T${rsvpAskClock(timing.hour)}`, CLUB_TIME_ZONE);
  const closesAt = fromWallTimeInput(`${startDay}T00:00`, CLUB_TIME_ZONE);
  return opensAt && closesAt ? { opensAt, closesAt } : null;
}

/**
 * Whether `now` is inside the event's window: at or after the opening, before the start's day begins — and, since an event can start
 * after `now` only, before the start itself (the second condition only matters for a window the start cuts short, which the midnight
 * already does).
 */
export function rsvpAskDue(startsAt: Date, now: Date, timing: RsvpAskTiming = DEFAULT_RSVP_ASK_TIMING): boolean {
  const window = rsvpAskWindow(startsAt, timing);
  if (!window) return false;
  return now.getTime() >= window.opensAt.getTime() && now.getTime() < window.closesAt.getTime() && now.getTime() < startsAt.getTime();
}

/**
 * The instant the maintenance job should next look for this event (`jobs/next-work.ts`): the window's opening, when it is still
 * ahead of `now`. Null when it has opened already (a run that finds the window open does the work or the save wakes the job) or
 * when the event has started, or when the club sends none.
 */
export function rsvpAskNextLook(startsAt: Date, now: Date, timing: RsvpAskTiming = DEFAULT_RSVP_ASK_TIMING): Date | null {
  const window = rsvpAskWindow(startsAt, timing);
  if (!window || startsAt.getTime() <= now.getTime()) return null;
  return window.opensAt.getTime() > now.getTime() ? window.opensAt : null;
}

/**
 * How many club calendar days from `now`'s day to the day the start falls on: 1 is «mâine», 2 «poimâine», 0 the day itself. The email
 * says it from this, at the send, so a question the club set three days ahead says «în 3 zile» and one sent late (a held message) never
 * says «mâine» for a day that is not tomorrow.
 */
export function rsvpAskDaysAway(startsAt: Date, now: Date): number {
  const [startYear, startMonth, startDate] = clubDay(startsAt).split("-").map(Number);
  const [nowYear, nowMonth, nowDate] = clubDay(now).split("-").map(Number);
  return Math.round((Date.UTC(startYear, startMonth - 1, startDate) - Date.UTC(nowYear, nowMonth - 1, nowDate)) / 86_400_000);
}

/**
 * The longest wait from `now` to a start whose window can be open, with room for both changes of the clock: the club's days, one more
 * for the start's own day, and two hours. The queue reads only the events inside it (`queueRsvpAsks`), so one query stays cheap whatever
 * the club chose.
 */
export function rsvpAskLookAheadMs(timing: RsvpAskTiming): number {
  return (Math.max(timing.daysBefore, 0) + 1) * 86_400_000 + 2 * 3_600_000;
}
