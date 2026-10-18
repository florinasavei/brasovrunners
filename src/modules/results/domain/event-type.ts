/**
 * Which events take results (§808): only the race. A group run, a hike, a coffee, a meetup, a gear test and an event run by
 * somebody else (`EXTERNAL`) have none — the page says so, the service refuses (`RESULTS_NOT_OPEN`), the links are not drawn.
 * Pure, so the page, the registrations list's header, the service and a test read one answer.
 */
export const RESULT_EVENT_TYPES: readonly string[] = ["RACE"];

export function eventTakesResults(type: string): boolean {
  return RESULT_EVENT_TYPES.includes(type);
}

/**
 * Whether a «Clasament» door is drawn for this event (§808, amended by §NNN: the owner, 2026-10-18, «unde găsesc clasamentul?»).
 *
 * A door should not hide a page that answers. The results page opens before the race starts and says so itself («Cursa nu a început
 * încă. Poți scrie rezultate de pe acum.»), so the editor's button and the registrations list's header read this one rule, which has
 * no start condition: the event is a race (`eventTakesResults`) and either published or already started. The one exception is a race
 * still ahead that is not public (a draft, in review, archived): it is not expected to have results typed before its start, so no
 * link is drawn, though the typed address still works. Once the start has passed the door is open whatever the editorial state,
 * because results may be typed for a race that was unpublished afterwards. The page and the service keep their own answers; this
 * only decides whether a link is drawn, and the role is asked beside it (`canEnterResults`).
 */
export function resultsDoorOpen(event: { type: string; editorialStatus: string; startsAt: Date }, now: Date): boolean {
  if (!eventTakesResults(event.type)) return false;
  return event.editorialStatus === "PUBLISHED" || event.startsAt.getTime() <= now.getTime();
}
