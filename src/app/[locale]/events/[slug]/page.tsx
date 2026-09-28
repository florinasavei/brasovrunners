import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { sportsEventJsonLd } from "@/modules/events/structured-data";
import EventFacts from "@/modules/events/ui/EventFacts";
import EventAgeRule from "@/modules/events/ui/EventAgeRule";
import EventPhotosNotice from "@/modules/events/ui/EventPhotosNotice";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import EventLinks from "@/modules/events/ui/EventLinks";
import EventRoute from "@/modules/events/ui/EventRoute";
import { hasRouteDescription } from "@/modules/events/domain/route-section";
import EventProgramme from "@/modules/events/ui/EventProgramme";
import { EVENT_LINK_KINDS, type EventLinkKind } from "@/modules/events/domain/links";
import { SURFACE_GLYPH, TYPE_GLYPH } from "@/modules/events/ui/glyphs";
import PartnerOverline from "@/modules/events/ui/PartnerOverline";
import Box from "@mui/material/Box";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/Edit";
import GavelIcon from "@mui/icons-material/Gavel";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import EventDescription from "@/modules/events/ui/EventDescription";
import RegistrationCta from "@/modules/events/ui/RegistrationCta";
import DeclarationOffer from "@/modules/group-run-declarations/ui/DeclarationOffer";
import ShareLinks from "@/modules/events/ui/ShareLinks";
import { instagramFileName } from "@/modules/events/instagram-share";
import { absoluteUrl, eventPageUrl } from "@/modules/events/share-links";
import { toCalendarEvent } from "@/modules/events/calendar";
import { datedOrNull } from "@/modules/events/domain/dated";
import { googleCalendarUrl } from "@/modules/events/ical";
import StartList from "@/modules/events/ui/StartList";
import { registrationState } from "@/modules/events/domain/registration-window";
import {
  cachedCurrentApprovedDocument,
  cachedPublishedEventBySlug,
  cachedPublishedTranslations,
} from "@/modules/public-cache/reads";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { parseInterestOutcome, parseInterestSince } from "@/modules/registrations/interest-box";
import RegistrationInterestForm from "@/modules/registrations/ui/RegistrationInterestForm";
import RegistrationSteps from "@/modules/registrations/ui/RegistrationSteps";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { nextWallMidnight } from "@/modules/events/domain/page-clock";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { forecastForEvent } from "@/modules/weather/source";
import { env } from "@/shared/config/env";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { pageAlternates, slugRouteUrls } from "@/modules/seo/alternates";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import JsonLd from "@/shared/ui/JsonLd";
import OpenFoldFromHash from "@/shared/ui/OpenFoldFromHash";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  /**
   * The address's query — `?lista=`, `?interest=`, `?since=`, `?declaratie=` — passed only by the
   * live twin (`app/[locale]/live/events/[slug]/page.tsx`), which the proxy sends such a visit to
   * (§NNN). This static route never reads Next's `searchParams`.
   */
  query?: Promise<EventQuery>;
  /**
   * Whether the signed-in reader may edit the words (§135) — the twin asks the session, for a visit
   * that carries a session cookie; the static copy every stranger is served never shows the button.
   * The editor asserts the role again for itself (BR-REQ-060-01).
   */
  canEdit?: boolean;
};

type EventQuery = { interest?: string | string[]; since?: string | string[]; lista?: string | string[]; declaratie?: string | string[] };

/** One value of a query key, as the page's readers expect it: the first, when the address repeats it. */
const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Static for an anonymous visitor at its bare address, made on its first visit and kept by the CDN
 * (§NNN, amending §333). Organizers publish and cancel events between deploys: every write that
 * changes the event, its places or its start list expires the page through the rows' own tags
 * (§333), so a cancelled run is never served as scheduled. The clock is kept the same way: the page
 * is made again when its door opens or closes, the confirmation or weather window opens, the start
 * list closes, at midnight (the countdown's day), and — while the forecast shows — within the
 * weather's hour. Nothing is prerendered at build (no database in CI).
 *
 * What depends on the reader is the live twin's: `?lista=`, `?interest=`, `?declaratie=`, and a
 * session cookie for the staff edit button (`i18n/live-twin.ts`). A literal, as Next requires: it
 * equals `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const revalidate = 86400;

/** Made on its first visit, never at build: no slug is known before the database is asked (§NNN). */
export function generateStaticParams(): { slug: string }[] {
  return [];
}


function TypeGlyph({ type }: { type: keyof typeof TYPE_GLYPH }) {
  const Icon = TYPE_GLYPH[type];
  return <Icon aria-hidden="true" sx={{ fontSize: 18 }} />;
}

function SurfaceGlyph({ surface }: { surface: keyof typeof SURFACE_GLYPH }) {
  const Icon = SURFACE_GLYPH[surface];
  return <Icon aria-hidden="true" sx={{ fontSize: 18 }} />;
}

/** Absolute URL for this event in a given locale, always derived from APP_BASE_URL. */
function eventUrl(locale: "ro" | "en", slug: string): string {
  return eventPageUrl(env.APP_BASE_URL, locale, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  // The head says nothing rather than failing the page while the database is away (§447): the
  // body's own read decides between its last good copy and the resting page.
  const event = await readOrWhileAway(() => cachedPublishedEventBySlug(locale, slug), undefined);
  if (!event) return {};

  return {
    title: event.seoTitle ?? event.title,
    description: event.seoDescription ?? event.excerpt ?? undefined,
    /*
      Its own canonical, never another date's: a date of a series is its own page, with its own
      places, holds and start list, and it is what the series card's date chips link to (§113,
      §342 canonical and hreflang). The canonical carries no query — `?lista=`, `?interest=` and
      `?since=` are the same page. BR-REQ-040-01 criterion 5: each alternate points at *that
      locale's own slug*, looked up from the database through the public cache (§333) — never
      this slug under another prefix, which is a 404 — and only a published locale appears
      (BR-REQ-040-02); `x-default` is the Romanian one.
    */
    alternates: pageAlternates(
      locale,
      slugRouteUrls(env.APP_BASE_URL, "/events/[slug]", await readOrWhileAway(() => cachedPublishedTranslations(event.id), [])),
    ),
    openGraph: {
      title: event.seoTitle ?? event.title,
      description: event.seoDescription ?? event.excerpt ?? undefined,
      url: eventUrl(locale, slug),
      type: "website",
    },
  };
}

export default async function EventDetailPage({ params, query, canEdit = false }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const asked: EventQuery = (await query) ?? {};
  const [interest, since, lista, declaratie] = [one(asked.interest), one(asked.since), one(asked.lista), one(asked.declaratie)];

  const now = new Date();
  // The countdown and the day's words (§76, §78): the static page is made again at midnight (§NNN).
  await holdPageUntil([nextWallMidnight(now, CLUB_TIME_ZONE)], now);
  /*
    The page's facts, with the last copy of them behind it (§281).

    Both reads sit inside one loader, so a page served from a copy is internally consistent —
    the event and whether it may take an address were true at the same moment. `notFound()` is
    called on the *result*, outside: throwing it in here would be caught by the fallback and
    answered with the previous visitor's page, turning a 404 into a wrong 200.
  */
  const read = await readWithLastGood(
    `event:${locale}:${slug}`,
    async () => {
      const found = await cachedPublishedEventBySlug(locale, slug);
      if (!found) return { event: null, interestBox: false };
      // "Tell me when registration opens" (§146) takes an address, and an address is taken only
      // under an approved privacy notice — the registration form's own rule (BR-REQ-053-01). One
      // read, only while there is a box to show. The box's own action asks the database again
      // before it keeps an address; this only decides whether to draw it.
      const interestBox =
        found.registrationMode === "INTERNAL" &&
        registrationState(found, now) === "NOT_YET_OPEN" &&
        (await cachedCurrentApprovedDocument("PRIVACY_NOTICE", locale, now)) !== undefined;
      return { event: found, interestBox };
    },
    now,
  );
  const { event, interestBox } = read.value;
  // An unknown slug, or one whose translation is still Draft or In review, is a 404 — never a
  // redirect to the other locale (BR-REQ-020-01 criterion 1, BR-REQ-040-02).
  if (!event) notFound();
  // The event's own dates are told on its own wall clock (`raceWeek`, §78): in another zone its day
  // turns at that zone's midnight, and the page is made again then too (§NNN).
  await holdPageUntil([nextWallMidnight(now, event.timezone)], now);

  const t = await getTranslations("Event");
  // Each kind of link's own word in this language (§332), for the route section and "Linkuri și fișiere" alike.
  const linkKindLabels = Object.fromEntries(EVENT_LINK_KINDS.map((kind) => [kind, t(`links.kinds.${kind}`)])) as Record<EventLinkKind, string>;
  const interestOutcome = parseInterestOutcome(interest);
  // A staff member who may edit the words gets the way into the editor from here (§135; the
  // owner: "when I am signed in … I should be able to edit events from the event page"). The live
  // twin reads the session and says so (§NNN); the editor asserts the role again for itself
  // (BR-REQ-060-01). Never on the static copy.
  const editHref = canEdit ? getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: event.id } } }) : null;
  // The forecast for the start (§402): read on the server, from Open-Meteo through the data cache,
  // only within seven days of it; null — and no row — otherwise or when the service did not answer.
  // An event whose date is to be announced (§533) has no forecast, no structured data (a
  // `SportsEvent` requires its `startDate`), no calendar entry and no countdown: `dated` is null.
  const dated = datedOrNull(event);
  const weather = dated ? await forecastForEvent(dated, now) : null;
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {dated && (
      <JsonLd
        data={sportsEventJsonLd(
          dated,
          eventUrl(locale, slug),
          CLUB_NAME,
          [absoluteUrl(env.APP_BASE_URL, `/${locale}/events/${slug}/opengraph-image`), absoluteUrl(env.APP_BASE_URL, `/${locale}/events/${slug}/share-image`)],
          // The page's language, for what a partnership is (§352) — said in this language or not at all.
          locale,
        )}
      />
      )}

      <LastGoodNotice read={read} />

      <Stack direction="row" spacing={2} sx={{ mb: { xs: DENSITY.gapSm, sm: 2 }, alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="body2">
          {/* A left arrow before the words, and a pencil in the staff edit button (§469). */}
          <Link href="/events" style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 44 }}>
            <ArrowBackIcon aria-hidden="true" data-testid="back-arrow" sx={{ fontSize: 18 }} />
            {t("backToEvents")}
          </Link>
        </Typography>
        {editHref && (
          <Button component="a" href={editHref} variant="outlined" size="small" sx={{ minHeight: 44, gap: 1 }}>
            <EditIcon aria-hidden="true" data-testid="edit-glyph" sx={{ fontSize: 18 }} />
            {t("editInBackoffice")}
          </Button>
        )}
      </Stack>

      {/* Stated in words, not only by colour — BR-REQ-070-03 criterion 3. */}
      {event.eventStatus === "CANCELLED" && (
        <Alert severity="error" sx={{ mb: { xs: DENSITY.gapSm, sm: 3 } }}>
          {t("cancelledNotice")}
        </Alert>
      )}
      {/* The race is over (§82): said in words, and registration hides itself below. */}
      {event.eventStatus === "COMPLETED" && (
        <Alert severity="info" sx={{ mb: { xs: DENSITY.gapSm, sm: 3 } }}>
          {t("completedNotice")}
        </Alert>
      )}

      {/* What it is, and — when the club has said — what it is run on (`DECISIONS.md` §61),
          each with its glyph (§112); the words stay, the glyphs decorate. Then, for an event held
          with a partner, the handshake and the generic "Colaborare" / "Partnership"
          marker (§367, amended §375, §379) — the marker the listing card and the calendar wear, which
          never names a partner. The line wraps rather than overflowing a phone, and the small "·"
          before the marker stays at the end of the line it follows. */}
      <Typography variant="overline" color="text.secondary" sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 0.75, rowGap: 0 }}>
        <TypeGlyph type={event.type} />
        {t(`type.${event.type}`)}
        {event.surface && (
          <>
            <span aria-hidden="true">·</span>
            <SurfaceGlyph surface={event.surface} />
            {t(`surface.${event.surface}`)}
          </>
        )}
        <PartnerOverline event={event} />
      </Typography>
      {/* An edition apart (§168): the same badge the card and the hero wear, above the
          title where the overline already says what kind of event this is. */}
      {event.isSpecial && (
        <Box sx={{ mt: 1 }}>
          <GlyphChip glyph="special" color="secondary" label={t("special")} />
        </Box>
      )}

      <Typography variant="h1" gutterBottom>
        {event.title}
      </Typography>

      {/* The description, in the slot the editor's order implies (§187): the long one when it has
          words, the summary otherwise, and then a wordless long description's picture. Shared
          with the preview so the two cannot show it in different places. */}
      <EventDescription bodyJson={event.bodyJson} excerptJson={event.excerptJson} excerpt={event.excerpt} />

      <Divider sx={{ my: { xs: DENSITY.gapSm, sm: 3 } }} />
      {/* The page's own facts (§168, §356): grouped by question, the route and the cost as pills,
          the address under the place. */}
      <EventFacts event={event} now={now} stacked weather={weather} />

      {/* The photographs notice and the group run's self-declaration were here, under the facts;
          since §498 they sit in «Condiții de participare», with the rules, after the programme. */}

      {/* The way in to the registration lifecycle, or the sentence saying why there is none. */}
      <RegistrationCta event={event} now={now} />

      {/* "Tell me when registration opens" (§146), under the date, only while the window is ahead
          and the notice that describes it is approved. A corrected address is timed from the
          render the person is correcting, not from the redirect. */}
      {interestBox && (
        <RegistrationInterestForm
          locale={locale}
          slug={slug}
          renderedAt={(interestOutcome === "invalid" && parseInterestSince(since, now)) || now}
          outcome={interestOutcome}
        />
      )}

      {/* The whole journey in five steps, folded — for the person deciding whether to press (§91). */}
      {event.registrationMode === "INTERNAL" && registrationState(event, now) === "OPEN" && (
        <Box sx={{ mt: { xs: DENSITY.gapSm, sm: 2 } }}>
          <RegistrationSteps
            folded
            reminderHoursBefore={event.reminderHoursBefore}
            window={
              (() => {
                // "Confirm a week before" only while that week is ahead (§104).
                const w = dated && confirmationWindow(dated);
                return w && w.opensAt.getTime() > now.getTime()
                  ? { opensDays: event.confirmationOpensDaysBefore, deadlineDays: event.confirmationDeadlineDaysBefore }
                  : null;
              })()
            }
          />
        </Box>
      )}

      {/* Facebook and WhatsApp take the link; Instagram takes the picture (§90). */}
      <Box sx={{ mt: { xs: DENSITY.gapSm, sm: 2 } }}>
        <ShareLinks
          url={eventUrl(locale, slug)}
          title={event.title}
          imageHref={`/${locale}/events/${slug}/share-image`}
          fileName={instagramFileName(slug)}
          calendar={
            dated ? {
              icsHref: `/${locale}/events/${slug}/calendar.ics`,
              googleUrl: googleCalendarUrl(toCalendarEvent(dated, locale, now), { locale, t }),
            } : undefined
          }
        />
      </Box>

      {/* The address is not repeated here: it is the second line of "Unde" in the facts above
          (§356), under the place's name, which is the one link to the map. */}

      {/* "Traseul" (§387), under `#route`: the route / training description with the route's own
          links first — the route link, the GPX, the map. The facts' route row points here. Not
          between the facts and the registration button, which stays where a phone finds it; the
          first section after them. Nothing at all when this language has no description. */}
      <EventRoute
        descriptionJson={event.routeDescriptionJson}
        links={event.links}
        routeUrl={event.routeUrl}
        locale={locale}
        heading={t("routeSection")}
        openRouteLabel={t("openRoute")}
        kindLabels={linkKindLabels}
      />

      {/* "Linkuri și fișiere" (§332), under `#links`: right after the route's facts and the map,
          because most of them are the route again — the GPX, a map — and before the programme.
          With a route section, the GPX and the map are drawn there instead (§387). Nothing at all
          when the event has none left to show. */}
      <EventLinks
        links={event.links}
        locale={locale}
        heading={t("links.heading")}
        kindLabels={linkKindLabels}
        routeSection={hasRouteDescription(event.routeDescriptionJson)}
      />

      {/* The programme (§96, §117), under `#schedule`: the timed rows, then the text. */}
      <EventProgramme scheduleItems={event.scheduleItems} scheduleJson={event.scheduleJson} timeZone={event.timezone} heading={t("schedule")} />

      {/*
        «Condiții de participare» / "Participation rules" (§498; the owner, 2026-09-27): the
        rules, the minimum age (§505), the photographs notice and a group run's self-declaration, in that order, under one
        fold, closed on arrival, right after the programme. Every event page has one: the photographs notice
        is on all of them (§421), so the fold is never empty.

        A native `<details>` in the start list's outlined shape (`StartList`), working without
        JavaScript; its title is a real `h2` inside the `<summary>`, so it stays in a screen
        reader's list of headings while the fold is shut (§336), and the parts under it are
        `h3`s. The emails, the calendar entry and the registration form link `#rules`, and a group
        run's page is reached at `#declaratie`: a full navigation to either opens the fold through
        the browser's own ancestor-details reveal, and `OpenFoldFromHash` (§336, the backoffice's
        island, mounted here too) opens it for the browsers that do not and for the registration
        form's client-side link, which never runs that algorithm.
      */}
      <Box component="section" aria-labelledby="conditions-title" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 } }}>
        <Box
          component="details"
          id="conditions"
          data-testid="conditions-fold"
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 2,
            px: 2,
            "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 },
            ...DISCLOSURE_OPEN_ARROW,
            "&[open]": { pb: 2 },
          }}
        >
          <Box component="summary">
            <Typography component="h2" id="conditions-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
              <GavelIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
              {t("conditions.heading")}
            </Typography>
          </Box>

          {/* The rules (§96), under `#rules` — the anchor the emails and the declaration point at. */}
          {!isRichTextEmpty(readRichText(event.rulesJson)) && (
            <Box component="section" id="rules" aria-labelledby="rules-title" sx={{ mt: 1 }}>
              <Typography component="h3" id="rules-title" variant="h3" sx={{ fontSize: "1.0625rem", mb: 1 }}>
                {t("rules")}
              </Typography>
              <RichText body={event.rulesJson} />
            </Box>
          )}

          {/* The minimum age (§505; §329, §410): set in the editor's «Regulamentul» for every type,
              so it is read here with the rules rather than as a row of the facts. Nothing for no
              minimum where nobody registers here. */}
          <EventAgeRule event={event} />

          {/* Photographs are a legitimate-interest processing, so every event page — not only the
              gallery — says how to object (§323; the photographs amendment's item 6). */}
          <EventPhotosNotice />

          {/* A group run's self-declaration (§393), at `#declaratie`, last: only where the
              organizer offered it and the club has approved the text of its surface. */}
          {/* `?declaratie=` is the signer's own link from their copy (§523): «Ai semnat deja…», read only from it. */}
          {/* Nothing to sign for while the date is to be announced (§533). */}
          {dated && <DeclarationOffer event={dated} locale={locale} slug={slug} now={now} viewToken={declaratie} />}
        </Box>
        <OpenFoldFromHash />
      </Box>

      {/* Nothing at all unless this event publishes one (BR-REQ-039-01). */}
      {/* Nobody registers before the date is announced (§533), so an undated event has no list. */}
      {dated && <StartList event={dated} page={lista} />}
    </Container>
  );
}
