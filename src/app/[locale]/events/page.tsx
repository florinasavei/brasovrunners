import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import DownloadIcon from "@mui/icons-material/Download";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { webcalUrl } from "@/modules/events/ical";
import { env } from "@/shared/config/env";
import Box from "@mui/material/Box";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import EventFacts from "@/modules/events/ui/EventFacts";
import EventKindChips from "@/modules/events/ui/EventKindChips";
import FeaturedEventHero from "@/modules/events/ui/FeaturedEventHero";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import SeriesCard from "@/modules/events/ui/SeriesCard";
import { groupSeries } from "@/modules/events/domain/series";
import { calendarBoundaryKey, listingSections, presentEventTypes } from "@/modules/events/domain/listing";
import { sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import CardLink from "@/shared/ui/CardLink";
import ChipLink from "@/shared/ui/ChipLink";
import { DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX } from "@/shared/ui/disclosure";
import InfoTip from "@/shared/ui/InfoTip";
import JsonLd from "@/shared/ui/JsonLd";
import Wordmark from "@/shared/ui/Wordmark";
import { CalendarBodySkeleton, EventListSkeleton, ListingLeadSkeleton } from "@/shared/ui/PublicSkeleton";
import { findLatestPastEvent, listPublishedEventsBetween, listUpcomingEvents, type PublicEvent } from "@/modules/events/repository";
import { monthGrid, monthRange, parseMonth, parseYear, yearRange } from "@/modules/events/domain/calendar";
import { EVENT_TYPES, type EventType } from "@/modules/events/domain/event-type";
import { getPathname } from "@/i18n/navigation";
import CalendarHeader from "@/modules/events/ui/CalendarHeader";
import EventCalendar, { type CalendarLayout, type CalendarView } from "@/modules/events/ui/EventCalendar";
import { CLUB_TIME_ZONE } from "@/modules/jobs/quiet-hours";
import { PAGE_WIDTH } from "@/theme/brand";
import { liftOnHover, riseIn } from "@/theme/motion";
import { headingRule } from "@/theme/surfaces";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string | string[]; year?: string | string[]; type?: string | string[]; view?: string | string[] }>;
};

/**
 * Rendered per request. Organizers publish and cancel events between deploys, so a build-time
 * snapshot would show a run as scheduled after it was called off. It also keeps the database
 * out of the build, which is what lets CI build without one.
 */
export const dynamic = "force-dynamic";


export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Events" });
  return { title: t("title"), description: t("intro") };
}

/** The database handle and the locale, exactly as the repository spells them. */
type Db = Parameters<typeof listUpcomingEvents>[0];
type EventLocale = Parameters<typeof listUpcomingEvents>[1];

/**
 * The events the page leads with: everything still to come, or — between seasons, where an
 * empty page reads as a broken site — the last one that happened, dated.
 *
 * One function and therefore one promise, because two regions of the page need the same rows
 * and must not ask twice: the lead (the hero and the filter) and the list below the calendar
 * each `await` this, and the second one gets the settled value.
 */
async function loadListing(db: Db, locale: EventLocale, now: Date) {
  const upcoming = await listUpcomingEvents(db, locale, now);
  if (upcoming.length > 0) return { events: upcoming, hasUpcoming: true };
  const latestPast = await findLatestPastEvent(db, locale, now);
  return { events: latestPast ? [latestPast] : [], hasUpcoming: false };
}

type Listing = Awaited<ReturnType<typeof loadListing>>;

/**
 * The three calendar buttons (§175; the owner: "these buttons must be smaller as well and have
 * icons"). A finger's 44 pixels on a touch screen, a pointer's 32 from `sm` up — the same two
 * sizes the share pills take — and the glyph as a child of the Button, never an element-valued
 * prop across the server/client boundary.
 */
const CALENDAR_BUTTON_SX = {
  minHeight: { xs: 44, sm: 32 },
  gap: 0.5,
  px: { xs: 1.5, sm: 1.25 },
  fontSize: { sm: "0.78rem" },
} as const;

export default async function EventsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { month: monthParam, year: yearParam, type: typeParam, view: viewParam } = await searchParams;
  // The type filter (§89): one of the closed set, or everything.
  const typeRaw = Array.isArray(typeParam) ? typeParam[0] : typeParam;
  const type = EVENT_TYPES.find((candidate) => candidate === typeRaw);
  // The month as a list rather than the grid (§137), kept by the month links like the filter.
  const layout: CalendarLayout = (Array.isArray(viewParam) ? viewParam[0] : viewParam) === "list" ? "list" : "grid";
  const query: Record<string, string> = { ...(type ? { type } : {}), ...(layout === "list" ? { view: "list" } : {}) };
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Events");
  const tSite = await getTranslations("Site");
  // One timestamp for the whole page, so two cards cannot disagree about whether
  // registration has closed, or about where the line between past and upcoming falls.
  const now = new Date();
  const db = getDb();
  // The month view (`DECISIONS.md` §89): the month the URL names, or this one — or the whole
  // year it names (§116). The year wins when both are given: it is the wider question.
  const year = parseYear(yearParam, now, CLUB_TIME_ZONE);
  const view: CalendarView = year ? { kind: "year", year } : { kind: "month", month: parseMonth(monthParam, now, CLUB_TIME_ZONE) };
  const range = view.kind === "year" ? yearRange(view.year, CLUB_TIME_ZONE) : monthRange(view.month, CLUB_TIME_ZONE);

  /**
   * Both queries are **started here and awaited nowhere in this function** (§166).
   *
   * That is the whole fix for the owner's "there is flickering when changing calendars". The
   * page body itself now touches no database, so Next can send the header, the wordmark, the
   * heading and every calendar control to the browser the instant the request arrives, and
   * each region below fills in when its own query answers. A press on "next month" replaces
   * one grid; nothing else on the page so much as repaints.
   *
   * Passing a promise down to a Server Component is the supported shape for this — the child
   * awaits it inside a `<Suspense>` boundary, and the two children that share `listing` share
   * one query between them.
   */
  const listing = loadListing(db, locale, now);
  const inRange = listPublishedEventsBetween(db, locale, range.from, range.to).then((rows) =>
    rows.filter((event) => !type || event.type === type),
  );

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 3, sm: 6 } }}>
      {/*
        BR-REQ-052-02 criterion 1 asks the homepage to carry one SportsOrganization block, and
        this page is now the homepage — the site root redirects here. Incomplete by design:
        logo and sameAs are absent until the club supplies them. See structured-data.ts.
      */}
      <JsonLd data={sportsOrganizationJsonLd(tSite("name"))} />

      {/* The kit-face wordmark, here and nowhere else — the owner moved it out of the header. */}
      <Wordmark />

      {/* The gradient rule under the heading says where a section starts (§166). */}
      <Typography variant="h1" gutterBottom sx={{ mt: 2, ...headingRule }}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        {t("intro")}
      </Typography>

      <Suspense fallback={<ListingLeadSkeleton label={t("loading")} />}>
        <ListingLead listing={listing} type={type} layout={layout} locale={locale} now={now} />
      </Suspense>

      {/* Every Monday, every Wednesday, some weekends: a month, not a list, is how the club runs. */}
      <Box sx={{ mt: 2, mb: 4 }}>
        {/*
          The controls stay; only the grid streams (§166). `CalendarHeader` reads the address
          and never the database, so it renders with the shell and stays pressable while the
          month below it is being fetched — three quick presses on "next" are three presses on
          the same button. The `key` is what asks for the skeleton: React keeps the content of
          a boundary that updates and shows the fallback for one that is new, so the key names
          exactly what the query depends on and nothing else.
        */}
        <Box component="section" aria-labelledby="calendar-title" id="calendar">
          <CalendarHeader view={view} now={now} query={query} layout={layout} />
          <Suspense
            key={calendarBoundaryKey(view, layout, type)}
            fallback={
              <CalendarBodySkeleton
                label={t("loading")}
                kind={view.kind}
                layout={layout}
                // As many week rows as the month actually spans, four to six (§167): pure
                // arithmetic on the address, so the skeleton is the grid's exact height and
                // the swap moves nothing under it.
                weeks={view.kind === "month" ? monthGrid(view.month).length : 6}
              />
            }
          >
            <EventCalendar view={view} events={inRange} now={now} query={query} layout={layout} />
          </Suspense>
        </Box>

        {/* "Add to your calendar" (§107, §139): three doors (the owner: "this subscription to
            calendar does not work" — a `webcal://` link does nothing where no app claims the
            scheme, which on a desktop is most browsers): Google Calendar's own "add by URL"
            address, `webcal://` for Apple, Outlook and phones, the file itself; the plain
            address folded away for any other app, and the "when does it update" behind an "i"
            (the feed is fresh on every read, §129; when the phone shows a change is the app's
            clock, and the owner asked why Google still showed the old hour). */}
        <Box component="section" aria-labelledby="add-to-calendar" sx={{ mt: 2, p: 1.5, border: 1, borderColor: "divider", borderRadius: 2 }}>
          <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <Typography id="add-to-calendar" component="h3" variant="body2" sx={{ fontWeight: 600, mr: 0.5 }}>
              {t("calendar.addTitle")}
            </Typography>
            <Button
              component="a"
              href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(`${env.APP_BASE_URL}/${locale}/events/calendar.ics`))}`}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              variant="outlined"
              sx={CALENDAR_BUTTON_SX}
            >
              <EventAvailableIcon sx={{ fontSize: 18 }} aria-hidden="true" />
              {t("calendar.subscribeGoogle")}
            </Button>
            <Button component="a" href={webcalUrl(`${env.APP_BASE_URL}/${locale}/events/calendar.ics`)} size="small" variant="outlined" sx={CALENDAR_BUTTON_SX}>
              <CalendarMonthIcon sx={{ fontSize: 18 }} aria-hidden="true" />
              {t("calendar.subscribeApple")}
            </Button>
            <Button component="a" href={`/${locale}/events/calendar.ics`} size="small" variant="outlined" sx={CALENDAR_BUTTON_SX}>
              <DownloadIcon sx={{ fontSize: 18 }} aria-hidden="true" />
              {t("calendar.downloadLink")}
            </Button>
            <InfoTip text={t("calendar.refreshNote")} />
          </Stack>
          {/* A fold looks like a fold (§164): the marker back, the pointer, an underline on
              hover and on focus. It had been a flex box, which removes the triangle in
              Chrome and Safari — the owner: "it's not clear that this is expandable". */}
          <Box component="details" sx={{ mt: 0.5, ...DISCLOSURE_SX, "& > summary": { ...DISCLOSURE_SUMMARY_SX, fontSize: "0.8125rem", color: "text.secondary" } }}>
            <summary>{t("calendar.feedAddress")}</summary>
            <Box component="code" sx={{ fontSize: "0.8125rem", userSelect: "all", wordBreak: "break-all" }}>{`${env.APP_BASE_URL}/${locale}/events/calendar.ics`}</Box>
          </Box>
        </Box>
      </Box>

      <Suspense fallback={<EventListSkeleton label={t("loading")} />}>
        <ListingBody listing={listing} type={type} now={now} />
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
  listing: Promise<Listing>;
  type?: EventType;
  layout: CalendarLayout;
  locale: "ro" | "en";
  now: Date;
}) {
  const { events, hasUpcoming } = await listing;
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  // `hasUpcoming` is what keeps a *past* race out of the hero (§167): between seasons the
  // page is handed the club's last event so it is not blank, and that row still carries the
  // featured flag it had when it was next. It belongs under the notice as an ordinary card.
  const { featured } = listingSections(events, type, hasUpcoming);
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

      {featured && <FeaturedEventHero event={featured} now={now} />}

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
 * Everything that is not the lead event.
 *
 * Under a hero, the rest is "other events": a heading and denser cards — no excerpt, the
 * facts and the title are what a reader scans for the next Sunday.
 *
 * On a phone the heading is a native disclosure (`DECISIONS.md` §78): open when there are
 * four or fewer, folded when there are more, so the lead event is not followed by a scroll of
 * cards. On a wide screen the same element is always open — the browser's
 * `::details-content` is told to stay visible and the marker is hidden — because a wide
 * screen has room, and a reader there cannot tell a heading from a control.
 */
async function ListingBody({ listing, type, now }: { listing: Promise<Listing>; type?: EventType; now: Date }) {
  const { events, hasUpcoming } = await listing;
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
            mb: 2,
            cursor: { xs: "pointer", sm: "default" },
            listStyle: { xs: "revert", sm: "none" },
            pointerEvents: { xs: "auto", sm: "none" },
          }}
        >
          {t("othersCount", { count: cards.length })}
        </Typography>
        <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {cards.map((series, index) =>
            series.members.length > 1 ? (
              <SeriesCard key={series.key} members={series.members} index={index} now={now} underHero />
            ) : (
              <EventCard key={series.key} event={series.members[0]} index={index} now={now} underHero />
            ),
          )}
        </Stack>
      </Box>
    );
  }

  if (listed.length === 0) return <Alert severity="info">{t("empty")}</Alert>;

  return (
    <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {cards.map((series, index) =>
        series.members.length > 1 ? (
          <SeriesCard key={series.key} members={series.members} index={index} now={now} />
        ) : (
          <EventCard key={series.key} event={series.members[0]} index={index} now={now} />
        ),
      )}
    </Stack>
  );
}

/**
 * One event on the listing. Each card rises into place in reading order and lifts under a
 * pointer — CSS only, and none of it for a reader who asked for less motion
 * (`theme/motion.ts`). Under a hero the card is denser: no excerpt.
 */
async function EventCard({
  event,
  index,
  now,
  underHero = false,
}: {
  event: PublicEvent;
  index: number;
  now: Date;
  underHero?: boolean;
}) {
  const tEvent = await getTranslations("Event");
  return (
    <Card component="li" variant="outlined" sx={{ ...liftOnHover, ...riseIn(index) }}>
      <CardLink href={{ pathname: "/events/[slug]", params: { slug: event.slug } }}>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1, alignItems: "center" }}>
            {/* What it is and what it is run on, with their glyphs (§112). */}
            <EventKindChips type={event.type} surface={event.surface} />
            {/* An edition apart (§168): an anniversary, a charity run, a date the club joins
                somebody else's race. Any number of events may wear it. */}
            {event.isSpecial && <GlyphChip glyph="special" color="secondary" label={tEvent("special")} />}
            {/* BR-REQ-020-01 criterion 2: a cancelled event stays listed and says so. */}
            {event.eventStatus === "CANCELLED" && <Chip size="small" color="error" label={tEvent("cancelled")} />}
            {event.eventStatus === "COMPLETED" && <Chip size="small" label={tEvent("completed")} />}
          </Stack>

          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {event.title}
          </Typography>

          {event.excerpt && !underHero && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {event.excerpt}
            </Typography>
          )}

          {/* No links inside: the card is the link. */}
          <EventFacts event={event} now={now} variant="compact" links={false} />

          {/*
            The card has always been one big link (`CardLink`), and nothing said so. Text plus
            an arrow rather than a second button: the whole card is already the tap target
            (BR-REQ-041-01 criterion 6), and a real button inside a link would be a control
            inside a control.
          */}
          <Typography aria-hidden="true" variant="body2" sx={{ mt: 2, color: "primary.main", fontWeight: 500 }}>
            {tEvent("seeDetails")} →
          </Typography>
        </CardContent>
      </CardLink>
    </Card>
  );
}
