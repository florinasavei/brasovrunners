import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { fromWallTimeInput, toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * «Vii mâine la …?» (§818; the owner, 2026-10-18: «I need this "Going" to be via email or something … super easy») — WHEN the
 * day-before question goes out, pure. The rest (who, the links, the row that makes it once) is `rsvp/ask.ts`.
 *
 * **The window.** An event's question is asked on the club's calendar day BEFORE the day its start falls on (Europe/Bucharest,
 * the club's zone — never "24 hours before", which is the wrong day twice a year), by the first run of the maintenance job at or
 * after 08:00 club time on that day (the morning of §775's digest: nothing is sent at 03:00), and until midnight. So:
 *
 *   - an event at 10:00 on Sunday is asked on Saturday from 08:00;
 *   - an event at 00:30 on Sunday is asked on Saturday from 08:00 too — "tomorrow" is the calendar's word, not the clock's;
 *   - **an event ticked only on the day itself is never asked**: the window closed at the midnight before it, and a question
 *     about "tomorrow" asked on the day would be a lie. The page's «Vin!» and the calendar still take the answer;
 *   - an event ticked at 22:00 the evening before is asked at once (the window is open), at the first run after the save.
 *
 * The 08:00 hour sits between the two changes of the clock (03:00–04:00) and midnight is never inside one, so both are found on the
 * wall clock with `fromWallTimeInput`, never by adding hours.
 */

/** The club hour from which the day's question may go: the first run at or after it. */
export const RSVP_ASK_HOUR = 8;

/** The same hour as the wall clock writes it, "08:00", read from the one constant. */
export const RSVP_ASK_CLOCK = `${String(RSVP_ASK_HOUR).padStart(2, "0")}:00`;

/** The calendar day before "YYYY-MM-DD", as the same shape. Calendar arithmetic only: no hour is added. */
function dayBefore(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

/** The club day an instant falls on, "YYYY-MM-DD". */
function clubDay(at: Date): string {
  return toWallTimeInput(at, CLUB_TIME_ZONE).slice(0, 10);
}

/**
 * The window of the question for an event starting at `startsAt`: it opens at 08:00 club time on the day before the start's day,
 * and closes at the midnight that opens the start's day. Null only if the wall clock cannot place the hour (a time zone that
 * skips it — not the club's).
 */
export function rsvpAskWindow(startsAt: Date): { opensAt: Date; closesAt: Date } | null {
  const startDay = clubDay(startsAt);
  const opensAt = fromWallTimeInput(`${dayBefore(startDay)}T${RSVP_ASK_CLOCK}`, CLUB_TIME_ZONE);
  const closesAt = fromWallTimeInput(`${startDay}T00:00`, CLUB_TIME_ZONE);
  return opensAt && closesAt ? { opensAt, closesAt } : null;
}

/**
 * Whether `now` is inside the event's window: at or after 08:00 the day before, before the start's day begins — and, since an
 * event can start after `now` only, before the start itself (the second condition only matters for a window the start cuts short,
 * which the midnight already does).
 */
export function rsvpAskDue(startsAt: Date, now: Date): boolean {
  const window = rsvpAskWindow(startsAt);
  if (!window) return false;
  return now.getTime() >= window.opensAt.getTime() && now.getTime() < window.closesAt.getTime() && now.getTime() < startsAt.getTime();
}

/**
 * The instant the maintenance job should next look for this event (`jobs/next-work.ts`): the window's opening, when it is still
 * ahead of `now`. Null when it has opened already (a run that finds the window open does the work or the save wakes the job) or
 * when the event has started.
 */
export function rsvpAskNextLook(startsAt: Date, now: Date): Date | null {
  const window = rsvpAskWindow(startsAt);
  if (!window || startsAt.getTime() <= now.getTime()) return null;
  return window.opensAt.getTime() > now.getTime() ? window.opensAt : null;
}
