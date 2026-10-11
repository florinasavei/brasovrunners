import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { routing, type Locale } from "@/i18n/routing";
import {
  activeFilterCount,
  listingFilterQuery,
  matchesListingFilter,
  offeredFilters,
  offersAnything,
  parseListingFilter,
  type FilterFacts,
  type ListingFilter,
} from "@/modules/events/domain/listing-filter";
import { clubNightEvent } from "@/modules/events/night-event";
import { readRegistrationDoors } from "@/modules/events/ui/registration-door";
import type { PublicEvent } from "@/modules/events/repository";
import type { EventKind } from "@/modules/events/domain/event-kind";
import CalendarFilterSlot from "@/modules/events/ui/CalendarFilterSlot";
import ListingFilterPanel from "@/modules/events/ui/ListingFilterPanel";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { monthRange, parseMonth, parseYear, yearRange } from "@/modules/events/domain/calendar";
import { calendarPeriodPath, readCalendarSegments } from "@/modules/events/domain/calendar-path";
import { getPathname } from "@/i18n/navigation";
import { cachedPublishedEventsBetween, cachedSiteLook, cachedUpcomingEvents } from "@/modules/public-cache/reads";
import { kindQuery, matchesKind, parseKindChoice } from "@/modules/events/domain/calendar-kind";
import type { EventSurface } from "@/modules/events/domain/event-type";
import { nextCalendarEvent } from "@/modules/events/domain/next-event";
import KindChips from "@/modules/events/ui/KindChips";
import NextEventPanel from "@/modules/events/ui/NextEventPanel";
import SubscribeBox from "@/modules/events/ui/SubscribeBox";
import { forecastForEvent } from "@/modules/weather/source";
import { COLOR, COLOR_DARK, FONT } from "@/theme/brand";
import { OFF_UNDER_LOOK, UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";
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
  /** The kind (the facelift's phase 4, `calendar-kind.ts`): `weekly` or `special`. */
  kind?: string | string[];
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
  // The kind, one more question of the same query (the facelift's phase 4): the chips' first group.
  const kind = parseKindChoice(searched);
  const layout: CalendarLayout = fromPath ? fromPath.layout : (Array.isArray(viewParam) ? viewParam[0] : viewParam) === "list" ? "list" : "grid";
  // The kind first, then the panel's ticks: the order the chips' links and the panel's hidden inputs write.
  const query: Record<string, string | string[]> = { ...kindQuery(kind), ...listingFilterQuery(filter) };
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
  const events = period.value.filter((event) => matchesListingFilter(event, filter, facts) && matchesKind(event, kind));
  // The calendar's own panel (§413): what it offers is read off the period on view, whole — the
  // same rule the listing applies to its own rows — and it keeps the month or year and the layout.
  const offer = offeredFilters(period.value, filter, facts);
  // The panel's form and chips go to the period's own path (§574), spelled even for this month:
  // a filter on the bare path would be the bare static page's query, which Next's router answers
  // from that page's prefetched copy without asking the server.
  const periodPath = calendarPeriodPath(getPathname({ locale, href: "/calendar" }), view, layout);
  // Under «Aspectul nou» the surface is a chip (`KindChips`): what the panel still offers there.
  const offeredSurfaces = (offer.groups.find((entry) => entry.group === "surface")?.values ?? []) as EventSurface[];
  const panelUnderLook = offersAnything({ groups: offer.groups.filter((entry) => entry.group !== "surface"), flags: offer.flags }) || activeFilterCount({ ...filter, surface: [] }) > 0;

  /*
    The next-event panel (phase 4) is read only while the look is on, as the header's «Vino cu noi»
    is (§708): off, the page reads nothing more than it did — no upcoming rows, no forecast, so the
    static calendar keeps its day-long life. On, the listing's own cached rows (held to the next
    event's end) and the forecast at its start (cached an hour, §402, which holds the page an hour).
  */
  const look = await cachedSiteLook();
  const next = look.on ? await readNextEvent(locale, now, filter, kind) : null;

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {/* The kit-face wordmark heads this page as it heads the listing — the owner, 2026-09-22:
          "trebuie sa vad acest scris frumos cu Brasov Runners si pe pagina de contact si pe cea
          de calendar" (`DECISIONS.md` §292). A
          paragraph that is an image to assistive technology, so the heading below stays the
          page's one `<h1>`; the font is the layout's, already loaded for every page. */}
      <Box sx={{ [UNDER_LOOK]: { "& [data-testid='wordmark']": { color: COLOR.accent } }, [UNDER_LOOK_DARK]: { "& [data-testid='wordmark']": { color: COLOR_DARK.accent } } }}>
        <Wordmark />
      </Box>

      {/* On a phone the head is the H1 and a «?» (§487): the intro sentence moves into the «?»'s
          fold, with the two calendar links it promises, so the month starts a paragraph higher.
          The fold's panel is anchored to this row (`position: relative`). From `sm` the sentence
          stands under the heading as before and the «?» is not drawn — never both. Half the room
          above it on a phone (§569), where the wordmark is not drawn. */}
      <Box sx={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 0.5, mt: { xs: DENSITY.headGap, sm: 1 } }}>
        <Typography variant="h1" gutterBottom sx={{ ...headingRule, ...TITLE_UNDER_LOOK }}>
          {t("calendar.pageTitle")}
        </Typography>
        <Box sx={{ display: { xs: "block", sm: "none" } }}>
          <CalendarIntroFold locale={locale} baseUrl={env.APP_BASE_URL} />
        </Box>
      </Box>
      <Typography variant="body1" color="text.secondary" sx={{ display: { xs: "none", sm: "block" }, mb: { xs: DENSITY.gapSm, sm: 2 }, ...OFF_UNDER_LOOK }}>
        {t("calendar.pageIntro")}
      </Typography>
      {/* The title block under «Aspectul nou» (phase 4): the H1 above becomes the eyebrow, and the
          line the mock-up leads with, its last word in the pink, stands under it with the subline —
          from `sm` only, so a phone's first week stays above the fold (§569). Off, not drawn. */}
      <Box sx={{ display: "none", [UNDER_LOOK]: { display: { xs: "none", sm: "block" }, mb: 2 } }} data-testid="calendar-title-block">
        <Typography component="p" sx={TAGLINE_SX}>
          {t("calendar.look.taglineLead")}{" "}
          <Box component="span" sx={{ color: COLOR.accent, [UNDER_LOOK_DARK]: { color: COLOR_DARK.accent } }}>
            {t("calendar.look.taglineWord")}
          </Box>
          {t("calendar.look.taglineEnd")}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.75, fontSize: "1.125rem" }}>
          {t("calendar.look.subline")}
        </Typography>
      </Box>

      {/* The "last copy" line (§281). */}
      <LastGoodNotice read={period} />

      {/* The listing's filter panel on the calendar (§413): the same button, the same boxes, the
          same address — so "races on a trail" is a month of races on a trail, not only a list of
          cards. Nothing to narrow and nothing ticked, it is held unseen rather than left out
          (§575): the arrows under it must not move when the next month has something to offer.
          The period is the path's (§574), so the panel posts to it and keeps nothing else. */}
      {/* The always-visible chips under «Aspectul nou» (phase 4): the kind and the surface, GET links. */}
      <KindChips path={periodPath} kind={kind} filter={filter} surfaces={offeredSurfaces} />

      <CalendarFilterSlot shown={offersAnything(offer) || activeFilterCount(filter) > 0} shownUnderLook={panelUnderLook}>
        <ListingFilterPanel
          locale={locale}
          pathname="/calendar"
          path={periodPath}
          filter={filter}
          offer={offer}
          carry={kindQuery(kind)}
          lookChips={["surface"]}
        />
      </CalendarFilterSlot>

      {/* Two columns from `md` under the look: the month, then the next event and the subscribe box. Off, one block as before. */}
      <Box sx={{ [UNDER_LOOK]: { display: { md: "grid" }, gridTemplateColumns: { md: "minmax(0, 1fr) 340px" }, columnGap: 3, alignItems: "start" } }}>
        <Box sx={{ minWidth: 0 }}>
          <CalendarSection locale={locale} view={view} layout={layout} query={query} now={now} events={events} />
        </Box>
        <Box component="aside" aria-label={t("calendar.look.nextEvent.title")} sx={{ display: "none", [UNDER_LOOK]: { display: "grid", gap: 2, mt: { md: 2 }, mb: 4 } }} data-testid="calendar-aside">
          {next && <NextEventPanel event={next.event} locale={locale} weather={next.weather} />}
          <SubscribeBox locale={locale} baseUrl={env.APP_BASE_URL} />
        </Box>
      </Box>
    </Container>
  );
}

/**
 * The next-event panel's date and its forecast (the facelift's phase 4), or null — read only while
 * «Aspectul nou» is on. The listing's own cached upcoming rows (`public-cache/reads.ts`), narrowed
 * by the page's filters and kind; a failed read is no panel, never a broken page.
 */
async function readNextEvent(locale: Locale, now: Date, filter: ListingFilter, kind: EventKind | null) {
  try {
    const upcoming = await cachedUpcomingEvents(locale, now);
    // «Înscrieri deschise» asks the doors only when it is ticked: the predicate is never called otherwise.
    const door = filter.registration ? await readRegistrationDoors(upcoming, now) : () => false;
    const event = nextCalendarEvent(upcoming, (row) => matchesListingFilter(row, filter, { night: isNight, door }) && matchesKind(row, kind));
    if (!event) return null;
    return { event, weather: (await forecastForEvent(event, now))?.start ?? null };
  } catch {
    return null;
  }
}

/**
 * Under the look: from `sm` the H1 drawn as the eyebrow over the title block's line (the mock-up's
 * «CALENDAR»); at every width without today's gradient rule under it and its gutter, the room the
 * always-visible chips take back on a phone, so the first week stays above the fold (§569).
 */
const TITLE_UNDER_LOOK = {
  [UNDER_LOOK]: {
    fontSize: { sm: "0.875rem" },
    letterSpacing: { sm: "0.2em" },
    textTransform: { sm: "uppercase" },
    color: { sm: COLOR.accentInk },
    mb: { xs: 0, sm: 0.5 },
    "&::after": { display: "none" },
  },
  [UNDER_LOOK_DARK]: { color: { sm: COLOR_DARK.accentInk } },
} as const;

/** The title block's line: the display face at 800, set tight, in the stronger ink. */
const TAGLINE_SX = {
  m: 0,
  fontFamily: `${FONT.lookDisplay}, ${FONT.fallback}`,
  fontWeight: 800,
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
  fontSize: { sm: "2.25rem", md: "2.75rem" },
  color: COLOR.inkStrong,
  [UNDER_LOOK_DARK]: { color: COLOR_DARK.inkStrong },
} as const;
