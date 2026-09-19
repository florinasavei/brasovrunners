import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findPublishedEventBySlug, findPublishedTranslations } from "@/modules/events/repository";
import { sportsEventJsonLd } from "@/modules/events/structured-data";
import EventFacts from "@/modules/events/ui/EventFacts";
import EventVideo from "@/modules/events/ui/EventVideo";
import { SURFACE_GLYPH, TYPE_GLYPH } from "@/modules/events/ui/glyphs";
import Box from "@mui/material/Box";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import EventExcerpt from "@/modules/events/ui/EventExcerpt";
import RegistrationCta from "@/modules/events/ui/RegistrationCta";
import ShareLinks from "@/modules/events/ui/ShareLinks";
import { googleCalendarUrl } from "@/modules/events/ical";
import StartList from "@/modules/events/ui/StartList";
import { registrationState } from "@/modules/events/domain/registration-window";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import RegistrationSteps from "@/modules/registrations/ui/RegistrationSteps";
import { env } from "@/shared/config/env";
import JsonLd from "@/shared/ui/JsonLd";
import { PAGE_WIDTH } from "@/theme/brand";

type Props = { params: Promise<{ locale: string; slug: string }> };

/**
 * Rendered per request. Organizers publish and cancel events between deploys, so a build-time
 * snapshot would show a run as scheduled after it was called off. It also keeps the database
 * out of the build, which is what lets CI build without one.
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
  return `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } })}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const event = await findPublishedEventBySlug(getDb(), locale, slug);
  if (!event) return {};

  return {
    title: event.seoTitle ?? event.title,
    description: event.seoDescription ?? event.excerpt ?? undefined,
    alternates: {
      canonical: eventUrl(locale, slug),
      // BR-REQ-040-01 criterion 5: each alternate points at *that locale's own slug*, looked
      // up from the database. Never build one by swapping the prefix on this slug — the
      // slugs differ per locale, so a concatenated URL is a 404.
      // Only published locales appear; advertising a draft one is worse than advertising none.
      languages: Object.fromEntries(
        (await findPublishedTranslations(getDb(), event.id)).map((t) => [
          t.locale,
          eventUrl(t.locale, t.slug),
        ]),
      ),
    },
    openGraph: {
      title: event.seoTitle ?? event.title,
      description: event.seoDescription ?? event.excerpt ?? undefined,
      url: eventUrl(locale, slug),
      type: "website",
    },
  };
}

export default async function EventDetailPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const event = await findPublishedEventBySlug(getDb(), locale, slug);
  // An unknown slug, or one whose translation is still Draft or In review, is a 404 — never a
  // redirect to the other locale (BR-REQ-020-01 criterion 1, BR-REQ-040-02).
  if (!event) notFound();

  const t = await getTranslations("Event");
  const tSite = await getTranslations("Site");
  const now = new Date();
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 3, sm: 6 } }}>
      <JsonLd data={sportsEventJsonLd(event, eventUrl(locale, slug), tSite("name"))} />

      <Typography variant="body2" sx={{ mb: 2 }}>
        <Link href="/events">{t("backToEvents")}</Link>
      </Typography>

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
      <Typography variant="h1" gutterBottom>
        {event.title}
      </Typography>

      <EventExcerpt excerptJson={event.excerptJson} excerpt={event.excerpt} />

      <Divider sx={{ my: 3 }} />
      <EventFacts event={event} now={now} />

      {/* The way in to the registration lifecycle, or the sentence saying why there is none. */}
      <RegistrationCta event={event} now={now} />

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
          calendar={{
            icsHref: `/${locale}/events/${slug}/calendar.ics`,
            googleUrl: googleCalendarUrl({ ...event, url: eventUrl(locale, slug) }),
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

      {/* The description proper, when one was written (§11.3, §71). */}
      {!isRichTextEmpty(readRichText(event.bodyJson)) && (
        <Box sx={{ mt: 3 }}>
          <RichText body={event.bodyJson} />
        </Box>
      )}

      {/* The programme (§96), under `#schedule`: kit pickup, briefing, start, cut-offs. */}
      {!isRichTextEmpty(readRichText(event.scheduleJson)) && (
        <Box component="section" id="schedule" sx={{ mt: 4 }}>
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("schedule")}
          </Typography>
          <RichText body={event.scheduleJson} />
        </Box>
      )}

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
      <StartList event={event} />
    </Container>
  );
}
