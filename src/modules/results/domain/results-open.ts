import { publicListClosesAt, publicListStillOpen } from "@/modules/deadlines/domain/deadlines";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { eventTakesResults } from "./event-type";

/**
 * The event facts the cheap test reads — all of them on the listing's row (`PublicEvent`) and on the event page's.
 * `startsAt` is null while the event's date is to be announced (§533): such an event has no results to show.
 */
export type ResultsOpenEvent = {
  type: string;
  resultsPublished: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

/**
 * Whether an event's published results are **on show** at `now` (§NNN, race results part 2): the cheap half of the rule
 * `readPublicEventResults` applies — a race, the Administrator's tick, the race has started, the public list's period has not
 * passed (§421). Pure, so the listing's «Clasament» chip and the page's holds read the very test the page's section does,
 * never a second opinion.
 *
 * It does **not** know the other two conditions — the privacy notice and the terms in force describing the results — because
 * those are cached reads the caller makes once for a whole page (`readResultsGates`); the chip and the section both ask for
 * them and pass `gates` here. An event whose date is to be announced has no start, so no results.
 */
export function resultsOnShow(event: ResultsOpenEvent, now: Date, deadlines: Pick<Deadlines, "publicListDays">, gates: { noticeDescribes: boolean; termsDescribe: boolean }): boolean {
  if (!gates.noticeDescribes || !gates.termsDescribe) return false;
  if (!event.resultsPublished || !eventTakesResults(event.type)) return false;
  if (event.startsAt === null || now.getTime() < event.startsAt.getTime()) return false;
  return publicListStillOpen({ startsAt: event.startsAt, endsAt: event.endsAt }, now, deadlines);
}

/**
 * The instants at which an event's results page changes by the clock alone — when the race starts (a page made before it
 * would hold no section) and when the public list's period ends (the section goes, §421). The page and the listing hold
 * themselves until the first of these still ahead (`holdPageUntil`), so a static copy is made again then.
 */
export function resultsClockInstants(event: Pick<ResultsOpenEvent, "startsAt" | "endsAt">, deadlines: Pick<Deadlines, "publicListDays">): Date[] {
  if (event.startsAt === null) return [];
  return [event.startsAt, publicListClosesAt({ startsAt: event.startsAt, endsAt: event.endsAt }, deadlines)];
}
