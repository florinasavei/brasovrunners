import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { CLUB_TIME_ZONE, DATE_FORMATS } from "./dates";
import { routing } from "./routing";

// Per-request i18n environment. The `[locale]` layout has already returned 404 for an unknown
// locale (BR-REQ-040-02), so the fallback below only ever applies to requests that carry no
// locale segment at all, such as the root `/` before the proxy redirects it.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // AGENTS.md §3.1: every date and time the site shows is Brașov local time.
    timeZone: CLUB_TIME_ZONE,
    // The named date formats (§349): `format.dateTime(date, "dayLong")` in a Server Component.
    // A date that starts a line goes through `formatDay` instead, which capitalises it.
    formats: { dateTime: DATE_FORMATS },
  };
});
