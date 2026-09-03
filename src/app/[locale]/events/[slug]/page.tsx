import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
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
      // Only locales that actually have a published translation belong here. Emitting an
      // hreflang for a draft locale advertises a URL that 404s (BR-REQ-040-02).
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
          <Typography variant="body1">{event.locationAddress}</Typography>
        </Stack>
      )}
    </Container>
  );
}
