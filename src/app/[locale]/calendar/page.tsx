import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { readWithLastGood, type Resilient } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { routing } from "@/i18n/routing";
import { EVENT_TYPES } from "@/modules/events/domain/event-type";
import { CLUB_TIME_ZONE } from "@/modules/jobs/quiet-hours";
import { monthRange, parseMonth, parseYear, yearRange } from "@/modules/events/domain/calendar";
import { cachedPublishedEventsBetween } from "@/modules/public-cache/reads";
import CalendarSection from "@/modules/events/ui/CalendarSection";
import type { CalendarLayout, CalendarView } from "@/modules/events/ui/EventCalendar";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import Wordmark from "@/shared/ui/Wordmark";
import { PAGE_WIDTH } from "@/theme/brand";
import { headingRule } from "@/theme/surfaces";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string | string[]; year?: string | string[]; type?: string | string[]; view?: string | string[] }>;
};

/**
 * The club's calendar, on a page of its own (`DECISIONS.md` §251; the owner: "the calendar
 * should be a tab, after events, and not show on the homepage").
 *
 * It lived on the listing, which is the site's front page, above the events themselves — so the
 * first thing a visitor met was a grid of squares rather than the next run. The grid is what
 * somebody planning a month wants and it is worth its own address; the front page is for "what
 * is on next".
 *
 * Everything the section does is unchanged (`CalendarSection`): the month or the year the
 * address names, the grid or the list, and the three doors into a reader's own calendar. The
 * query is started here and awaited nowhere in this function, so the wordmark, the heading and
 * every control reach the browser before the database answers (§166).
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Events" });
  return {
    title: t("calendar.pageTitle"),
    description: t("calendar.pageIntro"),
    /*
      One calendar page per language, whatever month, year, layout or kind the address names
      (§NNN). The "Lună" pill on the plain page links to `?month=<this month>`, which is this
      very page under a second address, and neither declared a canonical — the likeliest pair
      behind Search Console's "duplicate without user-selected canonical". Another month is the
      same events' own pages, arranged; the event pages are what is indexed, and every month's
      links are still followed.
    */
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/calendar")),
  };
}

export default async function CalendarPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { month: monthParam, year: yearParam, type: typeParam, view: viewParam } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Events");
  const now = new Date();

  // The same three readings of the address the listing made (§89, §116, §137), so a link that
  // was in somebody's history still means what it meant.
  const typeRaw = Array.isArray(typeParam) ? typeParam[0] : typeParam;
  const type = EVENT_TYPES.find((candidate) => candidate === typeRaw);
  const layout: CalendarLayout = (Array.isArray(viewParam) ? viewParam[0] : viewParam) === "list" ? "list" : "grid";
  const query: Record<string, string> = { ...(type ? { type } : {}), ...(layout === "list" ? { view: "list" } : {}) };
  const year = parseYear(yearParam, now, CLUB_TIME_ZONE);
  const view: CalendarView = year ? { kind: "year", year } : { kind: "month", month: parseMonth(monthParam, now, CLUB_TIME_ZONE) };
  const range = view.kind === "year" ? yearRange(view.year, CLUB_TIME_ZONE) : monthRange(view.month, CLUB_TIME_ZONE);

  /*
    Keyed by what is actually being shown (§281): a month, a year, and the language. Two months
    are two answers, and a copy of March must never be served as a copy of April.
  */
  const key = `calendar:${locale}:${view.kind === "year" ? view.year : view.month}`;
  const events = readWithLastGood(
    key,
    // From the public cache (§333): the range is the key, and an event save expires it.
    () =>
      cachedPublishedEventsBetween(locale, range.from, range.to).then((rows) =>
        rows.filter((event) => !type || event.type === type),
      ),
    now,
  );

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
      {/* The kit-face wordmark heads this page as it heads the listing — the owner, 2026-09-22:
          "trebuie sa vad acest scris frumos cu Brasov Runners si pe pagina de contact si pe cea
          de calendar" (`DECISIONS.md` §292). A
          paragraph that is an image to assistive technology, so the heading below stays the
          page's one `<h1>`; the font is the layout's, already loaded for every page. */}
      <Wordmark />

      <Typography variant="h1" gutterBottom sx={{ mt: 1, ...headingRule }}>
        {t("calendar.pageTitle")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        {t("calendar.pageIntro")}
      </Typography>

      <Suspense fallback={null}>
        <CalendarStaleNotice events={events} />
      </Suspense>

      <CalendarSection locale={locale} view={view} layout={layout} type={type} query={query} now={now} events={events.then((read) => read.value)} />
    </Container>
  );
}

/** The "last copy" line for the calendar, once its month has settled (§281). */
async function CalendarStaleNotice({ events }: { events: Promise<Resilient<unknown>> }) {
  return <LastGoodNotice read={await events} />;
}
