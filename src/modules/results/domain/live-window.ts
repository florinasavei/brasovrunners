/**
 * While a race runs, its public «Clasament» refreshes itself (§NNN; the owner, 2026-11-18: «pe site live trebuie sa vad lista de
 * finish» — and, asked, «LIVE»: every 30 seconds while the page is open, and nothing after the race). This is the window: from the
 * event's start — the moment the section may first be drawn (`results-open.ts#resultsOnShow`) — until its end, or six hours after the
 * start for a race saved without an end (the start is the meeting time, and a club race is over well within it). Pure, so the section
 * that draws the island, the island that stops itself and the test that pins them read one rule.
 */

/** How often the open page asks the server again, in milliseconds. */
export const RESULTS_REFRESH_MS = 30_000;

/** How long after the start a race saved without an end still refreshes. */
export const RESULTS_LIVE_HOURS_WITHOUT_END = 6;

/** The instant the refreshing stops, or null for an event with no start (its date to be announced, §533). */
export function resultsLiveUntil(event: { startsAt: Date | null; endsAt: Date | null }): Date | null {
  if (event.startsAt === null) return null;
  // An end saved at or before the start is no end: the start and six hours, as for a race saved without one.
  if (event.endsAt !== null && event.endsAt.getTime() > event.startsAt.getTime()) return event.endsAt;
  return new Date(event.startsAt.getTime() + RESULTS_LIVE_HOURS_WITHOUT_END * 3_600_000);
}

/** Whether the race is running at `now`: from the start (inclusive) until the window's end (exclusive). */
export function resultsLiveAt(event: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  const until = resultsLiveUntil(event);
  if (event.startsAt === null || until === null) return false;
  return now.getTime() >= event.startsAt.getTime() && now.getTime() < until.getTime();
}
