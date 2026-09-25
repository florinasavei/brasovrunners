import { DIFFICULTY_LEVELS, type DifficultyLevel } from "../ui/difficulty-levels";
import { readCoHosts, type CoHostSource } from "./co-hosts";
import { EVENT_COST_TYPES, type EventCostType } from "./cost";
import { EVENT_SURFACES, EVENT_TYPES, type EventSurface, type EventType } from "./event-type";
import { registrationCta, type RegistrationCtaInput } from "./registration-cta";
import { registrationState, type RegistrationWindowInput } from "./registration-window";

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
 * Pure — no clock, no environment, no read — so the two questions that need one of them are the
 * caller's predicates (`FilterFacts`): whether a date is a night event (§394, `clubNightEvent`, the
 * club's place and the clock) and whether the page has a registration door (`registrationDoorOpen`
 * over the cached availability, `registration-doors.ts`). A unit test can hand either anything.
 */

/**
 * The distance, in four bands a runner thinks in: sub 5 km, 5–10, 10–21, over 21. `FROM_10_TO_21`
 * ends at 21.1 km so that a half marathon, however the club rounded it (21 097 m, 21 100 m),
 * lands in that band and not "over 21"; an event with no distance stated is in no band.
 */
export const DISTANCE_BANDS = ["UP_TO_5", "FROM_5_TO_10", "FROM_10_TO_21", "OVER_21"] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

const UP_TO_5_MAX_METERS = 5_000;
const FROM_5_TO_10_MAX_METERS = 10_000;
const FROM_10_TO_21_MAX_METERS = 21_100;

export function distanceBand(distanceMeters: number | null): DistanceBand | null {
  if (distanceMeters === null || distanceMeters <= 0) return null;
  if (distanceMeters <= UP_TO_5_MAX_METERS) return "UP_TO_5";
  if (distanceMeters <= FROM_5_TO_10_MAX_METERS) return "FROM_5_TO_10";
  if (distanceMeters <= FROM_10_TO_21_MAX_METERS) return "FROM_10_TO_21";
  return "OVER_21";
}

/** The four closed sets a filter ticks values of, in the order the panel draws them. */
export const FILTER_GROUPS = ["type", "surface", "difficulty", "distance", "cost"] as const;
export type FilterGroup = (typeof FILTER_GROUPS)[number];

/**
 * The three yes-or-no filters, under "Altele" / "More": held with a partner (§401), a night
 * event (§394), and «Înscrieri deschise» — the event's page has a registration door right now
 * (§NNN): exactly the events whose page shows a button to register, the one `RegistrationCta`
 * draws — a place, the waiting list, or the organizer's own form — and never one whose page says
 * a sentence instead (full with no waiting list, the waiting list full, not open yet, closed).
 */
export const FILTER_FLAGS = ["partner", "night", "registration"] as const;
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
  registration: false,
};

/**
 * What a filter has to know of an event: its closed-set columns, whatever `readCoHosts` reads,
 * and the columns the registration door is decided on (all on the public row already —
 * `RegistrationCta` reads the same ones for the same event).
 */
export type FilterableEvent = {
  type: string;
  surface: string | null;
  difficulty: string | null;
  distanceMeters: number | null;
  costType: string | null;
} & CoHostSource &
  RegistrationDoorEvent;

/** The two answers a filter cannot give from the row alone — the caller's, per event (see the file's head). */
export type FilterFacts<T> = {
  /** Whether this date is a night event (§394). */
  night: (event: T) => boolean;
  /** Whether this event's page has a registration door right now (`registrationDoorOpen`). */
  door: (event: T) => boolean;
};

/** An event's own columns the page's registration door reads — everything but the free places. */
export type RegistrationDoorEvent = RegistrationWindowInput & Pick<RegistrationCtaInput, "externalRegistrationUrl" | "externalProvider">;

/** The free places and the waiting list, as `cachedPublicAvailability` answers them; null for an uncapped event. */
export type DoorAvailability = { available: number; waitlistRoom: number | null; waitlistCapacity: number | null } | null;

/**
 * Whether the page's door needs the free places to be decided: an internal event whose window is
 * open — the one case `RegistrationCta` reads them in, and so the one case a listing pays a
 * (cached) read for. Every other event's door is decided by its own columns.
 */
export function doorNeedsAvailability(event: RegistrationWindowInput, now: Date): boolean {
  return event.registrationMode === "INTERNAL" && registrationState(event, now) === "OPEN";
}

/** The `registrationCta` states that draw a button on the event's page (`RegistrationCta.tsx`). */
const DOOR_KINDS: ReadonlySet<ReturnType<typeof registrationCta>["kind"]> = new Set(["OPEN", "FULL", "EXTERNAL"]);

/**
 * «Înscrieri deschise» (§NNN): the event's page offers a way to register right now — the same
 * `registrationCta` the page renders its door from, over the same availability. A free place or an
 * uncapped event (`OPEN`), no place but a waiting list that takes people (`FULL`), or the
 * organizer's own form (`EXTERNAL`) is a door; a full event with no waiting list or a full waiting
 * list (§348), a window not open yet or closed, a cancelled or finished event, or one that takes no
 * registration is not. `availability` is only read where `doorNeedsAvailability` says so.
 */
export function registrationDoorOpen(event: RegistrationDoorEvent, availability: DoorAvailability, now: Date): boolean {
  const cta = registrationCta(
    {
      ...event,
      availablePlaces: availability?.available ?? null,
      waitlistRoom: availability?.waitlistRoom ?? null,
      waitlistCapacity: availability?.waitlistCapacity ?? null,
    },
    now,
  );
  return DOOR_KINDS.has(cta.kind);
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Every value a parameter names, whichever shape the address wrote it in: repeated
 * (`?type=RACE&type=HIKE`, what the GET form submits) or comma-separated (`?type=RACE,HIKE`, the
 * shape a hand-written link might use) — both parse to the same tick set. Each is trimmed, so a
 * space a hand-typed link carried (or `+`, which a query string reads as one) is not a value.
 */
const all = (value: string | string[] | undefined): string[] =>
  (value === undefined ? [] : Array.isArray(value) ? value : [value]).flatMap((entry) => entry.split(",").map((part) => part.trim()));

/**
 * The short forms a hand-written address may use for a distance band (§NNN): the band's own
 * kilometres, `?distance=10-21`, rather than the enum's name. `21+` arrives as `21 ` — a query
 * string reads `+` as a space — and `all` trims it, so `21`, `21+` and `21-` all mean "over 21".
 */
const DISTANCE_ALIASES: Record<string, DistanceBand> = {
  "0-5": "UP_TO_5",
  "5-10": "FROM_5_TO_10",
  "10-21": "FROM_10_TO_21",
  "21": "OVER_21",
  "21-": "OVER_21",
};

/**
 * One asked value in a group's own spelling: the enum's name whatever its case, with `-` for `_`
 * (`group-run`, `Group_Run` and `GROUP_RUN` are one kind), and a distance's kilometre alias.
 */
function canonical(group: FilterGroup, asked: string): string {
  // `Object.hasOwn`, not `in`: `?distance=constructor` must not find the prototype's.
  if (group === "distance" && Object.hasOwn(DISTANCE_ALIASES, asked)) return DISTANCE_ALIASES[asked];
  return asked.toUpperCase().replaceAll("-", "_");
}

/**
 * The filter the address names. A value outside its closed set is not an error — it is ignored,
 * the way `?type=NOPE` always was — and the values come back in the closed set's own order, once
 * each, so two addresses that tick the same boxes in another order are the same state. Besides the
 * enum names the form itself submits, the short forms a link might be written in are read the same
 * way: `?type=race,group-run`, `?distance=10-21` (§NNN).
 */
export function parseListingFilter(params: SearchParams): ListingFilter {
  const pick = <G extends FilterGroup>(group: G): GroupValues[G][] => {
    const asked = all(params[group]).map((value) => canonical(group, value));
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
    registration: all(params.registration).includes("1"),
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

/** The same filter with one box unticked — the active chip's own link. */
export function withoutValue(filter: ListingFilter, group: FilterGroup | FilterFlag, value?: string): ListingFilter {
  if (group === "partner" || group === "night" || group === "registration") return { ...filter, [group]: false };
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

function flagOf<T extends FilterableEvent>(event: T, flag: FilterFlag, facts: FilterFacts<T>): boolean {
  switch (flag) {
    case "partner":
      return readCoHosts(event).length > 0;
    case "night":
      return facts.night(event);
    case "registration":
      // The page's own door (`registrationDoorOpen`), decided by the caller over the same cached
      // availability `RegistrationCta` reads — never the window alone: a full event with no
      // waiting list is inside its window and offers no way in.
      return facts.door(event);
  }
}

/**
 * Whether an event passes the filter: every group with a tick must contain the event's own value
 * (an unanswered question matches no tick), and every flag that is on must hold.
 */
export function matchesListingFilter<T extends FilterableEvent>(event: T, filter: ListingFilter, facts: FilterFacts<T>): boolean {
  for (const group of FILTER_GROUPS) {
    const ticked = filter[group] as string[];
    if (ticked.length === 0) continue;
    const value = valueOf(event, group);
    if (value === null || !ticked.includes(value)) return false;
  }
  for (const flag of FILTER_FLAGS) {
    if (filter[flag] && !flagOf(event, flag, facts)) return false;
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
 * **A group needs at least two values to choose between** (§NNN, restoring §133's own rule): a
 * group where only one value would narrow is not offered — one box asking a question every other
 * row already answers the same way is nothing to choose between — unless the address already
 * ticks something in it, which always stays so a filtered page can say what it is filtered by.
 *
 * Read off every event the page shows, the lead event included — the lead follows the filter now
 * (§NNN) — and never off the filtered rows, so ticking one box never takes another away.
 */
export function offeredFilters<T extends FilterableEvent>(events: readonly T[], filter: ListingFilter, facts: FilterFacts<T>): FilterOffer {
  const narrows = (count: number) => count > 0 && count < events.length;
  const groups = FILTER_GROUPS.map((group) => {
    const ticked = filter[group] as string[];
    const eligible = (GROUP_VALUES[group] as readonly string[]).filter((value) =>
      narrows(events.filter((event) => valueOf(event, group) === value).length),
    );
    const offerAll = eligible.length >= 2;
    const values = (GROUP_VALUES[group] as readonly string[]).filter(
      (value) => ticked.includes(value) || (offerAll && eligible.includes(value)),
    );
    return { group, values };
  }).filter((entry) => entry.values.length > 0);
  const flags = FILTER_FLAGS.filter(
    (flag) =>
      filter[flag] ||
      narrows(events.filter((event) => flagOf(event, flag, facts)).length),
  );
  return { groups, flags };
}

export function offersAnything(offer: FilterOffer): boolean {
  return offer.groups.length > 0 || offer.flags.length > 0;
}
