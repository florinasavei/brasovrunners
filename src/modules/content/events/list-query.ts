import { foldForSearch } from "@/modules/registrations/country-search";

/**
 * The backoffice events list's own state (§NNN): a search, a state and an order, read from the
 * address and written back to it, and nowhere else — the model is the public listing's filters
 * (§413, `events/domain/listing-filter.ts`): a GET form with no script writes these parameters,
 * every link the server builds carries them, and a hand-edited value falls back rather than
 * refusing (`admin-list-query.ts`'s rule). Pure — the clock is the caller's `now`.
 *
 * - `q` — words, each of which must appear (accents and case ignored, the pickers' own
 *   `foldForSearch`, §463) in a title, a page address or a place name, in either language.
 * - `state` — one of the editorial states (Ciornă, În verificare, Publicat, Arhivat), or
 *   `CANCELLED` — the event's own state since §331, which a published race keeps when it is
 *   called off — or `UPCOMING` / `PAST` by the start.
 * - `sort` + `dir` — `club` (the default and the list's order since the start: featured first,
 *   then soonest), `date`, `title` or `entries`. `dir` is read only for the last three, and
 *   absent it is the direction each reads first: a date soonest first, a title A to Z, the
 *   registrations most first.
 *
 * The filter narrows the *dates* before they are grouped into a series (§113), so a series
 * filtered to "Ciornă" is the line of its draft dates, and "Viitoare" folds only the dates still
 * to come — the tick then selects exactly the dates the line shows.
 */

export const EVENT_LIST_STATES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED", "CANCELLED", "UPCOMING", "PAST"] as const;
export type EventListState = (typeof EVENT_LIST_STATES)[number];

export const EVENT_LIST_SORTS = ["club", "date", "title", "entries"] as const;
export type EventListSort = (typeof EVENT_LIST_SORTS)[number];

/** Which way each order reads first when the address does not say. */
const NATURAL_DIR: Record<EventListSort, "asc" | "desc"> = { club: "asc", date: "asc", title: "asc", entries: "desc" };

/** Longer than any title anybody types; a pasted paragraph is cut, not refused. */
const MAX_QUERY_LENGTH = 100;

export type EventListQuery = {
  /** As typed, trimmed and cut — what the search box shows back. */
  q: string;
  state: EventListState | null;
  sort: EventListSort;
  dir: "asc" | "desc";
};

type Raw = string | string[] | undefined;

/** A repeated key (`?state=A&state=B`) arrives as a list at runtime: the first one counts. */
function first(value: Raw): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseEventListQuery(params: Record<string, Raw>): EventListQuery {
  const q = (first(params.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const stateRaw = first(params.state);
  const state = EVENT_LIST_STATES.find((value) => value === stateRaw) ?? null;
  const sortRaw = first(params.sort);
  const sort = EVENT_LIST_SORTS.find((value) => value === sortRaw) ?? "club";
  const dirRaw = first(params.dir);
  const dir = sort === "club" ? "asc" : dirRaw === "asc" || dirRaw === "desc" ? dirRaw : NATURAL_DIR[sort];
  return { q, state, sort, dir };
}

/** The direction a column header's first press asks for (`AdminColumn.initialDir`). */
export function naturalDir(sort: EventListSort): "asc" | "desc" {
  return NATURAL_DIR[sort];
}

/** Whether anything narrows or reorders the list — the fold opens and «Șterge filtrele» shows. */
export function eventListQueryInUse(query: EventListQuery): boolean {
  return query.q !== "" || query.state !== null || query.sort !== "club";
}

/**
 * The state as query parameters, only what differs from the default, so the plain list is the
 * plain address and a bookmarked one says what it filters. `AdminTable`'s links build on it.
 */
export function eventListParams(query: EventListQuery): Record<string, string | undefined> {
  return {
    q: query.q || undefined,
    state: query.state ?? undefined,
    sort: query.sort === "club" ? undefined : query.sort,
    dir: query.sort === "club" || query.dir === NATURAL_DIR[query.sort] ? undefined : query.dir,
  };
}

/** What a search and a filter read of one date. */
export type ListedEvent = {
  startsAt: Date;
  editorialStatus: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  locationName: string | null;
};

export type ListedTranslation = { title: string; slug: string; locationName: string | null };

export function matchesEventList(
  event: ListedEvent,
  translations: readonly ListedTranslation[],
  query: EventListQuery,
  now: Date,
): boolean {
  if (!matchesState(event, query.state, now)) return false;
  const words = foldForSearch(query.q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldForSearch(
    [event.locationName, ...translations.flatMap((translation) => [translation.title, translation.slug, translation.locationName])]
      .filter((part): part is string => Boolean(part))
      .join(" "),
  );
  return words.every((word) => haystack.includes(word));
}

function matchesState(event: ListedEvent, state: EventListState | null, now: Date): boolean {
  switch (state) {
    case null:
      return true;
    case "CANCELLED":
      return event.eventStatus === "CANCELLED";
    case "UPCOMING":
      return event.startsAt.getTime() >= now.getTime();
    case "PAST":
      return event.startsAt.getTime() < now.getTime();
    default:
      return event.editorialStatus === state;
  }
}

/** What an order reads of one line of the list. */
export type SortableLine = { title: string; startsAt: Date; entries: number };

/**
 * The lines in the asked order. `club` keeps the order they came in — the fetch's own, featured
 * first, then soonest (§113) — and every other order breaks a tie on it, so equal lines never
 * swap places between two loads. A title compares in the reader's language (`ș` after `s`).
 */
export function sortEventLines<T>(lines: readonly T[], sortable: (line: T) => SortableLine, query: EventListQuery, locale: string): T[] {
  if (query.sort === "club") return [...lines];
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const sign = query.dir === "asc" ? 1 : -1;
  const compare = (a: SortableLine, b: SortableLine): number => {
    switch (query.sort) {
      case "date":
        return a.startsAt.getTime() - b.startsAt.getTime();
      case "title":
        return collator.compare(a.title, b.title);
      default:
        return a.entries - b.entries;
    }
  };
  return lines
    .map((line, index) => ({ line, index, key: sortable(line) }))
    .sort((a, b) => sign * compare(a.key, b.key) || a.index - b.index)
    .map(({ line }) => line);
}
