import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { webcalUrl } from "@/modules/events/ical";
import { env } from "@/shared/config/env";
import Box from "@mui/material/Box";
import type { Metadata } from "next";
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
import { sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import CardLink from "@/shared/ui/CardLink";
import JsonLd from "@/shared/ui/JsonLd";
import Wordmark from "@/shared/ui/Wordmark";
import { findLatestPastEvent, listPublishedEventsBetween, listUpcomingEvents, type PublicEvent } from "@/modules/events/repository";
import { monthRange, parseMonth, parseYear, yearRange } from "@/modules/events/domain/calendar";
import { EVENT_TYPES } from "@/modules/events/domain/event-type";
import { getPathname } from "@/i18n/navigation";
import EventCalendar, { type CalendarView } from "@/modules/events/ui/EventCalendar";
import { CLUB_TIME_ZONE } from "@/modules/jobs/quiet-hours";
import { PAGE_WIDTH } from "@/theme/brand";
import { liftOnHover, riseIn } from "@/theme/motion";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string | string[]; year?: string | string[]; type?: string | string[] }>;
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

export default async function EventsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { month: monthParam, year: yearParam, type: typeParam } = await searchParams;
  // The type filter (§89): one of the closed set, or everything.
  const typeRaw = Array.isArray(typeParam) ? typeParam[0] : typeParam;
  const type = EVENT_TYPES.find((candidate) => candidate === typeRaw);
  const query: Record<string, string> = type ? { type } : {};
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const tSite = await getTranslations("Site");
  // One timestamp for the whole page, so two cards cannot disagree about whether
  // registration has closed, or about where the line between past and upcoming falls.
  const now = new Date();
  const db = getDb();
  const upcoming = await listUpcomingEvents(db, locale, now);
  // Only asked for when there is nothing to lead with: between seasons an empty page reads as
  // a broken site, so the last event that happened stands in, dated.
  const latestPast = upcoming.length === 0 ? await findLatestPastEvent(db, locale, now) : undefined;
  const events = upcoming.length > 0 ? upcoming : latestPast ? [latestPast] : [];
  // The month view (`DECISIONS.md` §89): the month the URL names, or this one — or the whole
  // year it names (§116). The year wins when both are given: it is the wider question.
  const year = parseYear(yearParam, now, CLUB_TIME_ZONE);
  const view: CalendarView = year ? { kind: "year", year } : { kind: "month", month: parseMonth(monthParam, now, CLUB_TIME_ZONE) };
  const range = view.kind === "year" ? yearRange(view.year, CLUB_TIME_ZONE) : monthRange(view.month, CLUB_TIME_ZONE);
  const inRange = (await listPublishedEventsBetween(db, locale, range.from, range.to)).filter(
    (event) => !type || event.type === type,
  );

  /**
   * The club's lead event, shown in full above the list.
   *
   * Taken from the rows already fetched rather than queried again: `listUpcomingEvents` orders
   * featured first, so if there is one it is the first row. It is then dropped from the list
   * below — the same event as both the hero and the first card reads as a duplicate, not as
   * emphasis.
   */
  const featured = upcoming.length > 0 && upcoming[0].featured ? upcoming[0] : undefined;
  const listed = (featured ? events.filter((event) => event.id !== featured.id) : events).filter(
    (event) => !type || event.type === type,
  );
  // A repeated event is one card (`DECISIONS.md` §113): the same title and type, grouped, in
  // the order the first occurrence had; a single event is a card as before.
  const cards = groupSeries(listed);

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

      <Typography variant="h1" gutterBottom sx={{ mt: 2 }}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        {t("intro")}
      </Typography>

      {upcoming.length === 0 && latestPast && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("noUpcoming")}
        </Alert>
      )}

      {featured && <FeaturedEventHero event={featured} now={now} />}

      {/* What kind: one chip per type, a link each, kept by the month links (§89). */}
      <Stack component="nav" aria-label={t("filter.label")} direction="row" sx={{ flexWrap: "wrap", gap: 1, mt: 4 }}>
        {[undefined, ...EVENT_TYPES].map((candidate) => {
          const active = candidate === type;
          // A string href: a component reference cannot cross into MUI's client component —
          // and neither can an icon element (`GlyphChip`), so the type's chip takes a name.
          const href = getPathname({ locale, href: { pathname: "/events", query: candidate ? { type: candidate } : {} } });
          // 44px tall (BR-REQ-041-01 criterion 6): a filter is a tap target like any other link.
          const sx = { height: 44, borderRadius: 22, px: 0.5, fontSize: "0.9375rem" };
          return candidate ? (
            <GlyphChip
              key={candidate}
              glyph={`type:${candidate}`}
              href={href}
              color={active ? "primary" : "default"}
              variant={active ? "filled" : "outlined"}
              label={tEvent(`type.${candidate}`)}
              sx={sx}
            />
          ) : (
            <Chip
              key="all"
              component="a"
              href={href}
              clickable
              color={active ? "primary" : "default"}
              variant={active ? "filled" : "outlined"}
              label={t("filter.all")}
              sx={sx}
            />
          );
        })}
      </Stack>

      {/* Every Monday, every Wednesday, some weekends: a month, not a list, is how the club runs. */}
      <Box sx={{ mt: 2, mb: 4 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {/* Three doors (the owner: "this subscription to calendar does not work" — a `webcal://`
            link does nothing where no app claims the scheme, which on a desktop is most
            browsers): Google Calendar's own "add by URL" address, `webcal://` for Apple,
            Outlook and phones, and the plain address to paste anywhere else. */}
        {t("calendar.subscribe")}{" "}
        <MuiLink
          href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(`${env.APP_BASE_URL}/${locale}/events/calendar.ics`))}`}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
        >
          {t("calendar.subscribeGoogle")}
        </MuiLink>
        {" · "}
        <MuiLink href={webcalUrl(`${env.APP_BASE_URL}/${locale}/events/calendar.ics`)} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          {t("calendar.subscribeApple")}
        </MuiLink>
        {" · "}
        <MuiLink href={`/${locale}/events/calendar.ics`} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          {t("calendar.downloadLink")}
        </MuiLink>
        {" · "}
        <Box component="code" sx={{ fontSize: "0.8125rem", userSelect: "all", wordBreak: "break-all" }}>{`${env.APP_BASE_URL}/${locale}/events/calendar.ics`}</Box>
      </Typography>
      <EventCalendar view={view} events={inRange} now={now} query={query} />
      </Box>

      {/*
        Under a hero, the rest is "other events": a heading and denser cards — no excerpt,
        the facts and the title are what a reader scans for the next Sunday.

        On a phone the heading is a native disclosure (`DECISIONS.md` §78): open when there
        are four or fewer, folded when there are more, so the lead event is not followed by a
        scroll of cards. On a wide screen the same element is always open — the browser's
        `::details-content` is told to stay visible and the marker is hidden — because a wide
        screen has room, and a reader there cannot tell a heading from a control.
      */}
      {featured && listed.length > 0 && (
        <Box
          component="details"
          open={cards.length <= 4}
          data-testid="other-events"
          sx={{
            "& > summary": {
              cursor: { xs: "pointer", sm: "default" },
              listStyle: { xs: "revert", sm: "none" },
              pointerEvents: { xs: "auto", sm: "none" },
            },
            "&::details-content": { display: { sm: "block" }, contentVisibility: { sm: "visible" } },
          }}
        >
          <Typography
            component="summary"
            variant="h2"
            sx={{ fontSize: "1.25rem", mb: 2, minHeight: 44, display: "flex", alignItems: "center" }}
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
      )}

      {!featured &&
        (listed.length === 0 ? (
          <Alert severity="info">{t("empty")}</Alert>
        ) : (
          <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, m: 0 }}>
            {cards.map((series, index) =>
              series.members.length > 1 ? (
                <SeriesCard key={series.key} members={series.members} index={index} now={now} />
              ) : (
                <EventCard key={series.key} event={series.members[0]} index={index} now={now} />
              ),
            )}
          </Stack>
        ))}
    </Container>
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
