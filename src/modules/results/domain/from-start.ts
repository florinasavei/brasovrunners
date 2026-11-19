/**
 * «Public de la start» (§985; the owner, 2026-11-18, choosing «public from the start»): the Administrator may tick «Clasamentul e public
 * pe pagina evenimentului» before the race, and the site shows nothing until the race starts — the section, the listing's chip, the
 * cached read and the page's hold all wait for `startsAt` (`results-open.ts#resultsOnShow`, unchanged) — then shows every result as it
 * is saved. Pure, so «Clasament» and the public section say the same about it.
 */

/** What «Clasament» says of the tick: off, on and waiting for the start, or on and showing (from the start until the period ends). */
export type ResultsPublishState = "off" | "fromStart" | "on";

export function resultsPublishState(event: { resultsPublished: boolean; startsAt: Date }, now: Date): ResultsPublishState {
  if (!event.resultsPublished) return "off";
  return now.getTime() < event.startsAt.getTime() ? "fromStart" : "on";
}

/**
 * The moment the published results have been on the page since — the public section's «Publicat …» line: the moment the tick was saved,
 * or the race's start when it was saved before it (nothing showed until then). Null while the tick has no moment.
 */
export function resultsShownSince(publishedAt: Date | null, startsAt: Date | null): Date | null {
  if (publishedAt === null) return null;
  if (startsAt === null) return publishedAt;
  return publishedAt.getTime() < startsAt.getTime() ? startsAt : publishedAt;
}
