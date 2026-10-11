/**
 * The calendar's next-event panel's date (the facelift's phase 4): the soonest date still going
 * ahead among the upcoming rows the listing already reads (`cachedUpcomingEvents`, in any order)
 * that the page's own filters let through — so a calendar narrowed to special events leads with
 * the next special event, as the listing's lead follows its filters (§413). A cancelled date is
 * never the answer; a date already running (the read keeps an event until it ends) is, because it
 * is still on. Null when nothing is ahead, and the page draws no panel.
 *
 * Pure: the filters arrive as the caller's predicate.
 */
export function nextCalendarEvent<T extends { startsAt: Date; eventStatus: string }>(upcoming: readonly T[], passes: (event: T) => boolean): T | null {
  let soonest: T | null = null;
  for (const event of upcoming) {
    if (event.eventStatus === "CANCELLED" || !passes(event)) continue;
    if (!soonest || event.startsAt.getTime() < soonest.startsAt.getTime()) soonest = event;
  }
  return soonest;
}
