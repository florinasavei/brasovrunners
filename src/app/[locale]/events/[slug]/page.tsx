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
import { mapLinkFor } from "@/modules/events/domain/map-link";
import { sportsEventJsonLd } from "@/modules/events/structured-data";
import EventFacts from "@/modules/events/ui/EventFacts";
import { env } from "@/shared/config/env";
import JsonLd from "@/shared/ui/JsonLd";

type Props = { params: Promise<{ locale: string; slug: string }> };

/**
 * Rendered per request. Organizers publish and cancel events between deploys, so a build-time
 * snapshot would show a run as scheduled after it was called off. It also keeps the database
 * out of the build, which is what lets CI build without one.
 */
export const dynamic = "force-dynamic";


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
  const mapLink = mapLinkFor(event, env.MAP_LINK_BASE_URL);

  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
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

      <Typography variant="overline" color="text.secondary">
        {t(`kind.${event.kind}`)}
      </Typography>
      <Typography variant="h1" gutterBottom>
        {event.title}
      </Typography>

      {event.excerpt && (
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {event.excerpt}
        </Typography>
      )}

      <Divider sx={{ my: 3 }} />
      <EventFacts event={event} now={now} />

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
            {mapLink ? (
              <MuiLink
                href={mapLink}
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
    </Container>
  );
}
