/**
 * While a race runs, its public «Clasament» refreshes itself (§NNN; the owner, 2026-11-18: «pe site live trebuie sa vad lista de
 * finish» — and, asked, «LIVE»: every 30 seconds while the page is open, and nothing after the race). This is the window: from the
 * event's start — the moment the section may first be drawn (`results-open.ts#resultsOnShow`) — until its end, or six hours after the
 * start for a race saved without an end (the start is the meeting time, and a club race is over well within it). Pure, so the section
 * that draws the island, the island that stops itself and the test that pins them read one rule.
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
 * The instant the open page stops refreshing itself, when it refreshes at `now` — a race whose results are ticked public, inside its
 * window — or null. With the section, or alone and silent while it is not drawn: a sheet still empty (the first finish not saved yet),
 * or a database away at that render — so a page opened then shows the first result, or the section back, at a later refresh.
 */
export function resultsLiveRefreshUntil(event: LiveResultsEvent, now: Date): Date | null {
  if (!event.resultsTicked || !eventTakesResults(event.type) || !resultsLiveAt(event, now)) return null;
  return resultsLiveUntil(event);
}

/**
 * The instants still ahead of `now` at which the page changes by the window alone: its start (the island comes, though no result is
 * stored yet) and its end (it goes). The page is held to the first of them, so a copy made before the start is made again at it and one
 * made during the race again at its end. Nothing for a race whose results are not ticked, or an event that takes none.
 */
export function resultsLiveInstants(event: LiveResultsEvent, now: Date): Date[] {
  if (!event.resultsTicked || !eventTakesResults(event.type) || event.startsAt === null) return [];
  const until = resultsLiveUntil(event);
  return [event.startsAt, until].filter((instant): instant is Date => instant !== null && instant.getTime() > now.getTime());
}
