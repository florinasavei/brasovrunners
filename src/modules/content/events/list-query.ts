import { groupSeries } from "@/modules/events/domain/series";
import { foldForSearch } from "@/modules/registrations/country-search";

/**
 * The backoffice events list's own state (§527): a search, a state and an order, read from the
 * address and written back to it, and nowhere else — the model is the public listing's filters
 * (§413, `events/domain/listing-filter.ts`): a GET form with no script writes these parameters,
 * every link the server builds carries them, and a hand-edited value falls back rather than
 * refusing (`admin-list-query.ts`'s rule) — `?state=Încheiate`, the label typed for the key, is
 * the default list, never an error. Pure — the clock is the caller's `now`.
 *
 * The list opens on «Viitoare» (§555, amending §527 — the owner, 2026-09-29: «by default aici
 * ar trebui să fie filtrate evenimentele viitoare»): an address with no `state` is `UPCOMING`,
 * and the whole list is an explicit choice, «Toate», which writes `state=ALL` into the address.
 *
 * - `q`: every word must appear, accents and case ignored (`foldForSearch`, §463), in a title,
 *   page address or place name in either language.
 * - `state`: `UPCOMING` (to come, neither cancelled nor completed); `PAST` (started or marked
 *   `COMPLETED`; a cancelled date is never «Încheiate»); the editorial states, `IN_REVIEW`
 *   included so such a date is findable; `CANCELLED` (§331).
 * - `sort`: `date-near` (default: upcoming soonest first, then past most recent first),
 *   `date-old`, `title-asc`/`title-desc` in the reader's collation, `state` (editorial order, then
 *   cancelled, then completed). Ties break on `date-near`, then fetch order.
 *
 * The filter narrows dates before they are grouped into a series (§113), so a series line shows
 * (and its tick selects) only the matching dates; a line sorts by its `next` date.
 */

export const EVENT_LIST_STATES = ["UPCOMING", "PAST", "DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED", "CANCELLED"] as const;
export type EventListState = (typeof EVENT_LIST_STATES)[number];

/** «Toate»: nothing narrows the dates. Its own value, since the empty address means «Viitoare» (§555). */
export const EVENT_LIST_ALL = "ALL";
export type EventListStateChoice = EventListState | typeof EVENT_LIST_ALL;

/** What the list shows with no `state` in the address (§555): the dates still to come. */
export const DEFAULT_EVENT_LIST_STATE: EventListStateChoice = "UPCOMING";

export const EVENT_LIST_SORTS = ["date-near", "date-old", "title-asc", "title-desc", "state"] as const;
export type EventListSort = (typeof EVENT_LIST_SORTS)[number];

export const DEFAULT_EVENT_LIST_SORT: EventListSort = "date-near";

/** Longer than any title anybody types; a pasted paragraph is cut, not refused. */
export const MAX_EVENT_LIST_QUERY_LENGTH = 100;

export type EventListQuery = {
  /** As typed, trimmed and cut — what the search box shows back. */
  q: string;
  state: EventListStateChoice;
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
  const state: EventListStateChoice =
    stateRaw === EVENT_LIST_ALL ? EVENT_LIST_ALL : (EVENT_LIST_STATES.find((value) => value === stateRaw) ?? DEFAULT_EVENT_LIST_STATE);
  const sortRaw = first(params.sort);
  const sort = EVENT_LIST_SORTS.find((value) => value === sortRaw) ?? DEFAULT_EVENT_LIST_SORT;
  return { q, state, sort };
}

/**
 * Whether a search or a state narrows the list — the count line «N din M evenimente» shows. The
 * default «Viitoare» narrows it too, so the plain list says «3 din 5 evenimente» (§555).
 */
export function eventListNarrowed(query: EventListQuery): boolean {
  return query.q !== "" || query.state !== EVENT_LIST_ALL;
}

/** Whether anything differs from the plain list («Viitoare», nearest first) — «Șterge filtrele» shows. */
export function eventListQueryInUse(query: EventListQuery): boolean {
  return query.q !== "" || query.state !== DEFAULT_EVENT_LIST_STATE || query.sort !== DEFAULT_EVENT_LIST_SORT;
}

/**
 * The state as query parameters, only what differs from the default, so the plain list is the
 * plain address. `AdminTable`'s links build on it.
 */
export function eventListParams(query: EventListQuery): Record<string, string | undefined> {
  return {
    q: query.q || undefined,
    state: query.state === DEFAULT_EVENT_LIST_STATE ? undefined : query.state,
    sort: query.sort === DEFAULT_EVENT_LIST_SORT ? undefined : query.sort,
  };
}

/** The page sizes `parseListQuery` offers; 100 is the events list's default and never written. */
const BACK_PER_PAGE = ["25", "50"];

/**
 * The list's address carried back through a Server Action's hidden `back` (§527), so the redirect
 * returns to the same filter and page. Parsed like the address: only the list's own validated keys
 * survive, never an outcome flag or another path. Empty for the plain list.
 */
export function eventListBack(raw: string | Record<string, Raw>): string {
  const params: Record<string, Raw> = {};
  if (typeof raw === "string") {
    for (const [key, value] of new URLSearchParams(raw)) if (!(key in params)) params[key] = value;
  } else Object.assign(params, raw);
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(eventListParams(parseEventListQuery(params)))) if (value !== undefined) out.set(key, value);
  const dir = first(params.dir);
  if (dir === "asc" || dir === "desc") out.set("dir", dir);
  const page = Number(first(params.page));
  if (Number.isInteger(page) && page > 1) out.set("page", String(page));
  const perPage = first(params.perPage);
  if (perPage !== undefined && BACK_PER_PAGE.includes(perPage)) out.set("perPage", perPage);
  return out.toString();
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

function matchesState(event: ListedEvent, state: EventListStateChoice, now: Date): boolean {
  const started = event.startsAt.getTime() < now.getTime();
  switch (state) {
    case EVENT_LIST_ALL:
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

/** The lines in the asked order; ties break on the nearest date, then input order, so equal lines never swap between loads. */
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

/** The whole list's arithmetic in page order: narrow the dates, group into lines (§113), pick each `next`, sort. */
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
