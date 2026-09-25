import type { CoHostSource } from "./co-hosts";

/**
 * How the listing divides the events it was given — pure, so a test can say the division is the
 * same one it always was (`DECISIONS.md` §166).
 *
 * The lead event, the filter panel and the list of other events are rendered by different
 * components off the one read the page awaits (§413; §166 had them streamed behind `<Suspense>`),
 * so the rule for "which event is the hero" has to live somewhere all of them can read it and
 * nowhere it can drift. What the filters are and which of them the page offers is `listing-filter.ts`.
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
 * **The lead follows the filters** (§413, reversing what §133 and §401 said of the kind and the
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
