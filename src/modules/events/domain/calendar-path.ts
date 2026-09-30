import { currentMonth, monthParam, parseMonth, parseYear, type YearMonth, YEARS_EITHER_WAY } from "./calendar";

/**
 * The calendar's period lives in the address's path, never in its query (§NNN, amending §116,
 * §137 and §549): `/ro/calendar` is this month, `/ro/calendar/2026-10` October,
 * `/ro/calendar/2026-10/list` October as a list, `/ro/calendar/2026` the year. The filters stay in
 * the query (`?type=RACE`), on the period's own path.
 *
 * Why the path. The bare calendar is a static page the CDN answers (§549), and until this change
 * another month was the same address with `?month=` that the proxy rewrote to the live twin. Next's
 * router takes a static page's prefetched copy to be the answer for every query of its address — a
 * static page cannot read the query, so to the router it cannot depend on it — and a rewrite by the
 * query breaks exactly that. On Vercel, once the header's «Calendar» link had prefetched the bare
 * page, pressing › put `?month=2026-10` in the address and asked the server nothing: September
 * stayed on screen, and the next press computed October again from September's links. A month of
 * its own path is a page of its own to the router, and a static page of its own to the CDN — made
 * on its first visit, kept like the bare one — so a month is also a CDN answer now, not a function.
 *
 * Pure, so the addresses are tested without Next: the pages, the header, the picker, the swipe
 * and the proxy's redirect of the old `?month=` addresses all build them here.
 */

/** What the calendar shows: one month or one year (§116). `EventCalendar`'s `CalendarView` is this type. */
export type CalendarPeriod = { kind: "month"; month: YearMonth } | { kind: "year"; year: number };

/** The month as a grid or as a list (§137). `EventCalendar`'s `CalendarLayout` is this type. */
export type CalendarLayoutName = "grid" | "list";

/** The last path segment of a month shown as a list. The same word in both languages, like `/calendar`. */
export const LIST_SEGMENT = "list";

/** The query keys that named the period before it moved into the path; the proxy sends them on (`legacyCalendarAddress`). */
export const LEGACY_PERIOD_KEYS = ["month", "year", "view"] as const;

const MONTH_SEGMENT = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_SEGMENT = /^\d{4}$/;

/** The path segments after `/calendar` for a period and a layout. A year has no layout: it is always its agenda. */
export function calendarSegments(view: CalendarPeriod, layout: CalendarLayoutName): string[] {
  if (view.kind === "year") return [String(view.year)];
  return layout === "list" ? [monthParam(view.month), LIST_SEGMENT] : [monthParam(view.month)];
}

/**
 * The period and layout a path's segments name, or null for anything else — a malformed segment,
 * a year with a layout, a third segment, or a period more than `YEARS_EITHER_WAY` years from now
 * (the same bound the selects and the old `?month=` had). The page answers null with a 404.
 */
export function readCalendarSegments(
  segments: readonly string[],
  now: Date,
  timeZone: string,
): { view: CalendarPeriod; layout: CalendarLayoutName } | null {
  if (segments.length === 0 || segments.length > 2) return null;
  const [first, second] = segments;
  const thisYear = currentMonth(now, timeZone).year;
  const near = (year: number) => Math.abs(year - thisYear) <= YEARS_EITHER_WAY;
  const month = MONTH_SEGMENT.exec(first);
  if (month) {
    const ym: YearMonth = { year: Number(month[1]), month: Number(month[2]) };
    if (!near(ym.year)) return null;
    if (second === undefined) return { view: { kind: "month", month: ym }, layout: "grid" };
    return second === LIST_SEGMENT ? { view: { kind: "month", month: ym }, layout: "list" } : null;
  }
  if (YEAR_SEGMENT.test(first) && second === undefined && near(Number(first))) return { view: { kind: "year", year: Number(first) }, layout: "grid" };
  return null;
}

/** The kept query (the filters; a group ticked twice is an array) as a search string, without the "?". */
function searchOf(query: Record<string, string | string[]>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) for (const one of Array.isArray(value) ? value : [value]) search.append(name, one);
  return search.toString();
}

/**
 * The address of a period on the calendar: `basePath` is the calendar's own localized path
 * (`/ro/calendar`, from `getPathname`), `query` what it keeps (the filters).
 *
 * This month as a grid with nothing filtered is the bare page, the one the CDN already holds and
 * the one every link in the header names. Everything else spells its period in the path — this
 * month too, as soon as a filter or the list is on: a filtered address on the bare path would be
 * the bare page's query again, the case this module exists to end.
 */
export function calendarAddress(
  basePath: string,
  { view, layout, query = {}, thisMonth }: { view: CalendarPeriod; layout: CalendarLayoutName; query?: Record<string, string | string[]>; thisMonth: YearMonth },
): string {
  const search = searchOf(query);
  const bare = search === "" && layout === "grid" && view.kind === "month" && monthParam(view.month) === monthParam(thisMonth);
  const path = bare ? basePath : calendarPeriodPath(basePath, view, layout);
  return search ? `${path}?${search}` : path;
}

/** A period's own path, always spelled — the filter form's action, where the browser or the island appends the query. */
export function calendarPeriodPath(basePath: string, view: CalendarPeriod, layout: CalendarLayoutName): string {
  return `${basePath}/${calendarSegments(view, layout).join("/")}`;
}

/**
 * Where an old address goes (`?month=2026-10`, `?year=2027`, `?view=list`, in a bookmark, a
 * shared link or a search result): the same period on its path, every other key kept (the
 * filters), Next's `_rsc` dropped. Null when the query names none of the three, so the proxy
 * leaves the address alone. The old readings stand: `?year=` wins over `?month=`, a value that
 * is malformed or too far away is this month, and a year ignores `?view=`.
 */
export function legacyCalendarAddress(basePath: string, search: URLSearchParams, now: Date, timeZone: string): string | null {
  if (!LEGACY_PERIOD_KEYS.some((key) => search.has(key))) return null;
  const year = parseYear(search.get("year") ?? undefined, now, timeZone);
  const view: CalendarPeriod = year ? { kind: "year", year } : { kind: "month", month: parseMonth(search.get("month") ?? undefined, now, timeZone) };
  const layout: CalendarLayoutName = search.get("view") === "list" ? "list" : "grid";
  const query: Record<string, string[]> = {};
  for (const [name, value] of search) {
    if ((LEGACY_PERIOD_KEYS as readonly string[]).includes(name) || name === "_rsc") continue;
    (query[name] ??= []).push(value);
  }
  return calendarAddress(basePath, { view, layout, query, thisMonth: currentMonth(now, timeZone) });
}
