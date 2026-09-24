import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { sportsEventJsonLd } from "@/modules/events/structured-data";
import EventFacts from "@/modules/events/ui/EventFacts";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import EventLinks from "@/modules/events/ui/EventLinks";
import EventProgramme from "@/modules/events/ui/EventProgramme";
import { EVENT_LINK_KINDS, type EventLinkKind } from "@/modules/events/domain/links";
import EventVideo from "@/modules/events/ui/EventVideo";
import { SURFACE_GLYPH, TYPE_GLYPH } from "@/modules/events/ui/glyphs";
import Box from "@mui/material/Box";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import EventDescription from "@/modules/events/ui/EventDescription";
import RegistrationCta from "@/modules/events/ui/RegistrationCta";
import ShareLinks from "@/modules/events/ui/ShareLinks";
import { instagramFileName } from "@/modules/events/instagram-share";
import { absoluteUrl, eventPageUrl } from "@/modules/events/share-links";
import { toCalendarEvent } from "@/modules/events/calendar";
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
import { canEditTexts } from "@/modules/staff-identity/domain/roles";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { pageAlternates, slugRouteUrls } from "@/modules/seo/alternates";
import JsonLd from "@/shared/ui/JsonLd";
import { PAGE_WIDTH } from "@/theme/brand";

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ interest?: string; since?: string; lista?: string }> };

/**
 * Rendered per request. Organizers publish and cancel events between deploys, so a build-time
 * snapshot would show a run as scheduled after it was called off. It also keeps the database
 * out of the build, which is what lets CI build without one.
 *
 * Per request, and still not per query (§333). The page reads things no cache may freeze — the
 * address (`?lista=`, `?interest=`), the clock (whether registration is open, the countdown) and
 * whether a staff member is signed in, for the "edit" button — so the HTML is made afresh every
 * time, from rows the public cache keeps: the event, its translations, the free places, the start
 * list and the privacy notice, each expired by the write that changes it.
 */
export const dynamic = "force-dynamic";


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

  const event = await cachedPublishedEventBySlug(locale, slug);
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
      slugRouteUrls(env.APP_BASE_URL, "/events/[slug]", await cachedPublishedTranslations(event.id)),
    ),
    openGraph: {
      title: event.seoTitle ?? event.title,
      description: event.seoDescription ?? event.excerpt ?? undefined,
      url: eventUrl(locale, slug),
      type: "website",
    },
  };
}

export default async function EventDetailPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { interest, since, lista } = await searchParams;

  const now = new Date();
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

  const t = await getTranslations("Event");
  const tSite = await getTranslations("Site");
  const interestOutcome = parseInterestOutcome(interest);
  // A staff member who may edit the words gets the way into the editor from here (§135; the
  // owner: "when I am signed in … I should be able to edit events from the event page"). The
  // page is rendered per request anyway, so reading the session costs it nothing; the editor
  // asserts the role again for itself (BR-REQ-060-01). Never where there is no sign-in.
  const staffUser = env.STAFF_AUTH_MODE === "disabled" ? null : await readStaffUserOrNone();
  const editHref = staffUser && canEditTexts(staffUser.role) ? getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: event.id } } }) : null;
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
      <JsonLd
        data={sportsEventJsonLd(
          event,
          eventUrl(locale, slug),
          tSite("name"),
          [absoluteUrl(env.APP_BASE_URL, `/${locale}/events/${slug}/opengraph-image`), absoluteUrl(env.APP_BASE_URL, `/${locale}/events/${slug}/share-image`)],
          // The page's language, for what a partnership is (§NNN) — said in this language or not at all.
          locale,
        )}
      />

      <LastGoodNotice read={read} />

      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="body2">
          <Link href="/events">{t("backToEvents")}</Link>
        </Typography>
        {editHref && (
          <Button component="a" href={editHref} variant="outlined" size="small" sx={{ minHeight: 44 }}>
            {t("editInBackoffice")}
          </Button>
        )}
      </Stack>

      {/* Stated in words, not only by colour — BR-REQ-070-03 criterion 3. */}
      {event.eventStatus === "CANCELLED" && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {t("cancelledNotice")}
        </Alert>
      )}
      {/* The race is over (§82): said in words, and registration hides itself below. */}
      {event.eventStatus === "COMPLETED" && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t("completedNotice")}
        </Alert>
      )}

      {/* What it is, and — when the club has said — what it is run on (`DECISIONS.md` §61),
          each with its glyph (§112); the words stay, the glyphs decorate. */}
      <Typography variant="overline" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <TypeGlyph type={event.type} />
        {t(`type.${event.type}`)}
        {event.surface && (
          <>
            <span aria-hidden="true">·</span>
            <SurfaceGlyph surface={event.surface} />
            {t(`surface.${event.surface}`)}
          </>
        )}
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

      <Divider sx={{ my: 3 }} />
      {/* One fact per line here (§168): the page is where they are read one at a time. */}
      <EventFacts event={event} now={now} stacked />

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
        <Box sx={{ mt: 2 }}>
          <RegistrationSteps
            folded
            window={
              (() => {
                // "Confirm a week before" only while that week is ahead (§104).
                const w = confirmationWindow(event);
                return w && w.opensAt.getTime() > now.getTime()
                  ? { opensDays: event.confirmationOpensDaysBefore, deadlineDays: event.confirmationDeadlineDaysBefore }
                  : null;
              })()
            }
          />
        </Box>
      )}

      {/* Facebook and WhatsApp take the link; Instagram takes the picture (§90). */}
      <Box sx={{ mt: 2 }}>
        <ShareLinks
          url={eventUrl(locale, slug)}
          title={event.title}
          imageHref={`/${locale}/events/${slug}/share-image`}
          fileName={instagramFileName(slug)}
          calendar={{
            icsHref: `/${locale}/events/${slug}/calendar.ics`,
            googleUrl: googleCalendarUrl(toCalendarEvent(event, locale, now), { locale, t }),
          }}
        />
      </Box>

      {event.locationAddress && (
        <Stack sx={{ mt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {t("address")}
          </Typography>
          <Typography variant="body1">
            {/*
              The address itself is the map link when the club has given one. One link rather
              than an address followed by a second "open the map": the same destination twice
              on one page is noise for a screen reader and for a crawler.

              The URL is whatever the organizer pasted (AGENTS.md §8 forbids assembling one),
              so it opens in a new tab with `rel="noopener noreferrer"` — the opened page can
              then neither reach back through `window.opener` nor learn where it came from.
            */}
            {event.mapUrl ? (
              <MuiLink
                href={event.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
              >
                {event.locationAddress}
              </MuiLink>
            ) : (
              event.locationAddress
            )}
          </Typography>
        </Stack>
      )}

      {/* "Linkuri și fișiere" (§332), under `#links`: right after the route's facts and the map,
          because most of them are the route again — the GPX, a map — and before the programme.
          Nothing at all when the event has none. */}
      <EventLinks
        links={event.links}
        locale={locale}
        heading={t("links.heading")}
        kindLabels={Object.fromEntries(EVENT_LINK_KINDS.map((kind) => [kind, t(`links.kinds.${kind}`)])) as Record<EventLinkKind, string>}
      />

      {/* The programme (§96, §117), under `#schedule`: the timed rows, then the text. */}
      <EventProgramme scheduleItems={event.scheduleItems} scheduleJson={event.scheduleJson} timeZone={event.timezone} heading={t("schedule")} />

      {/* The rules (§96), under `#rules` — the anchor the emails and the declaration point at. */}
      {!isRichTextEmpty(readRichText(event.rulesJson)) && (
        <Box component="section" id="rules" sx={{ mt: 4 }}>
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("rules")}
          </Typography>
          <RichText body={event.rulesJson} />
        </Box>
      )}

      {/* Last year's film, when the club has one, loaded only when opened (criterion 9). */}
      <EventVideo videoUrl={event.videoUrl} />

      {/* Nothing at all unless this event publishes one (BR-REQ-039-01). */}
      <StartList event={event} page={lista} />
    </Container>
  );
}

/**
 * Who is signed in, or nobody, when the answer needs a database that is not there (§281).
 *
 * The session read is what puts "edit in the backoffice" on the page for staff. During an outage
 * a visitor must still get the page, and a staff member losing a shortcut for a few minutes is
 * not a failure worth a blank screen — they can reach the editor from `/admin`, which is not
 * served from a copy and will tell them plainly that the database is away.
 */
async function readStaffUserOrNone(): Promise<Awaited<ReturnType<typeof getCurrentStaffUser>> | null> {
  try {
    return await getCurrentStaffUser();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
