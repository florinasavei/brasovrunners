/**
 * The URL contract every backoffice list shares: which page, how many rows, sorted by what.
 *
 * All of it lives in the query string, and that is the point rather than a convenience. A
 * filtered, sorted, paged list is a place an organizer can bookmark, reload after acting on a
 * row, and send to somebody else; a grid holding the same state in client memory can do none of
 * those, and loses all of it the moment a Server Action redirects back. It also means sorting
 * and paging are ordinary links, so the lists keep working with JavaScript switched off.
 *
 * Nothing here touches React. It is the piece with the sharp edges — an unvalidated sort key is
 * a column name on its way to an `ORDER BY` — so it is a plain module with its own tests.
 */

/** How a caller declares what may be sorted on. The keys are the only ones ever honoured. */
export type SortableKeys = readonly string[];

export type ListQuery = {
  page: number;
  perPage: number;
  /** Always one of the caller's own keys, never a string that arrived from outside. */
  sort: string;
  dir: "asc" | "desc";
  /** Ready for the repository. */
  offset: number;
  limit: number;
};

/** 25 rows is about a screen and a half on a laptop, and a short scroll on a phone. */
export const DEFAULT_PER_PAGE = 25;

/**
 * The sizes the page-size control offers. Capped at 100 deliberately: the whole reason
 * pagination is server-side is that a season of registrations must never all arrive in one
 * response, and a page size somebody can type into the URL would give that back.
 */
export const PER_PAGE_OPTIONS = [25, 50, 100] as const;

const MAX_PER_PAGE = PER_PAGE_OPTIONS[PER_PAGE_OPTIONS.length - 1];

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  // `Number` rather than `parseInt`: `parseInt("12abc")` is 12, which silently accepts a
  // malformed page number instead of falling back to a sane one.
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * Read the list state out of a request's query string.
 *
 * Every value is clamped or replaced rather than refused: a backoffice list that answers 400
 * because somebody hand-edited a URL is a list that looks broken. An unknown sort key falls
 * back to the caller's default, which is what keeps an arbitrary string out of the query.
 */
export function parseListQuery(
  params: Record<string, string | undefined>,
  options: {
    sortable: SortableKeys;
    defaultSort: string;
    defaultDir?: "asc" | "desc";
    defaultPerPage?: number;
  },
): ListQuery {
  const { sortable, defaultSort, defaultDir = "desc", defaultPerPage = DEFAULT_PER_PAGE } = options;

  const requestedSort = params.sort;
  const sort = requestedSort && sortable.includes(requestedSort) ? requestedSort : defaultSort;

  const dir = params.dir === "asc" ? "asc" : params.dir === "desc" ? "desc" : defaultDir;

  const page = toPositiveInt(params.page, 1);
  const perPage = Math.min(toPositiveInt(params.perPage, defaultPerPage), MAX_PER_PAGE);

  return { page, perPage, sort, dir, offset: (page - 1) * perPage, limit: perPage };
}

/** How many pages `total` rows make at this size — at least one, so an empty list still has a page 1. */
export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

/**
 * The same query string with some keys changed, and `page` reset unless it is the key being
 * changed.
 *
 * Resetting is the behaviour a person expects and the one that is easy to get wrong: filtering
 * from page 4 of an unfiltered list to a filtered list with two pages would otherwise land on a
 * page 4 that does not exist and read as "no results".
 *
 * An empty string or `undefined` removes the key, so "all events" is an absent parameter rather
 * than `eventId=`, and the bookmarked URL says what it filters.
 */
export function buildListHref(
  basePath: string,
  current: Record<string, string | undefined>,
  patch: Record<string, string | number | undefined>,
): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value === undefined || value === "") continue;
    next.set(key, String(value));
  }

  if (!Object.prototype.hasOwnProperty.call(patch, "page")) next.delete("page");

  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * The link a sortable column header points at: the same column flips direction, a new column
 * starts at the direction it is most useful in.
 *
 * A name starts A→Z and a date starts newest-first, which is why the default direction is the
 * caller's to state rather than a constant here.
 */
export function sortHref(
  basePath: string,
  current: Record<string, string | undefined>,
  query: ListQuery,
  columnKey: string,
  defaultDir: "asc" | "desc" = "asc",
): string {
  const isCurrent = query.sort === columnKey;
  const dir = isCurrent ? (query.dir === "asc" ? "desc" : "asc") : defaultDir;
  return buildListHref(basePath, current, { sort: columnKey, dir });
}

/** What a sorted column tells assistive technology (`aria-sort` takes these exact words). */
export function ariaSortFor(query: ListQuery, columnKey: string): "ascending" | "descending" | "none" {
  if (query.sort !== columnKey) return "none";
  return query.dir === "asc" ? "ascending" : "descending";
}
