import { readCoHosts, type CoHostSource } from "./co-hosts";
import { EVENT_TYPES, type EventType } from "./event-type";

/**
 * How the listing divides the events it was given — pure, so the page can stream its three
 * regions independently and a test can say the division is the same one it always was
 * (`DECISIONS.md` §166).
 *
 * The page used to compute all of this inline, between three awaits. It cannot any more: the
 * lead event, the filter chips and the list of other events now sit behind `<Suspense>`
 * boundaries and are rendered by three different components off one shared promise, so the
 * rule for "which event is the hero" has to live somewhere all three can read it and nowhere
 * it can drift.
 */

/**
 * The little the listing needs of an event to divide it up — plus whatever `readCoHosts`
 * needs to say whether it carries a partner (§344, amended §NNN — the owner, 22:15,
 * 2026-09-25: "I want to see that «colaboration» event in the filters as well").
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
 * The type filter applies to the list and never to the hero. That is deliberate and was
 * always so: the hero is the club's answer to "what is next", and narrowing the list below it
 * to hikes is not a reason to stop advertising Sunday's race.
 *
 * **`hasUpcoming` is not optional in spirit** (§167). Between seasons the page is handed the
 * club's *last* event so it is not blank, and that row carries whatever `featured` flag it
 * had when it was next. A hero is the club's answer to "what is next"; a race that has
 * already been run is not an answer to that, so a past row is never the lead — it is an
 * ordinary card under the "no upcoming events" notice, which is what the page did before the
 * split and what the caller must keep asking for by passing the flag.
 *
 * `partner` is AND-combined with `type`, the same way it narrows the calendar (§NNN): both
 * conditions must hold, never either. It never touches the hero either, for the same reason
 * `type` does not — the club's next race stays the club's answer to "what is next" whether or
 * not it happens to carry a partner.
 */
export function listingSections<T extends ListedEvent>(
  events: readonly T[],
  type?: EventType,
  hasUpcoming = true,
  partner = false,
) {
  const featured = hasUpcoming && events.length > 0 && events[0].featured ? events[0] : undefined;
  const listed = (featured ? events.filter((event) => event.id !== featured.id) : [...events]).filter(
    (event) => (!type || event.type === type) && (!partner || readCoHosts(event).length > 0),
  );
  return { featured, listed };
}

/**
 * Which kinds the filter offers (`DECISIONS.md` §133): one chip per kind the club actually
 * has something of, in the closed set's own order, plus whichever kind the address names so
 * the page can say a filter is in force even when it matches nothing.
 *
 * Read off the upcoming events alone since §166. It used to include the month on view as
 * well, and that had to go when the month became a streamed region: the chips sit above the
 * calendar and are a navigation control, so recomputing them per month would have made the
 * whole row blink on every arrow press — the flicker the change exists to remove. What is
 * lost is narrow: a kind the club has *only* in a past month somebody navigated back to no
 * longer adds a chip to the row. What it runs next week always does.
 */
export function presentEventTypes(events: readonly ListedEvent[], type?: EventType): EventType[] {
  return EVENT_TYPES.filter(
    (candidate) => candidate === type || events.some((event) => event.type === candidate),
  );
}

/**
 * Whether the "Colaborare" / "Partnership" chip is worth offering (§133's rule, extended
 * §NNN): the club has a partnered event among what the page shows, or the address already
 * narrows by it — so a filtered page can still say what it is filtered by even where it now
 * matches nothing, exactly as a kind chip does (`presentEventTypes`, above).
 */
export function partnerFilterOffered(events: readonly CoHostSource[], partner: boolean): boolean {
  return partner || events.some((event) => readCoHosts(event).length > 0);
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
 * view, how it is drawn, **and the kind filter**. The filter is in the key because the
 * calendar's rows are narrowed by it too — `events/page.tsx` filters what
 * `listPublishedEventsBetween` returns before handing it down, and has since §89. §166 said
 * the opposite and was wrong about its own page (§167): pressing a kind chip changed the
 * grid's contents while the key stood still, so the previous kind's grid stayed on screen for
 * the whole round-trip. The layout is dropped in the year view, where it has no meaning.
 *
 * `partner` joined the key for the same reason `type` is in it (§NNN): the calendar page reads
 * it off the address like `type` and narrows its rows the same way (`calendar/page.tsx`).
 */
export function calendarBoundaryKey(
  view: { kind: "month"; month: { year: number; month: number } } | { kind: "year"; year: number },
  layout: "grid" | "list",
  type?: EventType,
  partner = false,
): string {
  const period =
    view.kind === "year"
      ? String(view.year)
      : `${view.month.year}-${String(view.month.month).padStart(2, "0")}`;
  return `${view.kind}:${period}:${view.kind === "month" ? layout : "grid"}:${type ?? "all"}:${partner ? "partner" : "all"}`;
}
