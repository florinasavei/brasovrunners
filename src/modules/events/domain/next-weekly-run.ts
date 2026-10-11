import { groupSeries, recurrenceOf, type SeriesMember } from "./series";

/**
 * Where «Vino cu noi» goes (§708; `docs/REDESIGN.md`, decision 5): the next weekly run — the
 * soonest date, still going ahead, of a series that recurs every week (`recurrenceOf`, §113) —
 * or nothing, and the caller links the listing instead.
 *
 * Pure: the caller hands it the upcoming events it already reads (the listing's own cached read,
 * `cachedUpcomingEvents`), in any order. A one-off event, a race, a fortnightly or monthly series
 * and a cancelled date are never the answer; a date already running (the read keeps an event until
 * it ends) is, because the run is still on. The series is recognised as the listing recognises it
 * (`groupSeries`: the same type and title), so the button and the listing never disagree on what
 * the weekly run is.
 */
export type WeeklyRunCandidate = SeriesMember & { slug: string; timezone: string; eventStatus: string };

export function nextWeeklyRun<T extends WeeklyRunCandidate>(upcoming: readonly T[]): T | null {
  let soonest: T | null = null;
  for (const series of groupSeries(upcoming)) {
    const first = series.members[0];
    if (recurrenceOf(series.members, first.timezone).kind !== "weekly") continue;
    const next = series.members.find((member) => member.eventStatus !== "CANCELLED");
    if (next && (!soonest || next.startsAt.getTime() < soonest.startsAt.getTime())) soonest = next;
  }
  return soonest;
}
