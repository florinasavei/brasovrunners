import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound, unstable_rethrow } from "next/navigation";
import { routing } from "@/i18n/routing";
import EventCard from "@/modules/events/ui/EventCard";
import SeriesCard from "@/modules/events/ui/SeriesCard";
import { forecastsForEvents } from "@/modules/weather/source";
import { groupSeries, seriesLookup } from "@/modules/events/domain/series";
import { listingSections } from "@/modules/events/domain/listing";
import PastEvents from "@/modules/events/ui/PastEvents";
import {
  activeFilterCount,
  listingFilterRows,
  matchesListingFilter,
  offeredFilters,
  offersAnything,
  parseListingFilter,
  type FilterFacts,
  type ListingFilter,
} from "@/modules/events/domain/listing-filter";
import { clubNightEvent } from "@/modules/events/night-event";
import { readRegistrationDoors } from "@/modules/events/ui/registration-door";
import ListingFilterPanel from "@/modules/events/ui/ListingFilterPanel";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { nextWallMidnight } from "@/modules/events/domain/page-clock";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import { pageAlternates, staticRouteUrl, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import JsonLd from "@/shared/ui/JsonLd";
import Wordmark from "@/shared/ui/Wordmark";
import type { listUpcomingEvents, PublicEvent, PublicEventPage } from "@/modules/events/repository";
import { cachedDeadlines, cachedLatestPastEvent, cachedPastEvents, cachedUndatedEvents, cachedUpcomingEvents } from "@/modules/public-cache/reads";

import type { CalendarLayout } from "@/modules/events/ui/EventCalendar";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { CARD_GRID_SX } from "@/modules/events/ui/card-layout";
import { headingRule } from "@/theme/surfaces";

type Props = {
  params: Promise<{ locale: string }>;
  /**
   * The address's query — passed only by the live twin (`app/[locale]/live/events/page.tsx`), which
   * the proxy sends a filtered visit to (§549). This static route never reads Next's `searchParams`:
   * reading it would render every visit per request again.
   */
  query?: Promise<ListingQuery>;
};

type ListingQuery = {
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
 * Whether a row is a night event (§394), for the filter's "Eveniment de noapte" box: the same answer
 * the row's own pill gives, at the club's place, per date.
 */
// No night without a date (§533): an event whose date is to be announced has no sunset to compare.
const isNight = (event: PublicEventPage) => event.startsAt !== null && clubNightEvent({ ...event, startsAt: event.startsAt }).night;

/**
 * Static, made on its first visit and kept by the CDN (§549, amending §333): the bare listing is
 * the same for every anonymous visitor. It is made again when a write expires what it shows (the
 * rows' own tags, §333), when its clock says it reads differently — the next event ending, a
 * registration door opening or closing, midnight (`public-cache/page-lifetime.ts`) — and at the
 * latest after a day. Nothing is prerendered at build (the locale layout generates no params), so
 * CI still builds without a database. A filtered visit (`?type=…`) is the live twin's
 * (`live/events/page.tsx`), rendered per request.
 *
 * A literal, as Next requires: `PUBLIC_PAGE_CEILING_SECONDS` (a test holds the two equal).
 */
export const revalidate = 86400;


/**
 * The listing is one page per language, whatever the address adds (§342).
 *
 * `?type=` — and every other filter since §413 — shows a subset of the same cards, each of which is an indexed page of its own, and
 * `?view=` changes nothing here at all since the calendar moved to its own page (§251) — the
 * filter links only carry it back there. Neither view has content of its own, so every one of
 * them names the plain listing as canonical and only the plain listing is in the sitemap.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Events" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/events")),
  };
}

/** The locale, exactly as the repository spells it. */
type EventLocale = Parameters<typeof listUpcomingEvents>[1];

/**
 * The events the page leads with: everything still to come, or — between seasons, where an
 * empty page reads as a broken site — the last one that happened, dated.
 *
 * One function and therefore one read, because the filter panel, the lead and the list all need
 * the same rows and must not ask twice: the page awaits it once and hands each the value (§413).
 */
async function loadListing(locale: EventLocale, now: Date) {
  const upcoming = await cachedUpcomingEvents(locale, now);
  if (upcoming.length > 0) return { events: upcoming, hasUpcoming: true };
  const latestPast = await cachedLatestPastEvent(locale, now);
  return { events: latestPast ? [latestPast] : [], hasUpcoming: false };
}

type Listing = Awaited<ReturnType<typeof loadListing>>;

export default async function EventsPage({ params, query: asked }: Props) {
  const { locale } = await params;
  const query: ListingQuery = (await asked) ?? {};
  // The filters (§413, amending §133/§401): every group the panel offers, OR within a group and AND
  // across groups, read off the address — `?type=RACE` and `?partner=1` mean what they always meant.
  const filter = parseListingFilter(query);
  // The layout the month links keep (§137); the panel's form and links carry it along.
  const layout: CalendarLayout = (Array.isArray(query.view) ? query.view[0] : query.view) === "list" ? "list" : "grid";
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Events");
  // One timestamp for the whole page, so two cards cannot disagree about whether
  // registration has closed, or about where the line between past and upcoming falls.
  const now = new Date();
  // The countdown and every "în 3 zile" are the day's (§76, §78): the static page is made again at midnight (§549).
  await holdPageUntil([nextWallMidnight(now, CLUB_TIME_ZONE)], now);

  /*
    **One cached read, awaited here, before anything is rendered** (§413, amending §166 for this
    page). The rows come from the data cache (§333) with their last good copy behind them (§281),
    so a visit that finds them costs no database and answers in the time a cache lookup takes.

    §166 streamed the lead and the list behind `<Suspense>` so the header could leave before the
    query answered. A streamed region is revealed by an inline script, though, so a browser with
    scripts off was left with the loading shapes — and the filter panel, a plain GET form meant to
    work without a script, sat inside one of them where nobody could press it. Now the panel, the
    cards (the lead's included) and the past section are all in the first HTML the server sends: no boundary on
    this page waits for a script to be shown. With a script nothing is lost — a filter or a month
    change is a soft navigation that keeps the page on screen until the new one is ready.

    The past section's own read (§267) starts at the same moment and is awaited beside it, so the
    two cost the longer of the two, not the sum.
  */
  const [read, pastRows, undatedRows] = await Promise.all([
    readWithLastGood(`events:${locale}`, () => loadListing(locale, now), now),
    readPastEvents(locale, now),
    readUndatedEvents(locale),
  ]);
  const listing = read.value;
  // Between seasons (§167) the page leads with the club's last event so it is not blank — unless
  // an event whose date is to be announced (§533) is ahead: then the page is not between seasons,
  // and that section, under the cards, is what it has to show.
  const { events, hasUpcoming }: Listing = !listing.hasUpcoming && undatedRows.length > 0 ? { events: [], hasUpcoming: false } : listing;
  // The race-week countdown counts days on each event's own wall clock (`raceWeek`, §78): an event
  // kept in another zone turns its day at that zone's midnight, so the page is made again then too (§549).
  await holdPageUntil(events.map((event) => nextWallMidnight(now, event.timezone)), now);
  // «Înscrieri deschise» is the page's own door (§413): one cached availability read per open
  // internal event among these rows, the entry its card and its page read too, and nothing for any
  // other row (`readRegistrationDoor`, §409).
  const facts: FilterFacts<PublicEventPage> = { night: isNight, door: await readRegistrationDoors([...events, ...pastRows], now) };
  // The undated section under the cards, narrowed by the same filters: when it shows something, a
  // filter that empties the dated cards is not "nothing to show".
  const undatedShown = undatedRows.filter((event) => matchesListingFilter(event, filter, facts));

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {/*
        BR-REQ-052-02 criterion 1 asks the homepage to carry one SportsOrganization block, and
        this page is now the homepage — the site root redirects here. Incomplete by design:
        logo and sameAs are absent until the club supplies them. See structured-data.ts.
      */}
      <JsonLd data={sportsOrganizationJsonLd(CLUB_NAME,staticRouteUrl(env.APP_BASE_URL, "/events", locale))} />

      {/* The kit-face wordmark — moved here out of the header (`BR-V1.32`), and since 2026-09-22
          also at the head of the calendar and the contact page (`DECISIONS.md` §292). `shared/ui/Wordmark` says where it may appear. */}
      <Wordmark />

      {/* Says so when what follows is the last copy rather than today's (§281). */}
      <LastGoodNotice read={read} />

      {/* The gradient rule under the heading says where a section starts (§166). Compact on a
          phone (§569): the theme's H1 size, half the room above it — the first card is what the
          first screen is for. */}
      <Typography variant="h1" gutterBottom sx={{ mt: { xs: DENSITY.headGap, sm: 1 }, ...headingRule }}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.gapXs, sm: 2.5 } }}>
        {t("intro")}
      </Typography>

      <ListingLead events={events} undated={undatedRows} past={pastRows} hasUpcoming={hasUpcoming} filter={filter} facts={facts} layout={layout} locale={locale} />

      {/* The calendar moved to its own page in §251 — a tab after the events, because the
          front page is for "what is on next" and a grid of squares is what somebody planning a
          month wants. `modules/events/ui/CalendarSection.tsx` renders it there. */}

      <ListingBody events={events} hasUpcoming={hasUpcoming} filter={filter} facts={facts} now={now} undatedBelow={undatedShown.length > 0} />

      {/* The events whose date is to be announced (§533): under the dated ones, never in a month. */}
      <UndatedEvents rows={undatedShown} now={now} />

      {/* What the club has already held, at the foot and folded (§267). */}
      <PastEvents
        rows={pastRows}
        now={now}
        filter={filter}
        facts={facts}
        shownAbove={hasUpcoming ? undefined : events[0]?.id}
      />
    </Container>
  );
}

/**
 * The filter panel, and the notice between seasons.
 *
 * In the page's first HTML, never behind a streamed boundary (§413): the panel is a GET form that
 * has to work with scripts off, and a streamed region is only revealed by a script. A filter
 * pressed with a script is a soft navigation that keeps the panel — open, as the reader left it —
 * on screen while the new rows arrive.
 *
 * The panel sits **above** the cards, the lead's included, because the lead follows the filters
 * (§413): a control under the thing it hides would jump up under the thumb that pressed it. The
 * lead event itself is no longer drawn here: since §470 it is the first card of the grid below
 * (`ListingBody`).
 */
async function ListingLead({
  events,
  undated,
  past,
  hasUpcoming,
  filter,
  facts,
  layout,
  locale,
}: Listing & {
  /** The events whose date is to be announced (§533): the panel offers their values too. */
  undated: readonly PublicEventPage[];
  /** The past section's window (§267), which the same filters narrow (§NNN): its values are offered too. */
  past: readonly PublicEventPage[];
  /** The filters the address names (§413): OR within a group, AND across groups. */
  filter: ListingFilter;
  /** The night and door answers, per row, the page read once (§394, §413). */
  facts: FilterFacts<PublicEventPage>;
  layout: CalendarLayout;
  locale: "ro" | "en";
}) {
  const t = await getTranslations("Events");
  // What the panel offers (§413, §133's rule generalised): a box only where ticking it would change
  // what the page shows — read off every row, the lead's included, never off the filtered rows —
  // or where the address already ticks it, so a filtered page can say what it is filtered by.
  // The past section narrows by the same boxes (§NNN), so its window is read too: a value only a
  // past event carries is a box that changes what the page shows. Each row once — between seasons
  // the lead is the past window's first row (§167).
  const offer = offeredFilters<PublicEventPage>(listingFilterRows<PublicEventPage>(events, undated, past), filter, facts);

  return (
    <>
      {/* One "Filtre" button, closed by default (§413 — the owner, 2026-09-25: "un buton de filtre,
          collapsed by default, checkboxuri pe pill-uri și mai multe filtre"), replacing §133's row
          of kind chips and §401's «Colaborare» chip beside them. Nothing to narrow and nothing
          ticked, it does not render, and nothing on the listing moves for that.

          The gap around it is `DENSITY.gapXs` (§458, tightening §401's `sectionGap` — the owner: "in
          general prea mult padding între carduri și restul" — and again in §480, the 360-px density
          pass, 8px to 6): 6px on a phone and 12px from `sm`, above and below alike, the intro's
          own margin above it the same six. */}
      {(offersAnything(offer) || activeFilterCount(filter) > 0) && (
        <Box sx={{ mt: { xs: DENSITY.gapXs, sm: 1.5 }, mb: { xs: DENSITY.gapXs, sm: 1.5 } }}>
          <ListingFilterPanel
            locale={locale}
            pathname="/events"
            filter={filter}
            offer={offer}
            keep={layout === "list" ? { view: "list" } : {}}
          />
        </Box>
      )}

      {!hasUpcoming && events.length > 0 && (
        <Alert severity="info" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }}>
          {t("noUpcoming")}
        </Alert>
      )}
    </>
  );
}

/**
 * The events whose date is to be announced (§533), or none when they cannot be read: like the past
 * section, a section of what the page already has, never a reason for the listing to fail.
 */
async function readUndatedEvents(locale: EventLocale): Promise<PublicEventPage[]> {
  try {
    return await cachedUndatedEvents(locale);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[events] could not read the events whose date is to be announced", error);
    return [];
  }
}

/**
 * «Data se anunță» (§533): the published events whose date is not announced yet, under the dated
 * list — a card each, its «Când» saying so, never a countdown, a month or a forecast. The page hands
 * it the rows its filters let through (no such event is a night one or has a door open: registration
 * is «în curând» until the date is known). Nothing at all when there is none.
 */
async function UndatedEvents({ rows: shown, now }: { rows: readonly PublicEventPage[]; now: Date }) {
  if (shown.length === 0) return null;
  const t = await getTranslations("Events");
  return (
    <Box component="section" aria-labelledby="undated-events-title" data-testid="undated-events" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
      <Typography component="h2" variant="h5" id="undated-events-title" sx={{ mb: { xs: DENSITY.gapSm, sm: 2 } }}>
        {t("undatedTitle")}
      </Typography>
      <Box component="ul" sx={CARD_GRID_SX}>
        {shown.map((event, index) => (
          <EventCard key={event.id} event={event} index={index} now={now} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * How far back the past section looks (§413): the club's latest sixty past events — about a year
 * of weekly runs — read in **one** cached window per language whatever the address ticks, and
 * narrowed in memory. Every visit, filtered or not, reads the same data-cache entry
 * (`events.past`, the language, the listing's clock window, 60), so no combination of boxes can
 * cost a database read of its own; a filter finds its twelve among those sixty or shows fewer.
 * Past that, the calendar's months are where the rest lives, as before.
 */
const PAST_EVENTS_WINDOW = 60;

/**
 * The past section's rows (§267), or none when they cannot be read: the section is a fold of what
 * already happened, and an outage in it must not take the page it sits under with it (§281).
 */
async function readPastEvents(locale: EventLocale, now: Date): Promise<PublicEvent[]> {
  try {
    return await cachedPastEvents(locale, now, PAST_EVENTS_WINDOW);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[events] could not read the past events", error);
    return [];
  }
}

/**
 * The upcoming events, as one grid of cards — the lead event first among them (§470).
 *
 * §78 drew the lead as a hero across the page and the rest under a heading, «Toate evenimentele
 * (N)», folded on a phone past four cards. The owner, 2026-09-26, of that hero beside the grid:
 * "vreau doar sa fie primul, nu neaparat mai lat pe desktop, e ok sa afisam 2 sau 3 carduri, dar
 * toate cardurile trebuie sa aiba aceeasi latime". So the lead is the first `<li>` of the one grid
 * (`CARD_GRID_SX`), at the grid's width, told apart by its frame, its background and its chip
 * (`EventCard`'s `featured`). The heading and the phone fold went with the hero: they existed so a
 * screen-tall hero was not followed by a scroll of cards, and a card-sized lead is followed by
 * cards the way the listing without a lead always was — no fold there either.
 */
async function ListingBody({
  events,
  hasUpcoming,
  filter,
  facts,
  now,
  undatedBelow = false,
}: Listing & {
  /** The filters the address names (§413), the same the panel was given. */
  filter: ListingFilter;
  facts: FilterFacts<PublicEventPage>;
  now: Date;
  /** The «Data se anunță» section (§533) shows something under this grid: no "nothing" sentence then. */
  undatedBelow?: boolean;
}) {
  const t = await getTranslations("Events");
  const filtered = activeFilterCount(filter) > 0;
  // `hasUpcoming` is what keeps a *past* race from leading (§167): between seasons the page is
  // handed the club's last event so it is not blank, and that row still carries the featured flag
  // it had when it was next — it is an ordinary card under the notice. The filter decides the lead
  // too (§413): a lead event that does not match is shown nowhere, not demoted to a card.
  const { featured, listed } = listingSections(events, (event) => matchesListingFilter(event, filter, facts), hasUpcoming);
  // A repeated event is one card (`DECISIONS.md` §113): the same title and type, grouped, in
  // the order the first occurrence had; a single event is a card as before.
  const cards = groupSeries(listed);
  // The series each date belongs to, read off the whole list before the filters and the lead
  // (§486): a weekly run's one matching date, or the lead that is one of a series' dates, is still
  // a repeated event, and its card says so with the series card's repeat chip and rhythm.
  const seriesOf = seriesLookup(events);

  // Nothing matches the filters: say so in those words, not "nothing is published" (§413) — the
  // panel above still names every tick and "Șterge filtrele" is one press away.
  if (!featured && listed.length === 0) {
    if (undatedBelow) return null;
    return <Alert severity="info">{filtered && events.length > 0 ? t("filter.none") : t("empty")}</Alert>;
  }

  /*
    The weather at each card's start (§416; the owner: "aș vrea să văd vremea și pe cardul
    principal"): read once for every card, the lead's included — a series by its next date, the one
    whose facts it shows — each at its own place, one request per rounded place and none outside the
    seven days (`forecastsForEvents`). The lead wears the cards' pill (§429) since it is a card
    (§470); the start hour's details are the event page's. Open-Meteo's credit is the site footer's
    (§455).
  */
  const forecasts = await forecastsForEvents(
    [...(featured ? [featured] : []), ...cards.map((series) => series.members[0])],
    now,
  );
  const weatherOf = (event: PublicEvent) => forecasts.get(event.id)?.start ?? null;
  // The countdown's days are the club's (§377), from the data cache like the rows: no wake for a visitor.
  const raceWeekDays = featured ? (await cachedDeadlines()).raceWeekDays : null;
  // The lead takes the first place in the rise-in order, so the cards after it keep theirs.
  const offset = featured ? 1 : 0;

  return (
    <Box component="ul" sx={CARD_GRID_SX} data-testid="listing-cards">
      {featured && raceWeekDays !== null && (
        <EventCard event={featured} index={0} now={now} weather={weatherOf(featured)} featured={{ raceWeekDays }} seriesDates={seriesOf(featured)} />
      )}
      {cards.map((series, index) =>
        series.members.length > 1 ? (
          <SeriesCard key={series.key} members={series.members} index={index + offset} now={now} weather={weatherOf(series.members[0])} />
        ) : (
          <EventCard
            key={series.key}
            event={series.members[0]}
            index={index + offset}
            now={now}
            weather={weatherOf(series.members[0])}
            seriesDates={seriesOf(series.members[0])}
          />
        ),
      )}
    </Box>
  );
}
