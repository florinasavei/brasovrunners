import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findTranslationForPreview } from "@/modules/content/events/repository";
import { mapLinkFor } from "@/modules/events/domain/map-link";
import type { PublicEvent } from "@/modules/events/repository";
import EventFacts from "@/modules/events/ui/EventFacts";
import { isDevStaffSwitcherEnabled } from "@/modules/staff-identity/dev-switcher";
import { EDITORIAL_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";

type Props = { params: Promise<{ locale: string; id: string }> };

export const dynamic = "force-dynamic";

/**
 * BR-REQ-051-02 criterion 2: never indexed.
 *
 * Stated three times, and none of them is redundant. Here, so the page itself says so; in the
 * proxy, as an `X-Robots-Tag` header that covers responses which never render metadata; and by
 * omission from `sitemap.xml`, which lists published translations only and therefore cannot
 * contain a preview URL. The path is also disallowed in `robots.txt`.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The staff-only preview of one translation, in the locale of the URL (BR-REQ-051-02).
 *
 * The locale is the route's own, so `/ro/previzualizare/...` previews the Romanian row with
 * Romanian labels and Romanian date formatting. Previewing one language through another
 * language's chrome would show the organizer a page that does not exist.
 */
export default async function PreviewEventPage({ params }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  /**
   * Criterion 1: refused without staff authorization, before a single row is read — so an
   * anonymous request never learns whether the draft exists.
   *
   * The answer is the same as the backoffice gives: the sign-in page where there is a way in,
   * and a 404 everywhere else. This route is not under the `/admin` layout, deliberately —
   * relying on a parent guard that is not there is how a preview link ends up public.
   */
  const staffUser = await getCurrentStaffUser();
  if (!staffUser) {
    if (isDevStaffSwitcherEnabled()) redirect(getPathname({ locale, href: "/sign-in" }));
    notFound();
  }

  const record = await findTranslationForPreview(getDb(), id, locale);
  if (!record) notFound();
  const { event, translation } = record;

  const t = await getTranslations("Admin");
  const now = new Date();

  /**
   * The same shape the public page renders, assembled from the editable rows.
   *
   * Written out field by field rather than spread from the two rows, so a column added to
   * `events` or `event_translations` cannot arrive on a public component by accident — the
   * public queries name their columns for the same reason (BR-REQ-070-01).
   */
  const preview: PublicEvent = {
    id: event.id,
    kind: event.kind,
    eventStatus: event.eventStatus,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    raceStartsAt: event.raceStartsAt,
    timezone: event.timezone,
    latitude: event.latitude,
    longitude: event.longitude,
    mapUrl: event.mapUrl,
    featured: event.featured,
    distanceMeters: event.distanceMeters,
    elevationGainMeters: event.elevationGainMeters,
    registrationMode: event.registrationMode,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    externalRegistrationUrl: event.externalRegistrationUrl,
    externalProvider: event.externalProvider,
    participantListVisibility: event.participantListVisibility,
    // One value for the whole event (`DECISIONS.md` §36), so the preview reads them from the
    // event row exactly as the public page does.
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    difficultyLabel: event.difficultyLabel,
    costText: event.costText,
    slug: translation.slug,
    title: translation.title,
    excerpt: translation.excerpt,
    seoTitle: translation.seoTitle,
    seoDescription: translation.seoDescription,
    publishedAt: event.publishedAt,
  };

  const mapLink = mapLinkFor(preview, env.MAP_LINK_BASE_URL);

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      <Alert severity="warning" sx={{ mb: 3 }}>
        {t("preview.notice", { status: EDITORIAL_STATUS_LABEL[event.editorialStatus] })}
      </Alert>

      <Typography variant="body2" sx={{ mb: 2 }}>
        <Link href={{ pathname: "/admin/events/[id]", params: { id: event.id } }}>
          {t("preview.backToEditor")}
        </Link>
      </Typography>

      <Typography variant="h1" gutterBottom>
        {preview.title}
      </Typography>

      {preview.excerpt && (
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          {preview.excerpt}
        </Typography>
      )}

      <Divider sx={{ my: 3 }} />
      <EventFacts event={preview} now={now} />

      {preview.locationAddress && (
        <Stack sx={{ mt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {mapLink ? (
              <MuiLink
                href={mapLink}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
              >
                {preview.locationAddress}
              </MuiLink>
            ) : (
              preview.locationAddress
            )}
          </Typography>
        </Stack>
      )}
    </Container>
  );
}
