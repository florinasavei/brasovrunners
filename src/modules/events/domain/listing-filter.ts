import { DIFFICULTY_LEVELS, type DifficultyLevel } from "../ui/difficulty-levels";
import { readCoHosts, type CoHostSource } from "./co-hosts";
import { EVENT_COST_TYPES, type EventCostType } from "./cost";
import { EVENT_SURFACES, EVENT_TYPES, type EventSurface, type EventType } from "./event-type";

/**
 * The listing's filters (§NNN, amending §133 and §401 — the owner, 2026-09-25: "un buton de
 * filtre, collapsed by default, checkboxuri pe pill-uri și mai multe filtre").
 *
 * One state, read from the address and written back to it, and nowhere else: the listing and the
 * calendar read the same parameters, a GET form with no script writes them, and a link that was in
 * somebody's history before this change still means what it meant (`?type=RACE`, `?partner=1`).
 *
 * **OR within a group, AND across groups.** Ticking "Cursă" and "Tură montană" shows either kind;
 * ticking "Cursă" and "Trail" shows a race on a trail. A group with nothing ticked asks nothing.
 *
 * Pure — no clock, no environment — so the one question that needs both, whether a date is a night
 * event (§394), is the caller's predicate (`clubNightEvent`), and a unit test can hand it anything.
 */

/**
 * The distance, in three bands a runner thinks in: a short run, up to a half marathon, longer.
 * `MEDIUM` ends at 21.1 km so that a half marathon, however the club rounded it (21 097 m, 21 100 m),
 * is a half marathon and not "longer"; an event with no distance stated is in no band.
 */
export const DISTANCE_BANDS = ["SHORT", "MEDIUM", "LONG"] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

const SHORT_MAX_METERS = 10_000;
const MEDIUM_MAX_METERS = 21_100;

export function distanceBand(distanceMeters: number | null): DistanceBand | null {
  if (distanceMeters === null || distanceMeters <= 0) return null;
  if (distanceMeters <= SHORT_MAX_METERS) return "SHORT";
  if (distanceMeters <= MEDIUM_MAX_METERS) return "MEDIUM";
  return "LONG";
}

/** The four closed sets a filter ticks values of, in the order the panel draws them. */
export const FILTER_GROUPS = ["type", "surface", "difficulty", "distance", "cost"] as const;
export type FilterGroup = (typeof FILTER_GROUPS)[number];

/** The two yes-or-no filters, under "Altele" / "More": held with a partner (§401), a night event (§394). */
export const FILTER_FLAGS = ["partner", "night"] as const;
export type FilterFlag = (typeof FILTER_FLAGS)[number];

type GroupValues = {
  type: EventType;
  surface: EventSurface;
  difficulty: DifficultyLevel;
  distance: DistanceBand;
  cost: EventCostType;
};

const GROUP_VALUES: { [G in FilterGroup]: readonly GroupValues[G][] } = {
  type: EVENT_TYPES,
  surface: EVENT_SURFACES,
  difficulty: DIFFICULTY_LEVELS,
  distance: DISTANCE_BANDS,
  cost: EVENT_COST_TYPES,
};

export type ListingFilter = { [G in FilterGroup]: GroupValues[G][] } & { [F in FilterFlag]: boolean };

export const NO_FILTER: ListingFilter = {
  type: [],
  surface: [],
  difficulty: [],
  distance: [],
  cost: [],
  partner: false,
  night: false,
};

/** What a filter has to know of an event: its closed-set columns, and whatever `readCoHosts` reads. */
export type FilterableEvent = {
  type: string;
  surface: string | null;
  difficulty: string | null;
  distanceMeters: number | null;
  costType: string | null;
} & CoHostSource;

type SearchParams = Record<string, string | string[] | undefined>;

const all = (value: string | string[] | undefined): string[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/**
 * The filter the address names. A value outside its closed set is not an error — it is ignored,
 * the way `?type=NOPE` always was — and the values come back in the closed set's own order, once
 * each, so two addresses that tick the same boxes in another order are the same state.
 */
export function parseListingFilter(params: SearchParams): ListingFilter {
  const pick = <G extends FilterGroup>(group: G): GroupValues[G][] => {
    const asked = all(params[group]);
    return GROUP_VALUES[group].filter((value) => asked.includes(value)) as GroupValues[G][];
  };
  return {
    type: pick("type"),
    surface: pick("surface"),
    difficulty: pick("difficulty"),
    distance: pick("distance"),
    cost: pick("cost"),
    partner: all(params.partner).includes("1"),
    night: all(params.night).includes("1"),
  };
}

/** How many boxes are ticked — the button's count. */
export function activeFilterCount(filter: ListingFilter): number {
  return FILTER_GROUPS.reduce((sum, group) => sum + filter[group].length, 0) + FILTER_FLAGS.filter((flag) => filter[flag]).length;
}

/**
 * The filter as query parameters, in the shape the form itself submits — one parameter per ticked
 * box, repeated within a group (`?type=RACE&type=HIKE&partner=1`) — so a link the server builds
 * and the address a script-less form produces are the same address.
 */
export function listingFilterQuery(filter: ListingFilter): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const group of FILTER_GROUPS) {
    const values = filter[group];
    if (values.length === 1) query[group] = values[0];
    else if (values.length > 1) query[group] = [...values];
  }
  for (const flag of FILTER_FLAGS) if (filter[flag]) query[flag] = "1";
  return query;
}

/** One string per state, for a `<Suspense>` key and for the island that keeps the boxes in step. */
export function listingFilterKey(filter: ListingFilter): string {
  const parts = FILTER_GROUPS.filter((group) => filter[group].length > 0).map((group) => `${group}=${filter[group].join("+")}`);
  for (const flag of FILTER_FLAGS) if (filter[flag]) parts.push(flag);
  return parts.length > 0 ? parts.join("&") : "all";
}

/** The same filter with one box unticked — the active chip's own link. */
export function withoutValue(filter: ListingFilter, group: FilterGroup | FilterFlag, value?: string): ListingFilter {
  if (group === "partner" || group === "night") return { ...filter, [group]: false };
  return { ...filter, [group]: (filter[group] as string[]).filter((candidate) => candidate !== value) } as ListingFilter;
}

/** The value an event carries in a group, or null for a question the club left unanswered. */
function valueOf(event: FilterableEvent, group: FilterGroup): string | null {
  switch (group) {
    case "type":
      return event.type;
    case "surface":
      return event.surface;
    case "difficulty":
      return event.difficulty;
    case "distance":
      return distanceBand(event.distanceMeters);
    case "cost":
      return event.costType;
  }
}

function flagOf(event: FilterableEvent, flag: FilterFlag, isNight: (event: FilterableEvent) => boolean): boolean {
  return flag === "partner" ? readCoHosts(event).length > 0 : isNight(event);
}

/**
 * Whether an event passes the filter: every group with a tick must contain the event's own value
 * (an unanswered question matches no tick), and every flag that is on must hold.
 */
export function matchesListingFilter<T extends FilterableEvent>(
  event: T,
  filter: ListingFilter,
  isNight: (event: T) => boolean,
): boolean {
  for (const group of FILTER_GROUPS) {
    const ticked = filter[group] as string[];
    if (ticked.length === 0) continue;
    const value = valueOf(event, group);
    if (value === null || !ticked.includes(value)) return false;
  }
  for (const flag of FILTER_FLAGS) {
    if (filter[flag] && !flagOf(event, flag, isNight as (event: FilterableEvent) => boolean)) return false;
  }
  return true;
}

export type FilterOffer = {
  groups: { group: FilterGroup; values: string[] }[];
  flags: FilterFlag[];
};

/**
 * What the panel offers — §133's rule, generalised: **a box is offered only when ticking it would
 * change what the page shows, or when the address already ticks it.** A value on some of the
 * events and not on all of them narrows; a value every event carries (one kind, the whole list on
 * asphalt) narrows nothing and is not offered, which keeps §133's "fewer than two kinds is nothing
 * to choose between"; a value no event carries would empty the page. A box the address ticks stays,
 * so a filtered page can always say what it is filtered by, even where it now matches nothing.
 *
 * Read off every event the page shows, the lead event included — the lead follows the filter now
 * (§NNN) — and never off the filtered rows, so ticking one box never takes another away.
 */
export function offeredFilters<T extends FilterableEvent>(
  events: readonly T[],
  filter: ListingFilter,
  isNight: (event: T) => boolean,
): FilterOffer {
  const narrows = (count: number) => count > 0 && count < events.length;
  const groups = FILTER_GROUPS.map((group) => {
    const ticked = filter[group] as string[];
    const values = (GROUP_VALUES[group] as readonly string[]).filter(
      (value) => ticked.includes(value) || narrows(events.filter((event) => valueOf(event, group) === value).length),
    );
    return { group, values };
  }).filter((entry) => entry.values.length > 0);
  const flags = FILTER_FLAGS.filter(
    (flag) => filter[flag] || narrows(events.filter((event) => flagOf(event, flag, isNight as (event: FilterableEvent) => boolean)).length),
  );
  return { groups, flags };
}

export function offersAnything(offer: FilterOffer): boolean {
  return offer.groups.length > 0 || offer.flags.length > 0;
}
