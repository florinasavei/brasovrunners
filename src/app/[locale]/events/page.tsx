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
import { groupSeries } from "@/modules/events/domain/series";
import { listingSections } from "@/modules/events/domain/listing";
import {
  activeFilterCount,
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
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import { pageAlternates, staticRouteUrl, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import { DISCLOSURE_SUMMARY_SX } from "@/shared/ui/disclosure";
import JsonLd from "@/shared/ui/JsonLd";
import Wordmark from "@/shared/ui/Wordmark";
import type { listUpcomingEvents, PublicEvent } from "@/modules/events/repository";
import { cachedDeadlines, cachedLatestPastEvent, cachedPastEvents, cachedUpcomingEvents } from "@/modules/public-cache/reads";

import type { CalendarLayout } from "@/modules/events/ui/EventCalendar";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
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
    registration?: string | string[];
  }>;
};

/**
 * Whether a row is a night event (§394), for the filter's "Eveniment de noapte" box: the same answer
 * the row's own pill gives, at the club's place, per date.
 */
const isNight = (event: PublicEvent) => clubNightEvent(event).night;

/**
 * Rendered per request. Organizers publish and cancel events between deploys, so a build-time
 * snapshot would show a run as scheduled after it was called off. It also keeps the database
 * out of the build, which is what lets CI build without one.
 *
 * Per request is not per query any more (§333): the rows come from the public cache, which every
 * event save expires and which is keyed by the moment the next event ends — so the page reads the
 * address and the clock afresh on every visit, and the database only when something changed.
 */
export const dynamic = "force-dynamic";


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

export default async function EventsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
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
  const [read, pastRows] = await Promise.all([
    readWithLastGood(`events:${locale}`, () => loadListing(locale, now), now),
    readPastEvents(locale, now),
  ]);
  const { events, hasUpcoming } = read.value;
  // «Înscrieri deschise» is the page's own door (§413): one cached availability read per open
  // internal event among these rows, the entry its card and its page read too, and nothing for any
  // other row (`readRegistrationDoor`, §409).
  const facts: FilterFacts<PublicEvent> = { night: isNight, door: await readRegistrationDoors([...events, ...pastRows], now) };

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

      {/* The gradient rule under the heading says where a section starts (§166). */}
      <Typography variant="h1" gutterBottom sx={{ mt: 1, ...headingRule }}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.gapSm, sm: 2.5 } }}>
        {t("intro")}
      </Typography>

      <ListingLead events={events} hasUpcoming={hasUpcoming} filter={filter} facts={facts} layout={layout} locale={locale} />

      {/* The calendar moved to its own page in §251 — a tab after the events, because the
          front page is for "what is on next" and a grid of squares is what somebody planning a
          month wants. `modules/events/ui/CalendarSection.tsx` renders it there. */}

      <ListingBody events={events} hasUpcoming={hasUpcoming} filter={filter} facts={facts} now={now} />

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
 * lead event itself is no longer drawn here: since §NNN it is the first card of the grid below
 * (`ListingBody`).
 */
async function ListingLead({
  events,
  hasUpcoming,
  filter,
  facts,
  layout,
  locale,
}: Listing & {
  /** The filters the address names (§413): OR within a group, AND across groups. */
  filter: ListingFilter;
  /** The night and door answers, per row, the page read once (§394, §413). */
  facts: FilterFacts<PublicEvent>;
  layout: CalendarLayout;
  locale: "ro" | "en";
}) {
  const t = await getTranslations("Events");
  // What the panel offers (§413, §133's rule generalised): a box only where ticking it would change
  // what the page shows — read off every row, the lead's included, never off the filtered rows —
  // or where the address already ticks it, so a filtered page can say what it is filtered by.
  const offer = offeredFilters(events, filter, facts);

  return (
    <>
      {/* One "Filtre" button, closed by default (§413 — the owner, 2026-09-25: "un buton de filtre,
          collapsed by default, checkboxuri pe pill-uri și mai multe filtre"), replacing §133's row
          of kind chips and §401's «Colaborare» chip beside them. Nothing to narrow and nothing
          ticked, it does not render, and nothing on the listing moves for that.

          The gap around it is `DENSITY.gapSm` (§458, tightening §401's `sectionGap` — the owner: "in
          general prea mult padding între carduri și restul"): 8px on a phone and 12px from `sm`,
          above and below alike. */}
      {(offersAnything(offer) || activeFilterCount(filter) > 0) && (
        <Box sx={{ mt: { xs: DENSITY.gapSm, sm: 1.5 }, mb: { xs: DENSITY.gapSm, sm: 1.5 } }}>
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
 * The listing's one grid of cards (§NNN): one column on a phone, two from `md`, three from `xl` —
 * every card the same width, the featured one included (the owner, 2026-09-26: "nu neaparat mai lat
 * pe desktop, e ok sa afisam 2 sau 3 carduri, dar toate cardurile trebuie sa aiba aceeasi latime").
 * The upcoming list and the past fold (§267) share it, so the two cannot drift apart.
 *
 * Every card in a row is as tall as the tallest (§275): `start` left a short card beside a tall one
 * and a hole under it, which is what made the listing look broken. The room a short card is given
 * is at its foot, under its door (§366, `CARD_BODY_SX`).
 */
const CARD_GRID_SX = {
  listStyle: "none",
  p: 0,
  m: 0,
  display: "grid",
  gap: { xs: DENSITY.cardGridGap, sm: 1.5 },
  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
  alignItems: "stretch",
} as const;

/**
 * How many finished events the foot of the listing carries (§267).
 *
 * A weekly run is fifty rows a year, so this is a window rather than an archive: twelve is
 * about a season of Mondays, and the calendar — which shows any month of any year (§116) — is
 * where the rest lives. The section says so in its own words rather than growing a pager.
 */
const PAST_EVENTS_SHOWN = 12;

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
 * The events that have already happened, at the bottom, in their own category (§267).
 *
 * The owner: "old or closed events must be shown at the bottom on a different category". The
 * listing is "what is on next" and that is right, but an event the club held was reachable only
 * through the calendar's month view — so a runner looking for last month's race, or for the page
 * with its photographs, had nowhere obvious to go.
 *
 * **Folded at every width, unlike the "other events" fold above it**, which opens from `sm` up
 * (§78). That difference is the whole point: what is to come is what the page is for, and what
 * is past is something a reader goes looking for. A closed `<details>` is also a section that
 * costs a phone nothing to scroll past.
 *
 * Between seasons the lead already shows the club's last event with a notice (§167), so this
 * section skips that one row: it would be the same card twice on one page.
 */
async function PastEvents({
  rows,
  now,
  filter,
  facts,
  shownAbove,
}: {
  /** `PAST_EVENTS_WINDOW` rows, newest first, read by the page beside the listing's own. */
  rows: PublicEvent[];
  now: Date;
  /** The filters above (§272, §413) — the past narrows by them too, in memory. */
  filter: ListingFilter;
  facts: FilterFacts<PublicEvent>;
  /** The past event the lead already shows between seasons (§167), if any. */
  shownAbove: string | undefined;
}) {
  const filtered = activeFilterCount(filter) > 0;
  // The heading names the kind when one kind is all that is ticked, as `?type=` always did (§272).
  const sourceType = filter.type.length === 1 ? filter.type[0] : undefined;
  // The one the lead is already showing, when there is nothing to come (§167) — by its id, so it
  // is left out wherever the filter puts it.
  const events = rows.filter((event) => event.id !== shownAbove && matchesListingFilter(event, filter, facts));
  if (events.length === 0) return null;

  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  // A repeated event is one card here too (§113) — "Happy Monday" is one line, not eleven.
  const cards = groupSeries(events.slice(0, PAST_EVENTS_SHOWN));
  const onlyOneType = sourceType !== undefined && activeFilterCount(filter) === 1;

  return (
    <Box component="details" data-testid="past-events" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
      <Typography
        component="summary"
        variant="h2"
        sx={{ ...DISCLOSURE_SUMMARY_SX, fontSize: "1.25rem", mb: 1.5 }}
      >
        {onlyOneType
          ? t("pastCountOfType", { count: cards.length, type: tEvent(`type.${sourceType}`) })
          : filtered
            ? t("pastCountFiltered", { count: cards.length })
            : t("pastCount", { count: cards.length })}
      </Typography>
      <Box component="ul" sx={CARD_GRID_SX}>
        {cards.map((series, index) =>
          series.members.length > 1 ? (
            <SeriesCard key={series.key} members={series.members} index={index} now={now} />
          ) : (
            <EventCard key={series.key} event={series.members[0]} index={index} now={now} />
          ),
        )}
      </Box>
    </Box>
  );
}

/**
 * The upcoming events, as one grid of cards — the lead event first among them (§NNN).
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
}: Listing & {
  /** The filters the address names (§413), the same the panel was given. */
  filter: ListingFilter;
  facts: FilterFacts<PublicEvent>;
  now: Date;
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

  // Nothing matches the filters: say so in those words, not "nothing is published" (§413) — the
  // panel above still names every tick and "Șterge filtrele" is one press away.
  if (!featured && listed.length === 0) return <Alert severity="info">{filtered && events.length > 0 ? t("filter.none") : t("empty")}</Alert>;

  /*
    The weather at each card's start (§416; the owner: "aș vrea să văd vremea și pe cardul
    principal"): read once for every card, the lead's included — a series by its next date, the one
    whose facts it shows — each at its own place, one request per rounded place and none outside the
    seven days (`forecastsForEvents`). The lead wears the cards' pill (§429) since it is a card
    (§NNN); the start hour's details are the event page's. Open-Meteo's credit is the site footer's
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
        <EventCard event={featured} index={0} now={now} weather={weatherOf(featured)} featured={{ raceWeekDays }} />
      )}
      {cards.map((series, index) =>
        series.members.length > 1 ? (
          <SeriesCard key={series.key} members={series.members} index={index + offset} now={now} weather={weatherOf(series.members[0])} />
        ) : (
          <EventCard key={series.key} event={series.members[0]} index={index + offset} now={now} weather={weatherOf(series.members[0])} />
        ),
      )}
    </Box>
  );
}
