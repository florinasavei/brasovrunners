/**
 * Which event the registrations list is about when nobody has said (§178).
 *
 * The owner: "aș vrea să filtrez by default după evenimentul principal (pt că ar trebui să
 * existe doar unul la un moment dat)". He is right about the club's shape — one event is the
 * site's lead at a time — and about the screen: an unfiltered list of every registration the
 * club has ever taken is not what anybody opens this page to read.
 *
 * Three answers, and the middle one is the reason this is a function rather than an `??`:
 *
 *   - a chosen event id — use it;
 *   - the literal `all` — the organizer asked for everything, and asking must be possible, or
 *     "filtrează după principalul" becomes "you may not see the rest";
 *   - nothing at all — the featured event, if the club has one, and otherwise everything, which
 *     is what the page did before.
 *
 * Pure, so the page and the export can share it: a filter applied in the page but not in the
 * export would hand the club a spreadsheet of a different set than the screen showed, which is
 * the quiet kind of wrong (`AGENTS.md` §15.10).
 */

/** What the query string means for "every event". */
export const ALL_EVENTS = "all";

export function defaultEventFilter(
  requested: string | undefined,
  events: readonly { id: string; featured: boolean }[],
): { eventId: string | undefined; selected: string } {
  if (requested === ALL_EVENTS) return { eventId: undefined, selected: ALL_EVENTS };
  if (requested) {
    // An id that is not in the list any more — an event deleted since the link was made — falls
    // back rather than showing an empty page with a filter nobody can see the meaning of.
    const known = events.some((event) => event.id === requested);
    if (known) return { eventId: requested, selected: requested };
  }
  const featured = events.find((event) => event.featured);
  return featured ? { eventId: featured.id, selected: featured.id } : { eventId: undefined, selected: ALL_EVENTS };
}
