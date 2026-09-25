import Box from "@mui/material/Box";
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
import {
  activeFilterCount,
  listingFilterKey,
  listingFilterQuery,
  matchesListingFilter,
  offeredFilters,
  offersAnything,
  parseListingFilter,
  type ListingFilter,
} from "@/modules/events/domain/listing-filter";
import { clubNightEvent } from "@/modules/events/night-event";
import type { PublicEvent } from "@/modules/events/repository";
import ListingFilterPanel from "@/modules/events/ui/ListingFilterPanel";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { monthRange, parseMonth, parseYear, yearRange } from "@/modules/events/domain/calendar";
import { cachedPublishedEventsBetween } from "@/modules/public-cache/reads";
import CalendarSection from "@/modules/events/ui/CalendarSection";
import type { CalendarLayout, CalendarView } from "@/modules/events/ui/EventCalendar";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import Wordmark from "@/shared/ui/Wordmark";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    month?: string | string[];
    year?: string | string[];
    type?: string | string[];
    view?: string | string[];
    partner?: string | string[];
    surface?: string | string[];
    difficulty?: string | string[];
    distance?: string | string[];
    cost?: string | string[];
    night?: string | string[];
  }>;
};

/** Whether a date is a night event (§394), for the filter's box — the answer its own entry's tooltip gives. */
const isNight = (event: PublicEvent) => clubNightEvent(event).night;

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
      (§342). The "Lună" pill on the plain page links to `?month=<this month>`, which is this
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
  const searched = await searchParams;
  const { month: monthParam, year: yearParam, view: viewParam } = searched;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Events");
  const now = new Date();

  // The same readings of the address the listing makes (§89, §116, §137, §NNN), so a link that
  // was in somebody's history still means what it meant: the filters — `?type=RACE` and
  // `?partner=1` among them — and the layout, all kept through the month's own links.
  const filter = parseListingFilter(searched);
  const layout: CalendarLayout = (Array.isArray(viewParam) ? viewParam[0] : viewParam) === "list" ? "list" : "grid";
  const query: Record<string, string | string[]> = {
    ...listingFilterQuery(filter),
    ...(layout === "list" ? { view: "list" } : {}),
  };
  const year = parseYear(yearParam, now, CLUB_TIME_ZONE);
  const view: CalendarView = year ? { kind: "year", year } : { kind: "month", month: parseMonth(monthParam, now, CLUB_TIME_ZONE) };
  const range = view.kind === "year" ? yearRange(view.year, CLUB_TIME_ZONE) : monthRange(view.month, CLUB_TIME_ZONE);

  /*
    Keyed by what is actually being shown (§281): a month, a year, and the language. Two months
    are two answers, and a copy of March must never be served as a copy of April.

    The rows are kept and cached whole, and filtered after the read (§NNN). The filter used to
    run inside the loader, so the last good copy of a month was whichever filter had last read
    it — a copy of "races only" could answer an unfiltered visit while the database was away.
  */
  const key = `calendar:${locale}:${view.kind === "year" ? view.year : view.month}`;
  // From the public cache (§333): the range is the key, and an event save expires it.
  const period = readWithLastGood(key, () => cachedPublishedEventsBetween(locale, range.from, range.to), now);
  const events = period.then((read) => ({ ...read, value: read.value.filter((event) => matchesListingFilter(event, filter, isNight)) }));
  // The calendar's own panel (§NNN): what it offers is read off the period on view, the rows the
  // filter narrows here — the same rule the listing applies to its own rows.
  const monthOrYear: Record<string, string> =
    view.kind === "year" ? { year: String(view.year) } : { month: `${view.month.year}-${String(view.month.month).padStart(2, "0")}` };

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {/* The kit-face wordmark heads this page as it heads the listing — the owner, 2026-09-22:
          "trebuie sa vad acest scris frumos cu Brasov Runners si pe pagina de contact si pe cea
          de calendar" (`DECISIONS.md` §292). A
          paragraph that is an image to assistive technology, so the heading below stays the
          page's one `<h1>`; the font is the layout's, already loaded for every page. */}
      <Wordmark />

      <Typography variant="h1" gutterBottom sx={{ mt: 1, ...headingRule }}>
        {t("calendar.pageTitle")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.gapSm, sm: 2 } }}>
        {t("calendar.pageIntro")}
      </Typography>

      <Suspense fallback={null}>
        <CalendarStaleNotice events={events} />
      </Suspense>

      <Suspense fallback={null}>
        <CalendarFilters
          locale={locale}
          filter={filter}
          rows={period.then((read) => read.value)}
          keep={{ ...monthOrYear, ...(layout === "list" ? { view: "list" } : {}) }}
        />
      </Suspense>

      <CalendarSection
        locale={locale}
        view={view}
        layout={layout}
        filterKey={listingFilterKey(filter)}
        query={query}
        now={now}
        events={events.then((read) => read.value)}
      />
    </Container>
  );
}

/**
 * The listing's filter panel on the calendar (§NNN): the same button, the same boxes, the same
 * address — so "races on a trail" is a month of races on a trail, not only a list of cards. It
 * offers what would narrow the period on view, and keeps the month or year and the layout.
 */
async function CalendarFilters({
  locale,
  filter,
  rows,
  keep,
}: {
  locale: "ro" | "en";
  filter: ListingFilter;
  rows: Promise<PublicEvent[]>;
  keep: Record<string, string>;
}) {
  const offer = offeredFilters(await rows, filter, isNight);
  if (!offersAnything(offer) && activeFilterCount(filter) === 0) return null;
  return (
    <Box sx={{ mb: 1 }}>
      <ListingFilterPanel locale={locale} pathname="/calendar" filter={filter} offer={offer} keep={keep} />
    </Box>
  );
}

/** The "last copy" line for the calendar, once its month has settled (§281). */
async function CalendarStaleNotice({ events }: { events: Promise<Resilient<unknown>> }) {
  return <LastGoodNotice read={await events} />;
}
