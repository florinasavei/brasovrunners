import { eventKind, type EventKind, type EventKindFacts } from "@/modules/events/domain/event-kind";
import { groupSeries, type Series, type SeriesMember } from "@/modules/events/domain/series";

/**
 * What the home page shows from the upcoming events (the facelift's phase 3, §NNN; `docs/REDESIGN.md`,
 * decisions 9 and 10, open question 7): «Următoarea alergare», then the weekly runs and the special
 * events, each section a card per event as the listing groups them (§113: a series is one card).
 *
 * Pure: the caller hands it the listing's own cached read (`cachedUpcomingEvents`), so the home page
 * asks the database nothing the listing has not already asked, and the two never disagree about what
 * is ahead.
 *
 * - **The next run** is the soonest date still going ahead of a run — a group run or a race, the two
 *   types that are running — whatever its kind: the plan's «soonest run» (open question 7's default;
 *   the featured flag keeps marking the race on the listing). A hike or a coffee is never «the next
 *   run»; with no run ahead the card is not drawn.
 * - **The two sections** split the series by their kind (`eventKind`, §709): weekly, a series that
 *   repeats every week; special, everything else (decision 9). Each series is one card, shown by its
 *   next date still going ahead — a series whose every date ahead is cancelled is no card here (the
 *   listing still says so). Soonest first, at most `limit` a section; the rest is the listing's.
 */
export type HomeRow = SeriesMember & EventKindFacts & { id: string; eventStatus: string };

/** The types that are a run: what «Următoarea alergare» may be. */
export const RUN_TYPES: ReadonlySet<string> = new Set(["GROUP_RUN", "RACE"]);

/** How many cards a section shows before the listing takes over. */
export const HOME_SECTION_LIMIT = 6;

/** One card of a section: the date it is shown by, and every date of its series ahead (soonest first). */
export type HomeCard<T> = { key: string; shown: T; members: readonly T[]; kind: EventKind };

export type HomeSections<T> = {
  next: T | null;
  weekly: HomeCard<T>[];
  special: HomeCard<T>[];
  /** How many more of each kind the listing holds than the section shows. */
  moreWeekly: number;
  moreSpecial: number;
};

const goesAhead = (row: { eventStatus: string }) => row.eventStatus !== "CANCELLED";

export function homeSections<T extends HomeRow>(upcoming: readonly T[], limit: number = HOME_SECTION_LIMIT): HomeSections<T> {
  let next: T | null = null;
  for (const row of upcoming) {
    if (!goesAhead(row) || !RUN_TYPES.has(row.type)) continue;
    if (!next || row.startsAt.getTime() < next.startsAt.getTime()) next = row;
  }

  const cards = groupSeries(upcoming)
    .map((series: Series<T>): HomeCard<T> | null => {
      const shown = series.members.find(goesAhead);
      return shown ? { key: series.key, shown, members: series.members, kind: eventKind(shown) } : null;
    })
    .filter((card): card is HomeCard<T> => card !== null)
    .sort((a, b) => a.shown.startsAt.getTime() - b.shown.startsAt.getTime());

  const weekly = cards.filter((card) => card.kind === "weekly");
  const special = cards.filter((card) => card.kind === "special");
  return {
    next,
    weekly: weekly.slice(0, limit),
    special: special.slice(0, limit),
    moreWeekly: Math.max(0, weekly.length - limit),
    moreSpecial: Math.max(0, special.length - limit),
  };
}
