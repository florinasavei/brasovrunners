/**
 * Which event the registrations list is about when nobody has said (§178), and what a name
 * search does to that (§312).
 *
 * The owner: "aș vrea să filtrez by default după evenimentul principal (pt că ar trebui să
 * existe doar unul la un moment dat)". He is right about the club's shape — one event is the
 * site's lead at a time — and about the screen: an unfiltered list of every registration the
 * club has ever taken is not what anybody opens this page to read.
 *
 * Four answers, and the last two are the reason this is a function rather than an `??`:
 *
 *   - a chosen event id — use it, search or no search;
 *   - the literal `all` — the organizer asked for everything, and asking must be possible, or
 *     "filtrează după principalul" becomes "you may not see the rest";
 *   - nothing chosen, and a name typed into the search — **every event** (§312). Somebody who
 *     types a name is looking for a person, not browsing a race, and the featured event kept as
 *     a silent filter answered "nobody by that name" about a person registered for the other
 *     one. That is how "she says she registered but I cannot find anything" happened: the
 *     search box sat under a filter the searcher had never chosen. The screen says, in one line,
 *     that it is searching everywhere and how to narrow it;
 *   - nothing chosen and nothing searched — the featured event, if the club has one, and
 *     otherwise everything, which is what the page did before §178.
 *
 * "Chosen" means *in the address*. The filter form's select therefore offers the automatic
 * answer as an option of its own, `AUTOMATIC` (the empty string), shown and submitted while
 * nothing was chosen: before this the select always submitted the featured event's id, so the
 * default turned itself into an explicit choice the first time anybody pressed "Filtrează" —
 * and the search could never have widened. `selected` is what the select shows and what the
 * sort and page links carry, so an automatic scope stays automatic across a sort, a page and a
 * new search.
 *
 * Pure, so the page and the export can share it: a filter applied in the page but not in the
 * export would hand the club a spreadsheet of a different set than the screen showed, which is
 * the quiet kind of wrong (`AGENTS.md` §15.10).
 */

/** What the query string means for "every event". */
export const ALL_EVENTS = "all";

/** What the select submits for "let the page decide": an empty value, dropped from every link. */
export const AUTOMATIC = "";

export type EventFilter = {
  /** The event the rows are filtered on; `undefined` is every event. */
  eventId: string | undefined;
  /** What the select shows and the links carry: an event id, `ALL_EVENTS`, or `AUTOMATIC`. */
  selected: string;
  /** True when a name search, and nothing else, widened the featured default to every event. */
  searchesEverywhere: boolean;
};

export function defaultEventFilter(
  requested: string | undefined,
  events: readonly { id: string; featured: boolean }[],
  search?: string,
): EventFilter {
  if (requested === ALL_EVENTS) return { eventId: undefined, selected: ALL_EVENTS, searchesEverywhere: false };
  if (requested) {
    // An id that is not in the list any more — an event deleted since the link was made — falls
    // back rather than showing an empty page with a filter nobody can see the meaning of.
    const known = events.some((event) => event.id === requested);
    if (known) return { eventId: requested, selected: requested, searchesEverywhere: false };
  }
  const featured = events.find((event) => event.featured);
  // No featured event: the default already is every event, so a search widens nothing and the
  // select has no automatic answer that differs from "all".
  if (!featured) return { eventId: undefined, selected: ALL_EVENTS, searchesEverywhere: false };
  if (search?.trim()) return { eventId: undefined, selected: AUTOMATIC, searchesEverywhere: true };
  return { eventId: featured.id, selected: AUTOMATIC, searchesEverywhere: false };
}
