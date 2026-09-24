import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import EventCard from "@/modules/events/ui/EventCard";
import FeaturedEventHero from "@/modules/events/ui/FeaturedEventHero";
import SeriesCard from "@/modules/events/ui/SeriesCard";
import { groupSeries } from "@/modules/events/domain/series";
import { listingSections, presentEventTypes } from "@/modules/events/domain/listing";
import { readWithLastGood, type Resilient } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import { pageAlternates, staticRouteUrl, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import ChipLink from "@/shared/ui/ChipLink";
import { DISCLOSURE_SUMMARY_SX } from "@/shared/ui/disclosure";
import JsonLd from "@/shared/ui/JsonLd";
import Wordmark from "@/shared/ui/Wordmark";
import { EventListSkeleton, ListingLeadSkeleton } from "@/shared/ui/PublicSkeleton";
import type { listUpcomingEvents } from "@/modules/events/repository";
import { cachedDeadlines, cachedLatestPastEvent, cachedPastEvents, cachedUpcomingEvents } from "@/modules/public-cache/reads";

import { EVENT_TYPES, type EventType } from "@/modules/events/domain/event-type";
import { getPathname } from "@/i18n/navigation";
import type { CalendarLayout } from "@/modules/events/ui/EventCalendar";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { headingRule } from "@/theme/surfaces";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string | string[]; year?: string | string[]; type?: string | string[]; view?: string | string[] }>;
};

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
 * `?type=` shows a subset of the same cards, each of which is an indexed page of its own, and
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
 * One function and therefore one promise, because two regions of the page need the same rows
 * and must not ask twice: the lead (the hero and the filter) and the list below the calendar
 * each `await` this, and the second one gets the settled value.
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
  const { type: typeParam, view: viewParam } = await searchParams;
  // The type filter (§89): one of the closed set, or everything.
  const typeRaw = Array.isArray(typeParam) ? typeParam[0] : typeParam;
  const type = EVENT_TYPES.find((candidate) => candidate === typeRaw);
  // The layout the month links keep (§137); `ListingLead` passes it to the filter's own links.
  const layout: CalendarLayout = (Array.isArray(viewParam) ? viewParam[0] : viewParam) === "list" ? "list" : "grid";
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Events");
  // One timestamp for the whole page, so two cards cannot disagree about whether
  // registration has closed, or about where the line between past and upcoming falls.
  const now = new Date();

  /**
   * The query is **started here and awaited nowhere in this function** (§166).
   *
   * That is the whole fix for the owner's "there is flickering when changing calendars". The
   * page body itself touches no database, so Next can send the header, the wordmark and the
   * heading to the browser the instant the request arrives, and each region below fills in
   * when the query answers.
   *
   * Passing a promise down to a Server Component is the supported shape for this — the child
   * awaits it inside a `<Suspense>` boundary, and the two children that share `listing` share
   * one query between them.
   */
  /*
    With its last good answer behind it (§281): if Neon cannot be reached, each region below
    renders the copy this site last served instead of the whole page becoming `error.tsx`. The
    promise is still started here and awaited nowhere, so the streaming above is unchanged.
  */
  const listing = readWithLastGood(`events:${locale}`, () => loadListing(locale, now), now);

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
      {/*
        BR-REQ-052-02 criterion 1 asks the homepage to carry one SportsOrganization block, and
        this page is now the homepage — the site root redirects here. Incomplete by design:
        logo and sameAs are absent until the club supplies them. See structured-data.ts.
      */}
      <JsonLd data={sportsOrganizationJsonLd(CLUB_NAME,staticRouteUrl(env.APP_BASE_URL, "/events", locale))} />

      {/* The kit-face wordmark — moved here out of the header (`BR-V1.32`), and since 2026-09-22
          also at the head of the calendar and the contact page (`DECISIONS.md` §292). `shared/ui/Wordmark` says where it may appear. */}
      <Wordmark />

      {/* Says so when what follows is the last copy rather than today's (§281). Its own
          boundary, because knowing the answer means awaiting the query the page deliberately
          does not wait for. */}
      <Suspense fallback={null}>
        <StaleNotice listing={listing} />
      </Suspense>

      {/* The gradient rule under the heading says where a section starts (§166). */}
      <Typography variant="h1" gutterBottom sx={{ mt: 1, ...headingRule }}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2.5 }}>
        {t("intro")}
      </Typography>

      <Suspense fallback={<ListingLeadSkeleton label={t("loading")} />}>
        <ListingLead listing={listing} type={type} layout={layout} locale={locale} now={now} />
      </Suspense>

      {/* The calendar moved to its own page in §251 — a tab after the events, because the
          front page is for "what is on next" and a grid of squares is what somebody planning a
          month wants. `modules/events/ui/CalendarSection.tsx` renders it there. */}

      <Suspense fallback={<EventListSkeleton label={t("loading")} />}>
        <ListingBody listing={listing} type={type} now={now} />
      </Suspense>

      {/* What the club has already held, at the foot and folded (§267). Its own query and its
          own boundary, so it costs the page nothing until it answers — and nothing at all
          above it waits for it. */}
      <Suspense fallback={null}>
        <PastEvents locale={locale} now={now} type={type} hasUpcoming={listing.then((read) => read.value.hasUpcoming)} />
      </Suspense>
    </Container>
  );
}

/**
 * The lead event and the filter above the calendar.
 *
 * Streamed, because it is the first thing that costs a query and the last thing that should
 * hold up the page around it. On a month change this boundary is *not* re-keyed, so React
 * keeps the hero that is already on screen rather than blinking it — the club's next race
 * does not change because somebody looked at December.
 */
async function ListingLead({
  listing,
  type,
  layout,
  locale,
  now,
}: {
  listing: Promise<Resilient<Listing>>;
  type?: EventType;
  layout: CalendarLayout;
  locale: "ro" | "en";
  now: Date;
}) {
  const { events, hasUpcoming } = (await listing).value;
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  // `hasUpcoming` is what keeps a *past* race out of the hero (§167): between seasons the
  // page is handed the club's last event so it is not blank, and that row still carries the
  // featured flag it had when it was next. It belongs under the notice as an ordinary card.
  const { featured } = listingSections(events, type, hasUpcoming);
  // The countdown's days are the club's (§NNN), from the data cache like the rows: no wake for a visitor.
  const raceWeekDays = featured ? (await cachedDeadlines()).raceWeekDays : null;
  // The kinds the club has something of (§133, §166): a chip for a kind it has none of would
  // filter nothing, so it is not offered — the one in the address stays, so the page can say so.
  const presentTypes = presentEventTypes(events, type);

  return (
    <>
      {!hasUpcoming && events.length > 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("noUpcoming")}
        </Alert>
      )}

      {featured && raceWeekDays !== null && <FeaturedEventHero event={featured} now={now} raceWeekDays={raceWeekDays} />}

      {/* What kind: one small chip per type, a link each, kept by the month links (§89, §133).
          Fewer than two kinds is nothing to filter. */}
      {presentTypes.length > 1 && (
        <Stack component="nav" aria-label={t("filter.label")} direction="row" sx={{ flexWrap: "wrap", columnGap: 0.5, mt: 3 }}>
          {[undefined, ...presentTypes].map((candidate) => {
            const active = candidate === type;
            // A string href: a component reference cannot cross into MUI's client component —
            // and neither can an icon element (`GlyphChip`), so the type's chip takes a name.
            const href = getPathname({ locale, href: { pathname: "/events", query: { ...(candidate ? { type: candidate } : {}), ...(layout === "list" ? { view: "list" } : {}) } } });
            // The link is 44px tall (BR-REQ-041-01 criterion 6) — the chip inside it is small.
            return candidate ? (
              <ChipLink key={candidate} href={href} label={tEvent(`type.${candidate}`)} glyph={`type:${candidate}`} active={active} current={active ? "page" : undefined} />
            ) : (
              <ChipLink key="all" href={href} label={t("filter.all")} active={active} current={active ? "page" : undefined} />
            );
          })}
        </Stack>
      )}
    </>
  );
}

/**
 * How many finished events the foot of the listing carries (§267).
 *
 * A weekly run is fifty rows a year, so this is a window rather than an archive: twelve is
 * about a season of Mondays, and the calendar — which shows any month of any year (§116) — is
 * where the rest lives. The section says so in its own words rather than growing a pager.
 */
const PAST_EVENTS_SHOWN = 12;

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
  locale,
  now,
  type,
  hasUpcoming,
}: {
  locale: EventLocale;
  now: Date;
  /** The kind the filter above is showing (§272), or nothing for every kind. */
  type?: EventType;
  hasUpcoming: Promise<boolean>;
}) {
  const [rows, upcoming] = await Promise.all([
    cachedPastEvents(locale, now, PAST_EVENTS_SHOWN + 1, type),
    hasUpcoming,
  ]);
  // The one the lead is already showing, when there is nothing to come (§167).
  const events = upcoming ? rows : rows.slice(1);
  if (events.length === 0) return null;

  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  // A repeated event is one card here too (§113) — "Happy Monday" is one line, not eleven.
  const cards = groupSeries(events.slice(0, PAST_EVENTS_SHOWN));

  return (
    <Box component="details" data-testid="past-events" sx={{ mt: 4 }}>
      <Typography
        component="summary"
        variant="h2"
        sx={{ ...DISCLOSURE_SUMMARY_SX, fontSize: "1.25rem", mb: 0.5 }}
      >
        {type ? t("pastCountOfType", { count: cards.length, type: tEvent(`type.${type}`) }) : t("pastCount", { count: cards.length })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("pastHelp")}
      </Typography>
      <Box
        component="ul"
        sx={{
          listStyle: "none",
          p: 0,
          m: 0,
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
          // Every card in a row is as tall as the tallest (§275): `start` left a short card
          // beside a tall one and a hole under it, which is what made the listing look broken.
          // The room a short card is given is at its foot, under its door (§366, `CARD_BODY_SX`).
          alignItems: "stretch",
        }}
      >
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
 * Everything that is not the lead event.
 *
 * Under a hero, the rest is every other event: a heading and the same cards the unfiltered
 * listing shows, summary and picture included (§251).
 *
 * On a phone the heading is a native disclosure (`DECISIONS.md` §78): open when there are
 * four or fewer, folded when there are more, so the lead event is not followed by a scroll of
 * cards. On a wide screen the same element is always open — the browser's
 * `::details-content` is told to stay visible and the marker is hidden — because a wide
 * screen has room, and a reader there cannot tell a heading from a control.
 */
async function ListingBody({ listing, type, now }: { listing: Promise<Resilient<Listing>>; type?: EventType; now: Date }) {
  const { events, hasUpcoming } = (await listing).value;
  const t = await getTranslations("Events");
  // The same division the lead made, and it has to be given the same third argument or the
  // two disagree: a past event the lead refused to hero must appear in the list (§167).
  const { featured, listed } = listingSections(events, type, hasUpcoming);
  // A repeated event is one card (`DECISIONS.md` §113): the same title and type, grouped, in
  // the order the first occurrence had; a single event is a card as before.
  const cards = groupSeries(listed);

  if (featured) {
    if (listed.length === 0) return null;
    return (
      <Box
        component="details"
        open={cards.length <= 4}
        data-testid="other-events"
        sx={{
          "&::details-content": { display: { sm: "block" }, contentVisibility: { sm: "visible" } },
        }}
      >
        {/* The shared fold affordance (§164, §167): the biggest fold on the listing had kept
            `display: flex` for its 44 pixels, and a flex `<summary>` has no marker in Chrome
            or Safari — so the one fold a phone most needs a triangle on was the one without
            one. The height comes from `DISCLOSURE_SUMMARY_SX`'s padding instead. From `sm`
            up it is always open and is not a control, which is the documented exception. */}
        <Typography
          component="summary"
          variant="h2"
          sx={{
            ...DISCLOSURE_SUMMARY_SX,
            fontSize: "1.25rem",
            // The heading sits on its list, not a line above it (§252).
            mb: 0.5,
            cursor: { xs: "pointer", sm: "default" },
            // Its arrow hides from sm up, where the fold is always open and not a control (§325).
            "&::before": { display: { xs: "block", sm: "none" } },
            pointerEvents: { xs: "auto", sm: "none" },
          }}
        >
          {t("othersCount", { count: cards.length })}
        </Typography>
        <Box component="ul" sx={{
            listStyle: "none",
            p: 0,
            m: 0,
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
            // As above (§275): one row, one height.
            alignItems: "stretch",
          }}>
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

  if (listed.length === 0) return <Alert severity="info">{t("empty")}</Alert>;

  return (
    <Box component="ul" sx={{
            listStyle: "none",
            p: 0,
            m: 0,
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
            // As above (§275): one row, one height.
            alignItems: "stretch",
          }}>
      {cards.map((series, index) =>
        series.members.length > 1 ? (
          <SeriesCard key={series.key} members={series.members} index={index} now={now} />
        ) : (
          <EventCard key={series.key} event={series.members[0]} index={index} now={now} />
        ),
      )}
    </Box>
  );
}

/** The "this is the last copy" line, once the shared query has settled (§281). */
async function StaleNotice({ listing }: { listing: Promise<Resilient<Listing>> }) {
  return <LastGoodNotice read={await listing} />;
}
