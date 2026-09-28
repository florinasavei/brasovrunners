import { groupSeries } from "@/modules/events/domain/series";
import { foldForSearch } from "@/modules/registrations/country-search";

/**
 * The backoffice events list's own state (§NNN): a search, a state and an order, read from the
 * address and written back to it, and nowhere else — the model is the public listing's filters
 * (§413, `events/domain/listing-filter.ts`): a GET form with no script writes these parameters,
 * every link the server builds carries them, and a hand-edited value falls back rather than
 * refusing (`admin-list-query.ts`'s rule) — `?state=Încheiate`, the label typed for the key, is
 * the whole list, never an error. Pure — the clock is the caller's `now`.
 *
 * - `q` — words, each of which must appear (accents and case ignored, the pickers' own
 *   `foldForSearch`, §463) in a title, a page address or a place name, in either language:
 *   «tampa» finds «Tâmpa».
 * - `state` — what an organizer asks of the list, in the owner's words:
 *   - `UPCOMING` «Viitoare» — a date still to come that is neither called off nor marked done;
 *   - `PAST` «Încheiate» — a date that is over: its start has passed, or the club marked it
 *     `COMPLETED`, either one; a called-off date is «Anulate», never «Încheiate», even once
 *     its day has gone;
 *   - `DRAFT` «Ciorne», `IN_REVIEW` «În verificare», `PUBLISHED` «Publicate», `ARCHIVED`
 *     «Arhivate» — the editorial state. «În verificare» is kept on purpose: it is a state the
 *     editor sets, and a date in it would otherwise be findable only by scrolling;
 *   - `CANCELLED` «Anulate» — the event's own state since §331, which a published race keeps
 *     when it is called off.
 * - `sort` — one select, one parameter: `date-near` «Data (cele mai apropiate)», the default —
 *   the dates still to come soonest first, then the past, the most recent first, so the next
 *   race is at the top and last week's run right under the future; `date-old` «Data (cele mai
 *   vechi)» — the oldest first, the whole list ascending; `title-asc` / `title-desc` «Nume A–Z» /
 *   «Nume Z–A» in the reader's language (`ș` after `s`); `state` «Stare» — the editorial state
 *   in the editor's order (Ciornă, În verificare, Publicat, Arhivat), then the called-off, then
 *   the completed. Every order breaks a tie on `date-near`, then on the fetch's order.
 *
 * The club's former default — featured first, then soonest — is no longer the list's order: the
 * brief's default is the nearest date, and a featured race is at most a few weeks out, so it sits
 * at or near the top anyway; the star still marks it on its line.
 *
 * The filter narrows the *dates* before they are grouped into a series (§113), so a series
 * filtered to «Ciorne» is the line of its draft dates, and «Viitoare» folds only the dates still
 * to come — the tick then selects exactly the dates the line shows. A series line sorts by its
 * `next` date: the first still to come, else its last.
 */

export const EVENT_LIST_STATES = ["UPCOMING", "PAST", "DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED", "CANCELLED"] as const;
export type EventListState = (typeof EVENT_LIST_STATES)[number];

export const EVENT_LIST_SORTS = ["date-near", "date-old", "title-asc", "title-desc", "state"] as const;
export type EventListSort = (typeof EVENT_LIST_SORTS)[number];

export const DEFAULT_EVENT_LIST_SORT: EventListSort = "date-near";

/** Longer than any title anybody types; a pasted paragraph is cut, not refused. */
export const MAX_EVENT_LIST_QUERY_LENGTH = 100;

export type EventListQuery = {
  /** As typed, trimmed and cut — what the search box shows back. */
  q: string;
  state: EventListState | null;
  sort: EventListSort;
};

type Raw = string | string[] | undefined;

/** A repeated key (`?state=A&state=B`) arrives as a list at runtime: the first one counts. */
function first(value: Raw): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseEventListQuery(params: Record<string, Raw>): EventListQuery {
  const q = (first(params.q) ?? "").trim().slice(0, MAX_EVENT_LIST_QUERY_LENGTH);
  const stateRaw = first(params.state);
  const state = EVENT_LIST_STATES.find((value) => value === stateRaw) ?? null;
  const sortRaw = first(params.sort);
  const sort = EVENT_LIST_SORTS.find((value) => value === sortRaw) ?? DEFAULT_EVENT_LIST_SORT;
  return { q, state, sort };
}

/** Whether a search or a state narrows the list — the count line «N din M evenimente» shows. */
export function eventListNarrowed(query: EventListQuery): boolean {
  return query.q !== "" || query.state !== null;
}

/** Whether anything narrows or reorders the list — «Șterge filtrele» shows. */
export function eventListQueryInUse(query: EventListQuery): boolean {
  return eventListNarrowed(query) || query.sort !== DEFAULT_EVENT_LIST_SORT;
}

/**
 * The state as query parameters, only what differs from the default, so the plain list is the
 * plain address and a bookmarked one says what it filters. `AdminTable`'s links build on it.
 */
export function eventListParams(query: EventListQuery): Record<string, string | undefined> {
  return {
    q: query.q || undefined,
    state: query.state ?? undefined,
    sort: query.sort === DEFAULT_EVENT_LIST_SORT ? undefined : query.sort,
  };
}

type EditorialStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
type EventStatus = "SCHEDULED" | "CANCELLED" | "COMPLETED";

/** What a search and a filter read of one date. */
export type ListedEvent = {
  startsAt: Date;
  editorialStatus: EditorialStatus;
  eventStatus: EventStatus;
  locationName: string | null;
};

export type ListedTranslation = { locale?: string; title: string; slug: string; locationName: string | null };

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
  const started = event.startsAt.getTime() < now.getTime();
  switch (state) {
    case null:
      return true;
    case "CANCELLED":
      return event.eventStatus === "CANCELLED";
    case "UPCOMING":
      return !started && event.eventStatus === "SCHEDULED";
    case "PAST":
      return event.eventStatus === "COMPLETED" || (started && event.eventStatus !== "CANCELLED");
    default:
      return event.editorialStatus === state;
  }
}

/** What an order reads of one line of the list: its `next` date's. */
export type SortableLine = { title: string; startsAt: Date; editorialStatus: EditorialStatus; eventStatus: EventStatus };

const EDITORIAL_RANK: Record<EditorialStatus, number> = { DRAFT: 0, IN_REVIEW: 1, PUBLISHED: 2, ARCHIVED: 3 };

/** «Stare»: the editorial states in the editor's order, then the called-off, then the completed. */
function stateRank(line: SortableLine): number {
  if (line.eventStatus === "CANCELLED") return 4;
  if (line.eventStatus === "COMPLETED") return 5;
  return EDITORIAL_RANK[line.editorialStatus];
}

/** The nearest first: what is still to come soonest first, then the past, most recent first. */
function compareNear(a: SortableLine, b: SortableLine, now: number): number {
  const aAhead = a.startsAt.getTime() >= now;
  const bAhead = b.startsAt.getTime() >= now;
  if (aAhead !== bAhead) return aAhead ? -1 : 1;
  const byStart = a.startsAt.getTime() - b.startsAt.getTime();
  return aAhead ? byStart : -byStart;
}

/**
 * The lines in the asked order. Every order breaks a tie on the nearest date and then on the
 * order the lines came in, so equal lines never swap places between two loads.
 */
export function sortEventLines<T>(
  lines: readonly T[],
  sortable: (line: T) => SortableLine,
  query: Pick<EventListQuery, "sort">,
  locale: string,
  now: Date,
): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const at = now.getTime();
  const compare = (a: SortableLine, b: SortableLine): number => {
    switch (query.sort) {
      case "date-old":
        return a.startsAt.getTime() - b.startsAt.getTime();
      case "title-asc":
        return collator.compare(a.title, b.title) || compareNear(a, b, at);
      case "title-desc":
        return collator.compare(b.title, a.title) || compareNear(a, b, at);
      case "state":
        return stateRank(a) - stateRank(b) || compareNear(a, b, at);
      default:
        return compareNear(a, b, at);
    }
  };
  return lines
    .map((line, index) => ({ line, index, key: sortable(line) }))
    .sort((a, b) => compare(a.key, b.key) || a.index - b.index)
    .map(({ line }) => line);
}

/** What the list reads of one fetched date: the event and its translations. */
export type ListedRow = {
  event: ListedEvent & { id: string; type: string };
  translations: readonly ListedTranslation[];
};

/** The title a line shows and sorts by: the reader's language's, else the first there is. */
function titleOf(row: ListedRow, locale: string): string {
  return (row.translations.find((translation) => translation.locale === locale) ?? row.translations[0])?.title ?? row.event.id;
}

/** The series key's title: the first translation's, as the list has always grouped (§113). */
const groupTitleOf = (row: ListedRow) => row.translations[0]?.title ?? row.event.id;

function groupRows<T extends ListedRow>(rows: readonly T[]) {
  return groupSeries(rows.map((row) => ({ row, type: row.event.type, title: groupTitleOf(row), startsAt: row.event.startsAt })));
}

/** How many lines the list has with nothing narrowing it — the M of «N din M evenimente». */
export function countEventLines(rows: readonly ListedRow[]): number {
  return groupRows(rows).length;
}

export type ArrangedLine<T> = {
  key: string;
  /** Soonest first. */
  members: T[];
  /** The line's date: the first still to come, else the last. */
  next: T;
};

/**
 * The whole list's arithmetic, in the order the page draws it: narrow the dates, group them into
 * lines (§113), pick each line's `next`, order the lines. The page decorates the result.
 */
export function arrangeEventList<T extends ListedRow>(rows: readonly T[], query: EventListQuery, now: Date, locale: string): ArrangedLine<T>[] {
  const lines = groupRows(rows.filter((row) => matchesEventList(row.event, row.translations, query, now))).map((series) => {
    const members = series.members.map((member) => member.row);
    const next = members.find((member) => member.event.startsAt.getTime() >= now.getTime()) ?? members[members.length - 1];
    return { key: series.key, members, next };
  });
  return sortEventLines(
    lines,
    ({ next }) => ({
      title: titleOf(next, locale),
      startsAt: next.event.startsAt,
      editorialStatus: next.event.editorialStatus,
      eventStatus: next.event.eventStatus,
    }),
    query,
    locale,
    now,
  );
}
