import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LoginIcon from "@mui/icons-material/Login";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getDb } from "@/db/client";
import { startHeldBack } from "@/modules/events/domain/dated";
import { membersViewer } from "@/modules/events/members-only";
import { volunteerDoorFor } from "@/modules/volunteers/domain/access";
import { readVolunteerInvitationLink } from "@/modules/volunteers/invitation-link";
import { parseInterestSince } from "@/modules/registrations/interest-box";
import { readFormDraft, readSubmittedFacts } from "@/modules/registrations/form-draft";
import { formEventBySlug } from "@/modules/resilience/event-copy";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { volunteerEventDay } from "@/modules/volunteers/domain/volunteer";
import { readVolunteerOffer } from "@/modules/volunteers/offer";
import VolunteerBox from "@/modules/volunteers/ui/VolunteerBox";
import { parseVolunteerBoxes, parseVolunteerOutcome, type VolunteerTyped } from "@/modules/volunteers/ui/volunteer-box";
import { env } from "@/shared/config/env";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import ButtonLink from "@/shared/ui/ButtonLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ volunteer?: string | string[]; vfields?: string | string[]; since?: string | string[]; invite?: string | string[] }>;
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
 * links here (`VolunteerCallout`). The page is as wide as the register page (`PAGE_WIDTH`, §800; the owner, 2026-10-16: «e prea îngust
 * tot formularul»).
 *
 * **404 while the form could not be sent** (`readVolunteerOffer`): the event is not published or is a members' event, takes
 * no volunteers, is cancelled or over, no role needs people, or the privacy notice or the volunteer agreement in force
 * does not describe them — never a form that cannot work. The one exception is a person reading the answer to their own post
 * (`?volunteer=`): the last role the organizers gave away meanwhile still owes them «am primit».
 *
 * **Who may offer (§820).** «Cine se poate oferi» meets the request here (`volunteerDoorFor`): anyone gets the form; for the club's members
 * a signed-in member gets it with the name and the address of the account locked and a stranger one sentence and the members' sign-in;
 * by invitation the page is a 404 without `?invite=<secret>` and, with a live one, the form with the invited address locked. A link
 * that no longer works says which in a sentence under any choice. The server asks the same rule again at the post (BR-REQ-060-01).
 * The page was always per request; nothing per viewer is cached — the session is met only for the members' choice and the link's row only
 * when the address holds a link, on top of the public cache's shared reads.
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

  /*
    Who may offer (§820): the choice (from the cached offer, nothing per viewer in it) met with what only this request knows — the
    emailed link in `?invite=` and, for the members' choice only, the session. The session module is not touched for any other
    choice, so an open event's page costs what it always did. The thank-you after a send is shown to whoever the redirect brought
    back (it carries no secret and the sealed facts are the browser's own); on a by-invitation event it needs those facts, so a typed-in
    `?volunteer=1` is a 404 like any address without a link.
  */
  const inviteSecret = one(asked.invite);
  // No link in the address, no read: an ordinary visit costs the database nothing more than it did.
  const noLink = { reading: null, invitation: null } as const;
  const link = inviteSecret ? await readOrWhileAway(() => readVolunteerInvitationLink(getDb(), event.id, inviteSecret, now), noLink) : noLink;
  // A live link is the door by itself; any other reading (none, spent, withdrawn, run out) leaves the choice's own door, which only the members' choice asks the session about.
  const viewer = outcome !== "done" && link.reading?.standing !== "open" && offer.access === "MEMBERS" ? await membersViewer() : null;
  // …and, on the thank-you only, what the send kept for it (§800): the first name and the address typed.
  const sent = outcome === "done" ? await readSubmittedFacts() : null;
  // The thank-you is the browser's own: a by-invitation event answers `?volunteer=1` with a 404 unless the send's sealed facts came with it.
  const door = outcome === "done" && (offer.access !== "INVITED" || sent !== null) ? ({ kind: "open" } as const) : volunteerDoorFor({ access: offer.access, member: viewer !== null, invite: link.reading });
  // By invitation, without a link (or with one that names none): the page does not exist for this visitor, as a draft's does not.
  if (door.kind === "closed") notFound();

  // What was typed before a refusal (§142), read only when the page is the answer to one.
  const typed: VolunteerTyped = outcome !== null && outcome !== "done" ? ((await readFormDraft()) ?? {}) : {};
  // A link that no longer works says which, in a sentence above the door the choice gives anyway (`volunteerDoorFor`).
  const refusedLink = door.kind === "inviteRefused" ? door.reason : "refused" in door ? door.refused : undefined;
  const t = await getTranslations("Event");
  const eventHref = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  // The date and the place in one short line, in the event's own zone and the page's language (§349); a start to be announced says none (§533).
  const when = event.startsAt && !startHeldBack(event) ? formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true }) : null;
  const where = event.locationName?.trim() ? event.locationName.trim() : null;
  const line = [when, where].filter((part): part is string => part !== null).join(" · ");
  // The same start inside the thank-you's sentence («…, duminică, 15 nov. 2026, la 20:04.»): lower case, the hour with its «la» (§452), as the register page's lead.
  const whenInSentence =
    event.startsAt && !startHeldBack(event) ? formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true, position: "inline" }) : null;

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
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
      {refusedLink && (
        <Alert severity="warning" role="status" sx={{ mb: 2 }} data-testid="volunteers-invite-refused" data-reason={refusedLink}>
          {t(`volunteers.page.invite.${refusedLink}`)}
        </Alert>
      )}
      {door.kind === "signIn" && (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }} data-testid="volunteers-members-only">
          <Alert severity="info" role="note" sx={{ alignSelf: "stretch" }}>
            {t("volunteers.page.membersOnly")}
          </Alert>
          {env.STAFF_AUTH_MODE !== "disabled" && (
            <ButtonLink href={{ pathname: "/sign-in", query: { to: "members", back: "volunteers", slug } }} variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }} data-testid="volunteers-sign-in">
              <LoginIcon aria-hidden="true" sx={glyphSx("medium")} />
              {t("volunteers.page.signIn")}
            </ButtonLink>
          )}
        </Stack>
      )}
      {(door.kind === "open" || door.kind === "member" || door.kind === "invite") && (
      <VolunteerBox
        locale={locale}
        slug={slug}
        eventTitle={event.title}
        whenInSentence={whenInSentence}
        sent={sent}
        roles={offer.roles}
        categories={offer.categories}
        shirts={offer.shirts}
        showCounts={offer.showCounts}
        // The day the date of birth is counted on (§773): the gun's, else the event's, in the event's own zone.
        eventDay={volunteerEventDay(event, now)}
        profile={offer.profile}
        minors={offer.minors}
        listTick={offer.listTick}
        outcome={outcome}
        refused={parseVolunteerBoxes(one(asked.vfields))}
        typed={typed}
        // A corrected form is timed from the render it corrects, like the interest box's (§146).
        renderedAt={(outcome !== null && outcome !== "done" && parseInterestSince(one(asked.since), now)) || now}
        attempt={now.toISOString()}
        lock={
          door.kind === "member" && viewer
            ? { kind: "member", email: viewer.email, name: viewer.displayName }
            : door.kind === "invite" && link.invitation && inviteSecret
              ? { kind: "invite", email: link.invitation.deliveryEmail, secret: inviteSecret }
              : undefined
        }
      />
      )}
    </Container>
  );
}
