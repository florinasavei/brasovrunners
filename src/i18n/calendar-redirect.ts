import { legacyCalendarAddress } from "@/modules/events/domain/calendar-path";
import { CLUB_TIME_ZONE } from "./dates";
import { type Locale, routing } from "./routing";

/**
 * The calendar's old addresses, sent on by the proxy before anything renders (§NNN).
 *
 * Until this change a month was `/ro/calendar?month=2026-10`, a year `?year=2027`, the list
 * `?view=list`. They live in bookmarks, shared links and search results; each now answers a 308
 * to the same period at its own path (`/ro/calendar/2026-10`), the filters kept, so it meets the
 * static period page the CDN answers rather than a render. The calendar's path is read from
 * `routing.pathnames`, like `root-redirect.ts`, so renaming it in one place cannot leave the old
 * addresses pointing at a 404.
 */

/** The bare calendar's own path in one locale: `/ro/calendar`, `/en/calendar`. */
export function calendarPath(locale: Locale): string {
  const localized = routing.pathnames["/calendar"];
  return `/${locale}${typeof localized === "string" ? localized : localized[locale]}`;
}

/**
 * Where an old calendar address goes, or null: a path that is not the bare calendar, or a query
 * that names no `month`, `year` or `view` (a filter alone is still the bare calendar's twin).
 */
export function legacyCalendarTarget(pathname: string, search: URLSearchParams, now: Date): string | null {
  const trimmed = pathname.replace(/\/$/, "");
  const locale = routing.locales.find((candidate) => calendarPath(candidate) === trimmed);
  if (!locale) return null;
  return legacyCalendarAddress(calendarPath(locale), search, now, CLUB_TIME_ZONE);
}
