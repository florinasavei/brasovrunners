import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { startHeldBack } from "@/modules/events/domain/dated";
import { parseInterestSince } from "@/modules/registrations/interest-box";
import { readFormDraft } from "@/modules/registrations/form-draft";
import { formEventBySlug } from "@/modules/resilience/event-copy";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { readVolunteerOffer } from "@/modules/volunteers/offer";
import VolunteerBox from "@/modules/volunteers/ui/VolunteerBox";
import { parseVolunteerBoxes, parseVolunteerOutcome, type VolunteerTyped } from "@/modules/volunteers/ui/volunteer-box";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ volunteer?: string | string[]; vfields?: string | string[]; since?: string | string[] }>;
};

/** One value of a query key: the first, when the address repeats it. */
const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/*
  Per request, like the registration page this follows (§549's list of per-request public routes): the form's render time is
  the bot check's clock (§149), what a refused press typed comes back from a sealed cookie (§142), and the answer is in the
  address (`?volunteer=`). The reads under it are the public cache's — the roles, the notice, the agreement — expired by
  every write to them; the page is the form, never the decision: the action asks the database again.
*/
export const dynamic = "force-dynamic";

/** A form page is never in a search index, and neither is the sitemap's to list (`robots.ts`, `sitemap.ts`: the registration's rule). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const robots = { index: false, follow: false };
  if (!hasLocale(routing.locales, locale)) return { robots };
  const event = await readOrWhileAway(() => formEventBySlug(locale, slug), undefined);
  if (!event) return { robots };
  const t = await getTranslations({ locale, namespace: "Event" });
  return { title: t("volunteers.page.title", { event: event.title }), robots };
}

/**
 * The volunteers' own page (§768, amending §754; the owner, 2026-10-14: «formularul trebuie să fie pagină separată, nu embedded
 * în pagina evenimentului»): `/evenimente/<slug>/voluntari` and `/en/events/<slug>/volunteers` — «Vreau să fiu voluntar la
 * <eveniment>», the event's date and place in one short line, the roles that still need people with their descriptions
 * and how many places each has, the form, and the agreement's links. The event's own page keeps only a short box that
 * links here (`VolunteerCallout`).
 *
 * **404 while the form could not be sent** (`readVolunteerOffer`): the event is not published or is a members' event, takes
 * no volunteers, is cancelled or over, no role needs people, or the privacy notice or the volunteer agreement in force
 * does not describe them — never a form that cannot work. The one exception is a person reading the answer to their own post
 * (`?volunteer=`): the last role the organizers gave away meanwhile still owes them «am primit».
 *
 * **Served as the registration page is** (`events/[slug]/register/page.tsx`, the model for a public page with a form):
 * `force-dynamic`, `noindex`, the sealed draft cookie read only after a refusal, the render time the bot check counts
 * from — and the redirect-with-flash of the house's public forms after a send (§427): the thank-you is on this page, in
 * a banner and a toast, never on the event's page.
 */
export default async function EventVolunteersPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const asked = await searchParams;

  const now = new Date();
  // The public read: a members' event (§552) and a draft never reach it, so neither has this page.
  const event = await formEventBySlug(locale, slug);
  if (!event) notFound();
  const outcome = parseVolunteerOutcome(one(asked.volunteer));
  const offer = await readOrWhileAway(() => readVolunteerOffer(event, now, outcome), null);
  if (!offer) notFound();

  // What was typed before a refusal (§142), read only when the page is the answer to one.
  const typed: VolunteerTyped = outcome !== null && outcome !== "done" ? ((await readFormDraft()) ?? {}) : {};
  const t = await getTranslations("Event");
  const eventHref = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  // The date and the place in one short line, in the event's own zone and the page's language (§349); a start to be announced says none (§533).
  const when = event.startsAt && !startHeldBack(event) ? formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true }) : null;
  const where = event.locationName?.trim() ? event.locationName.trim() : null;
  const line = [when, where].filter((part): part is string => part !== null).join(" · ");

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="body2" sx={{ mb: 2 }}>
        {/* The house's back link (§469, `EventPageView`): a left arrow before the words, 44 pixels tall. */}
        <MuiLink href={eventHref} data-testid="volunteers-back" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, ...TAP_TARGET }}>
          <ArrowBackIcon aria-hidden="true" data-testid="volunteers-back-arrow" sx={{ fontSize: 18 }} />
          {t("volunteers.page.back", { event: event.title })}
        </MuiLink>
      </Typography>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }} data-testid="volunteers-title">
        {t("volunteers.page.title", { event: event.title })}
      </Typography>
      {line !== "" && (
        <Typography color="text.secondary" sx={{ mb: 2 }} data-testid="volunteers-when-where">
          {line}
        </Typography>
      )}
      <VolunteerBox
        locale={locale}
        slug={slug}
        roles={offer.roles}
        shirts={offer.shirts}
        profile={offer.profile}
        minors={offer.minors}
        outcome={outcome}
        refused={parseVolunteerBoxes(one(asked.vfields))}
        typed={typed}
        // A corrected form is timed from the render it corrects, like the interest box's (§146).
        renderedAt={(outcome !== null && outcome !== "done" && parseInterestSince(one(asked.since), now)) || now}
        attempt={now.toISOString()}
      />
    </Container>
  );
}
