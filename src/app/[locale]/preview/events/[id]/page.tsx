import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findTranslationForPreview } from "@/modules/content/events/repository";
import { withoutPlaces } from "@/modules/events/domain/schedule";
import type { PublicEvent } from "@/modules/events/repository";
import { EVENT_LINK_KINDS, type EventLinkKind } from "@/modules/events/domain/links";
import EventFacts from "@/modules/events/ui/EventFacts";
import EventLinks from "@/modules/events/ui/EventLinks";
import EventProgramme from "@/modules/events/ui/EventProgramme";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import EventDescription from "@/modules/events/ui/EventDescription";
import { isDevStaffSwitcherEnabled } from "@/modules/staff-identity/dev-switcher";
import { EDITORIAL_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { getCurrentStaffUser } from "@/modules/staff-identity/session";
import { PAGE_WIDTH } from "@/theme/brand";

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
  // The public badge is the public catalogue’s word, not the editor’s box (§169).
  const tEvent = await getTranslations("Event");
  const now = new Date();

  /**
   * The same shape the public page renders, assembled from the editable rows.
   *
   * Written out field by field rather than spread from the two rows, so a column added to
   * `events` or `event_translations` cannot arrive on a public component by accident — the
   * public queries name their columns for the same reason (BR-REQ-070-01).
   */
  // The place not announced yet (§328) is withheld here exactly as the public query withholds it,
  // so the preview shows the sentence the page will show — including the programme rows' places.
  const placeLater = event.locationToBeAnnounced;
  const preview: PublicEvent = {
    id: event.id,
    type: event.type,
    surface: event.surface,
    eventStatus: event.eventStatus,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    raceStartsAt: event.raceStartsAt,
    timezone: event.timezone,
    mapUrl: placeLater ? null : event.mapUrl,
    routeUrl: event.routeUrl,
    videoUrl: event.videoUrl,
    stravaEventUrl: event.stravaEventUrl,
    facebookEventUrl: event.facebookEventUrl,
    featured: event.featured,
    distanceMeters: event.distanceMeters,
    elevationGainMeters: event.elevationGainMeters,
    registrationMode: event.registrationMode,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
    minAge: event.minAge,
    updatedAt: event.updatedAt,
    externalRegistrationUrl: event.externalRegistrationUrl,
    externalProvider: event.externalProvider,
    participantListVisibility: event.participantListVisibility,
    // One value for the whole event (`DECISIONS.md` §36), so the preview reads them from the
    // event row exactly as the public page does — the place's *name* in this language first,
    // when the club gave it one (migration `0058`), as `PUBLIC_COLUMNS` reads it.
    locationName: placeLater ? null : translation.locationName?.trim() || event.locationName,
    locationAddress: placeLater ? null : event.locationAddress,
    locationToBeAnnounced: placeLater,
    difficulty: event.difficulty,
    costType: event.costType,
    costAmount: event.costAmount,
    costUrl: event.costUrl,
    slug: translation.slug,
    title: translation.title,
    excerpt: translation.excerpt,
    excerptJson: translation.excerptJson,
    bodyJson: translation.bodyJson,
    rulesJson: translation.rulesJson,
    scheduleJson: translation.scheduleJson,
    checklist: translation.checklist,
    scheduleItems: placeLater ? withoutPlaces(event.scheduleItems) : event.scheduleItems,
    coHosts: event.coHosts,
    coHostName: event.coHostName,
    coHostUrl: event.coHostUrl,
    links: event.links,
    isSpecial: event.isSpecial,
    seoTitle: translation.seoTitle,
    seoDescription: translation.seoDescription,
    publishedAt: event.publishedAt,
  };

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
      <Alert severity="warning" sx={{ mb: 3 }}>
        {t("preview.notice", { status: EDITORIAL_STATUS_LABEL[event.editorialStatus] })}
      </Alert>

      <Typography variant="body2" sx={{ mb: 2 }}>
        <Link href={{ pathname: "/admin/events/[id]", params: { id: event.id } }}>
          {t("preview.backToEditor")}
        </Link>
      </Typography>

      {/* As on the public page (§168, §169): the preview is the only way to read a draft
          before it is published, so a box the organizer has just ticked has to show here. */}
      {preview.isSpecial && (
        <Box sx={{ mb: 1 }}>
          <GlyphChip glyph="special" color="secondary" label={tEvent("special")} />
        </Box>
      )}

      <Typography variant="h1" gutterBottom>
        {preview.title}
      </Typography>

      {/* The same component the public page uses, in the same place (§187) — this screen exists
          to show a draft as it will be read, and it used to render the long description five
          blocks higher than the page did. */}
      <EventDescription bodyJson={preview.bodyJson} excerptJson={preview.excerptJson} excerpt={preview.excerpt} />

      <Divider sx={{ my: 3 }} />
      <EventFacts event={preview} now={now} stacked />

      {/* The links (§332), before the programme as on the public page, in the public words. */}
      <EventLinks
        links={preview.links}
        locale={locale}
        heading={tEvent("links.heading")}
        kindLabels={Object.fromEntries(EVENT_LINK_KINDS.map((kind) => [kind, tEvent(`links.kinds.${kind}`)])) as Record<EventLinkKind, string>}
      />

      <EventProgramme scheduleItems={preview.scheduleItems} scheduleJson={preview.scheduleJson} timeZone={preview.timezone} heading={t("editor.fields.schedule")} />
      {!isRichTextEmpty(readRichText(preview.rulesJson)) && (
        <Box component="section" id="rules" sx={{ mt: 4 }}>
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("editor.fields.rules")}
          </Typography>
          <RichText body={preview.rulesJson} />
        </Box>
      )}

      {/* The address is the second line of "Unde" in the facts above (§NNN), as on the public page. */}
    </Container>
  );
}
