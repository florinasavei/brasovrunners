import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { routing } from "@/i18n/routing";
import {
  activeFilterCount,
  listingFilterQuery,
  matchesListingFilter,
  offeredFilters,
  offersAnything,
  parseListingFilter,
  type FilterFacts,
} from "@/modules/events/domain/listing-filter";
import { clubNightEvent } from "@/modules/events/night-event";
import { readRegistrationDoors } from "@/modules/events/ui/registration-door";
import type { PublicEvent } from "@/modules/events/repository";
import CalendarFilterSlot from "@/modules/events/ui/CalendarFilterSlot";
import ListingFilterPanel from "@/modules/events/ui/ListingFilterPanel";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { monthRange, parseMonth, parseYear, yearRange } from "@/modules/events/domain/calendar";
import { calendarPeriodPath, readCalendarSegments } from "@/modules/events/domain/calendar-path";
import { getPathname } from "@/i18n/navigation";
import { cachedPublishedEventsBetween } from "@/modules/public-cache/reads";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { nextWallMidnight } from "@/modules/events/domain/page-clock";
import CalendarIntroFold from "@/modules/events/ui/CalendarIntroFold";
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
  /**
   * The address's query — passed only by the live twins (`app/[locale]/live/calendar/…`), which
   * the proxy sends a visit naming a filter to (§549). This static route never reads Next's
   * `searchParams`: the bare calendar is this month, the same for everyone.
   */
  query?: Promise<CalendarQuery>;
  /**
   * The period's path segments — passed only by `calendar/[...period]/page.tsx` (§574):
   * `["2026-10"]`, `["2026-10", "list"]`, `["2026"]`. Absent, the page is the bare calendar: this
   * month as a grid (or, on the bare twin, what an old `?month=` still says, should one reach it
   * past the proxy's redirect).
   */
  period?: string[];
};

type CalendarQuery = {
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
  registration?: string | string[];
};

/**
 * Static at its bare address, made on its first visit and kept by the CDN (§549, amending §333):
 * made again on a write to the events it shows, on a door's change, at midnight (the month's "today"
 * and its turn), and at the latest after a day. A literal, as Next requires: it equals
 * `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const revalidate = 86400;

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
 * period's rows are one cached read (§333) the page awaits before it renders (§413, amending §166
 * here): the filter panel and the month itself are in the first HTML the server sends, so a
 * browser with scripts off can tick, press «Aplică» and read the narrowed month.
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
      (§342). The "Lună" pill on the plain page linked to `?month=<this month>`, which was this
      very page under a second address, and neither declared a canonical — the likeliest pair
      behind Search Console's "duplicate without user-selected canonical". Another month is the
      same events' own pages, arranged; the event pages are what is indexed. A period's own path
      (`/calendar/2026-10`, `/calendar/2026-10/list`, `/calendar/2026`, §574) is canonical to
      the bare calendar the same way, and robots.txt keeps crawlers off `/calendar/…`.
    */
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/calendar")),
  };
}

export default async function CalendarPage({ params, query: asked, period: segments }: Props) {
  const { locale } = await params;
  const searched: CalendarQuery = (await asked) ?? {};
  const { month: monthParam, year: yearParam, view: viewParam } = searched;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Events");
  const now = new Date();
  // This month, and today's square, are the day's: the static page is made again at midnight (§549).
  await holdPageUntil([nextWallMidnight(now, CLUB_TIME_ZONE)], now);

  // The period is the path's (§574): `/calendar/2026-10`, `/calendar/2026-10/list`, `/calendar/2026`.
  // Anything else under `/calendar/` is no page. The bare calendar is this month as a grid; its twin
  // still reads an old `?month=`, `?year=` or `?view=` should one reach it past the proxy's redirect.
  const fromPath = segments ? readCalendarSegments(segments, now, CLUB_TIME_ZONE) : null;
  if (segments && !fromPath) notFound();
  // The same readings of the address the listing makes (§89, §413), so a link that was in
  // somebody's history still means what it meant: the filters — `?type=RACE` and `?partner=1`
  // among them — kept through the month's own links.
  const filter = parseListingFilter(searched);
  const layout: CalendarLayout = fromPath ? fromPath.layout : (Array.isArray(viewParam) ? viewParam[0] : viewParam) === "list" ? "list" : "grid";
  const query: Record<string, string | string[]> = listingFilterQuery(filter);
  const year = fromPath ? null : parseYear(yearParam, now, CLUB_TIME_ZONE);
  const view: CalendarView = fromPath ? fromPath.view : year ? { kind: "year", year } : { kind: "month", month: parseMonth(monthParam, now, CLUB_TIME_ZONE) };
  const range = view.kind === "year" ? yearRange(view.year, CLUB_TIME_ZONE) : monthRange(view.month, CLUB_TIME_ZONE);

  /*
    Keyed by what is actually being shown (§281): a month, a year, and the language. Two months
    are two answers, and a copy of March must never be served as a copy of April.

    The rows are kept and cached whole, and filtered after the read (§413). The filter used to
    run inside the loader, so the last good copy of a month was whichever filter had last read
    it — a copy of "races only" could answer an unfiltered visit while the database was away.

    Awaited here, once (§413): the panel, the stale notice and the month all read this one value,
    and none of them sits behind a streamed boundary — a streamed region is revealed by a script,
    and the panel is a GET form that must work without one. With a script, a month or a filter is
    a soft navigation that keeps this page on screen until the next one is ready.
  */
  const key = `calendar:${locale}:${view.kind === "year" ? view.year : view.month}`;
  // From the public cache (§333): the range is the key, and an event save expires it.
  const period = await readWithLastGood(key, () => cachedPublishedEventsBetween(locale, range.from, range.to), now);
  // «Înscrieri deschise» is the page's own door (§413): one cached availability read per open
  // internal event in the period, nothing for any other row.
  const facts: FilterFacts<PublicEvent> = { night: isNight, door: await readRegistrationDoors(period.value, now) };
  const events = period.value.filter((event) => matchesListingFilter(event, filter, facts));
  // The calendar's own panel (§413): what it offers is read off the period on view, whole — the
  // same rule the listing applies to its own rows — and it keeps the month or year and the layout.
  const offer = offeredFilters(period.value, filter, facts);
  // The panel's form and chips go to the period's own path (§574), spelled even for this month:
  // a filter on the bare path would be the bare static page's query, which Next's router answers
  // from that page's prefetched copy without asking the server.
  const periodPath = calendarPeriodPath(getPathname({ locale, href: "/calendar" }), view, layout);

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {/* The kit-face wordmark heads this page as it heads the listing — the owner, 2026-09-22:
          "trebuie sa vad acest scris frumos cu Brasov Runners si pe pagina de contact si pe cea
          de calendar" (`DECISIONS.md` §292). A
          paragraph that is an image to assistive technology, so the heading below stays the
          page's one `<h1>`; the font is the layout's, already loaded for every page. */}
      <Wordmark />

      {/* On a phone the head is the H1 and a «?» (§487): the intro sentence moves into the «?»'s
          fold, with the two calendar links it promises, so the month starts a paragraph higher.
          The fold's panel is anchored to this row (`position: relative`). From `sm` the sentence
          stands under the heading as before and the «?» is not drawn — never both. Half the room
          above it on a phone (§569), where the wordmark is not drawn. */}
      <Box sx={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 0.5, mt: { xs: DENSITY.headGap, sm: 1 } }}>
        <Typography variant="h1" gutterBottom sx={headingRule}>
          {t("calendar.pageTitle")}
        </Typography>
        <Box sx={{ display: { xs: "block", sm: "none" } }}>
          <CalendarIntroFold locale={locale} baseUrl={env.APP_BASE_URL} />
        </Box>
      </Box>
      <Typography variant="body1" color="text.secondary" sx={{ display: { xs: "none", sm: "block" }, mb: { xs: DENSITY.gapSm, sm: 2 } }}>
        {t("calendar.pageIntro")}
      </Typography>

      {/* The "last copy" line (§281). */}
      <LastGoodNotice read={period} />

      {/* The listing's filter panel on the calendar (§413): the same button, the same boxes, the
          same address — so "races on a trail" is a month of races on a trail, not only a list of
          cards. Nothing to narrow and nothing ticked, it is held unseen rather than left out
          (§577): the arrows under it must not move when the next month has something to offer.
          The period is the path's (the calendar branch's §577), so the panel posts to it and keeps
          nothing else. */}
      <CalendarFilterSlot shown={offersAnything(offer) || activeFilterCount(filter) > 0}>
        <ListingFilterPanel
          locale={locale}
          pathname="/calendar"
          path={periodPath}
          filter={filter}
          offer={offer}
        />
      </CalendarFilterSlot>

      <CalendarSection locale={locale} view={view} layout={layout} query={query} now={now} events={events} />
    </Container>
  );
}
