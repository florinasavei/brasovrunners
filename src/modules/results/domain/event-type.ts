/**
 * Which events take results (§808): only the race. A group run, a hike, a coffee, a meetup, a gear test and an event run by
 * somebody else (`EXTERNAL`) have none — the page says so, the service refuses (`RESULTS_NOT_OPEN`), the links are not drawn.
 * Pure, so the page, the registrations list's header, the service and a test read one answer.
 */
export const RESULT_EVENT_TYPES: readonly string[] = ["RACE"];

export function eventTakesResults(type: string): boolean {
  return RESULT_EVENT_TYPES.includes(type);
}
