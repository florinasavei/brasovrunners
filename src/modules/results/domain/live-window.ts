/**
 * While a race runs, its public «Clasament» refreshes itself (§NNN; the owner, 2026-11-18: «pe site live trebuie sa vad lista de
 * finish» — and, asked, «LIVE»: every 30 seconds while the page is open, and nothing after the race). This is the window: from the
 * event's start — the moment the section may first be drawn (`results-open.ts#resultsOnShow`) — until its end, or six hours after the
 * start for a race saved without an end (the start is the meeting time, and a club race is over well within it). A page drawn before
 * the start carries the island too, silent and armed to the start, asking nothing before it (`resultsLiveRefreshWindow`). Pure, so the
 * section that draws the island, the island that stops itself and the test that pins them read one rule.
 */
import { eventTakesResults } from "./event-type";

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

/**
 * What the event page decides the island from — its own row, never a read that can fail: the type, the window, and **the Administrator's
 * tick as saved** (`resultsTicked`), not `resultsPublished`, which is «ticked and a result stored» (`events/repository.ts#PUBLIC_COLUMNS`).
 */
export type LiveResultsEvent = { type: string; resultsTicked: boolean; startsAt: Date | null; endsAt: Date | null };

/**
 * The window the open page refreshes itself in, for a page drawn at `now`, or null: a race whose results are ticked public, with a
 * start, before its window's end. `until` is the window's end. `from` is its start — past while the race runs; still ahead for a page
 * drawn before the race, whose island is armed to it and asks nothing until then (`ui/live-refresh.ts`), so a tab opened at 08:50 for a
 * 09:00 start shows, from the start, what the race brings. Drawn with the section, or alone and silent while it is not drawn: before
 * the start (nothing is shown until then), a sheet still empty (the first finish not saved yet), or a database away at that render — so
 * a page opened then shows the first result, or the section back, at a later refresh.
 */
export function resultsLiveRefreshWindow(event: LiveResultsEvent, now: Date): { from: Date; until: Date } | null {
  if (!event.resultsTicked || !eventTakesResults(event.type) || event.startsAt === null) return null;
  const until = resultsLiveUntil(event);
  if (until === null) return null;
  // Before the race: armed to its start. While it runs: refreshing. After its window: nothing.
  const ahead = now.getTime() < event.startsAt.getTime();
  return ahead || resultsLiveAt(event, now) ? { from: event.startsAt, until } : null;
}

/**
 * The instants still ahead of `now` at which the window turns: its start (the island, drawn before it armed to it, starts asking) and
 * its end (it goes). The page is held to the first of them, so a copy made before the start is made again at it and one made during the
 * race again at its end. Nothing for a race whose results are not ticked, or an event that takes none.
 */
export function resultsLiveInstants(event: LiveResultsEvent, now: Date): Date[] {
  if (!event.resultsTicked || !eventTakesResults(event.type) || event.startsAt === null) return [];
  const until = resultsLiveUntil(event);
  return [event.startsAt, until].filter((instant): instant is Date => instant !== null && instant.getTime() > now.getTime());
}
