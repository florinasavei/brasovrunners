import type { CoHostSource } from "./co-hosts";

/**
 * How the listing divides the events it was given — pure, so the page can stream its three
 * regions independently and a test can say the division is the same one it always was
 * (`DECISIONS.md` §166).
 *
 * The page used to compute all of this inline, between three awaits. It cannot any more: the
 * lead event, the filter panel and the list of other events now sit behind `<Suspense>`
 * boundaries and are rendered by three different components off one shared promise, so the
 * rule for "which event is the hero" has to live somewhere all three can read it and nowhere
 * it can drift. What the filters are and which of them the page offers is `listing-filter.ts`.
 */

/**
 * The little the listing needs of an event to divide it up — plus whatever `readCoHosts`
 * needs to say whether it carries a partner (§344, amended §401).
 */
export type ListedEvent = { id: string; featured: boolean; type: string } & CoHostSource;

/**
 * The lead event, and everything that is not it.
 *
 * `listUpcomingEvents` orders featured first, so if the club has a lead event it is the first
 * row and no second query is needed. It is then dropped from the list below: the same event
 * as both the hero and the first card reads as a duplicate, not as emphasis
 * (`tests/e2e/event-pages.spec.ts` asserts exactly that).
 *
 * **The lead follows the filters** (§NNN, reversing what §133 and §401 said of the kind and the
 * partner chip). While a filter was one row of kind chips under the hero, "the hero is the club's
 * answer to what is next" was worth an exception. With a panel of five groups, a reader who ticks
 * "Trail" and "Avansat" and is shown an asphalt 5 km at the top of the page reads it as the
 * filter not working. So `matches` decides the hero too: a lead event that matches stays the
 * lead, one that does not is shown nowhere — not demoted to a card, because it does not match.
 *
 * **`hasUpcoming` is not optional in spirit** (§167). Between seasons the page is handed the
 * club's *last* event so it is not blank, and that row carries whatever `featured` flag it
 * had when it was next. A hero is the club's answer to "what is next"; a race that has
 * already been run is not an answer to that, so a past row is never the lead — it is an
 * ordinary card under the "no upcoming events" notice, which is what the page did before the
 * split and what the caller must keep asking for by passing the flag.
 */
export function listingSections<T extends ListedEvent>(
  events: readonly T[],
  matches: (event: T) => boolean = () => true,
  hasUpcoming = true,
) {
  const lead = hasUpcoming && events.length > 0 && events[0].featured ? events[0] : undefined;
  const featured = lead && matches(lead) ? lead : undefined;
  const listed = (lead ? events.filter((event) => event.id !== lead.id) : [...events]).filter(matches);
  return { featured, listed };
}

/**
 * The identity of the calendar's query, as one string.
 *
 * It is the `key` on the calendar's `<Suspense>` boundary, and it is what decides whether a
 * navigation shows the skeleton. React keeps the content of a boundary that merely *updates*
 * and shows the fallback for one that is *new*, so changing the key is how the skeleton is
 * asked for — and getting the key wrong in either direction is a visible bug: too coarse and
 * a month change leaves last month's grid on screen until the new one lands, too fine and the
 * grid blinks when nothing about it changed.
 *
 * So it names exactly what the rows behind the body depend on and nothing else: the period on
 * view, how it is drawn, **and the filters**. The filters are in the key because the calendar's
 * rows are narrowed by them too (§89, §167: a kind chip once changed the grid's contents while
 * the key stood still, so the previous kind's grid stayed on screen for the whole round-trip).
 * `filterKey` is `listingFilterKey`'s one string for the whole panel (§NNN), where §401 had
 * added the partner chip as a fourth argument. The layout is dropped in the year view, where it
 * has no meaning.
 */
export function calendarBoundaryKey(
  view: { kind: "month"; month: { year: number; month: number } } | { kind: "year"; year: number },
  layout: "grid" | "list",
  filterKey = "all",
): string {
  const period =
    view.kind === "year"
      ? String(view.year)
      : `${view.month.year}-${String(view.month.month).padStart(2, "0")}`;
  return `${view.kind}:${period}:${view.kind === "month" ? layout : "grid"}:${filterKey}`;
}
