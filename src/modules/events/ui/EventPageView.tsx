import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/Edit";
import GavelIcon from "@mui/icons-material/Gavel";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { toCalendarEvent } from "@/modules/events/calendar";
import { datedOrNull } from "@/modules/events/domain/dated";
import { EVENT_LINK_KINDS, type EventLinkKind } from "@/modules/events/domain/links";
import { registrationState } from "@/modules/events/domain/registration-window";
import { hasRouteDescription } from "@/modules/events/domain/route-section";
import { googleCalendarUrl } from "@/modules/events/ical";
import { instagramFileName } from "@/modules/events/instagram-share";
import type { PublicEventPage } from "@/modules/events/repository";
import { eventPageUrl } from "@/modules/events/share-links";
import DeclarationOffer from "@/modules/group-run-declarations/ui/DeclarationOffer";
import GroupRunSafetyRules from "@/modules/group-run-declarations/ui/GroupRunSafetyRules";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import type { parseInterestOutcome } from "@/modules/registrations/interest-box";
import RegistrationInterestForm from "@/modules/registrations/ui/RegistrationInterestForm";
import RegistrationSteps from "@/modules/registrations/ui/RegistrationSteps";
import type { EventForecast } from "@/modules/weather/domain/forecast";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { LIVE_SEGMENT } from "@/i18n/live-twin";
import { env } from "@/shared/config/env";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import OpenFoldFromHash from "@/shared/ui/OpenFoldFromHash";
import { DENSITY } from "@/theme/density";
import EventAgeRule from "./EventAgeRule";
import EventDescription from "./EventDescription";
import EventFacts from "./EventFacts";
import EventLinks from "./EventLinks";
import EventPhotosNotice from "./EventPhotosNotice";
import EventProgramme from "./EventProgramme";
import EventRoute from "./EventRoute";
import GlyphChip from "./GlyphChip";
import { SURFACE_GLYPH, TYPE_GLYPH } from "./glyphs";
import PartnerOverline from "./PartnerOverline";
import RegistrationCta from "./RegistrationCta";
import type { PreviewDoor } from "./registration-door";
import ShareLinks from "./ShareLinks";
import StartList from "./StartList";

/**
 * What only a page a visitor opens has (§549): the «Anunță-mă» box and how it answered, the
 * signer's own link to a group run's declaration, the start list's page. The preview before saving
 * (§579) has none of them — each reads the public cache or takes an address.
 */
export type EventPageVisit = {
  interestBox: boolean;
  interestOutcome: ReturnType<typeof parseInterestOutcome>;
  /** When the render a corrected address is timed from was made (§146). */
  interestRenderedAt: Date;
  declaratie?: string;
  lista?: string;
};

/**
 * The editor's preview before saving (§579): the draft's door, counted without the public cache and
 * drawn disabled (`draftRegistrationDoor`), and the club's deadlines and family switch the five
 * steps are told with, read from the database rather than through the public cache.
 */
export type EventPagePreview = {
  door: PreviewDoor;
  steps: { deadlines: Deadlines; familyOpen: boolean };
};

function TypeGlyph({ type }: { type: keyof typeof TYPE_GLYPH }) {
  const Icon = TYPE_GLYPH[type];
  return <Icon aria-hidden="true" sx={{ fontSize: 18 }} />;
}

function SurfaceGlyph({ surface }: { surface: keyof typeof SURFACE_GLYPH }) {
  const Icon = SURFACE_GLYPH[surface];
  return <Icon aria-hidden="true" sx={{ fontSize: 18 }} />;
}

/**
 * **The event page's body, as a visitor reads it** — moved out of `app/[locale]/events/[slug]/page.tsx`
 * (§579) so the editor's preview before saving draws the page with the very components, in the very
 * order, the page does, from an event the save has not written yet (`content/events/draft-preview.tsx`):
 * one page, two callers, never a second copy that drifts (§187's lesson, where the preview once drew
 * the description five blocks higher than the page).
 *
 * The page reads the event (its cache, its last good copy, a members' session) and hands it here with
 * `visit`; the preview hands the draft with `previewDoor` and no `visit` — so it draws the door
 * disabled, and nothing that reads the public cache or takes an address: no «Anunță-mă», no
 * declaration to sign, no start list.
 */
export default async function EventPageView({
  event,
  locale,
  slug,
  now,
  weather,
  membersOnly,
  editHref = null,
  visit,
  preview,
}: {
  event: PublicEventPage;
  locale: "ro" | "en";
  slug: string;
  now: Date;
  /** The forecast for the start (§402), read by the caller; null outside the seven days. */
  weather: EventForecast | null;
  /** A members' event read for a members' session (§552). */
  membersOnly: boolean;
  /** The staff edit button's address (§135), the live twin's alone. */
  editHref?: string | null;
  visit?: EventPageVisit;
  /** The preview before saving (§579): what the page otherwise reads from the public cache. */
  preview?: EventPagePreview;
}) {
  const previewDoor = preview?.door;
  const t = await getTranslations("Event");
  // Each kind of link's own word in this language (§332), for the route section and "Linkuri și fișiere" alike.
  const linkKindLabels = Object.fromEntries(EVENT_LINK_KINDS.map((kind) => [kind, t(`links.kinds.${kind}`)])) as Record<EventLinkKind, string>;
  const dated = datedOrNull(event);
  return (
    <>
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
      {(event.isSpecial || membersOnly) && (
        <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {event.isSpecial && <GlyphChip glyph="special" color="secondary" label={t("special")} />}
          {/* For the members alone (§552): said on the page the member opened, never elsewhere. */}
          {membersOnly && <GlyphChip glyph="membersOnly" color="primary" label={t("membersOnly")} />}
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
      {/* In the preview before saving (§579) the draft's door, its button disabled. */}
      <RegistrationCta event={event} now={now} previewDoor={previewDoor} />

      {/* "Tell me when registration opens" (§146), under the date, only while the window is ahead
          and the notice that describes it is approved. A corrected address is timed from the
          render the person is correcting, not from the redirect. */}
      {visit?.interestBox && (
        <RegistrationInterestForm
          locale={locale}
          slug={slug}
          renderedAt={visit.interestRenderedAt}
          outcome={visit.interestOutcome}
        />
      )}

      {/* The whole journey in five steps, folded — for the person deciding whether to press (§91). */}
      {event.registrationMode === "INTERNAL" && registrationState(event, now) === "OPEN" && (
        <Box sx={{ mt: { xs: DENSITY.gapSm, sm: 2 } }}>
          <RegistrationSteps
            folded
            reminderHoursBefore={event.reminderHoursBefore}
            settings={preview?.steps}
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
          url={eventPageUrl(env.APP_BASE_URL, locale, slug)}
          title={event.title}
          imageHref={`/${locale}/events/${slug}/share-image`}
          fileName={instagramFileName(slug)}
          // A members' event is not shared (§552): its link opens for members, its pictures for nobody.
          shareable={!membersOnly}
          calendar={
            dated ? {
              // A members' file is the twin's, per request (§552): the static one reads the public row alone.
              icsHref: membersOnly ? `/${locale}/${LIVE_SEGMENT}/events/${slug}/calendar.ics` : `/${locale}/events/${slug}/calendar.ics`,
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

          {/* A group run's safety rules (§556): the essentials the optional declaration names, for
              everybody who comes, signed or not — above the declaration. Nothing on any other type. */}
          <GroupRunSafetyRules event={event} />

          {/* Photographs are a legitimate-interest processing, so every event page — not only the
              gallery — says how to object (§323; the photographs amendment's item 6). */}
          <EventPhotosNotice />

          {/* A group run's self-declaration (§393), at `#declaratie`, last: only where the
              organizer offered it and the club has approved the text of its surface. */}
          {/* `?declaratie=` is the signer's own link from their copy (§523): «Ai semnat deja…», read only from it. */}
          {/* Nothing to sign for while the date is to be announced (§533). */}
          {/* Not in the preview before saving (§579): the offer reads the approved texts through the public cache. */}
          {dated && visit && <DeclarationOffer event={dated} locale={locale} slug={slug} now={now} viewToken={visit.declaratie} />}
        </Box>
        <OpenFoldFromHash />
      </Box>

      {/* Nothing at all unless this event publishes one (BR-REQ-039-01). */}
      {/* Nobody registers before the date is announced (§533), so an undated event has no list. */}
      {/* Nor a members' event (§552): the public list is a public disclosure (§32), and this page is not public. */}
      {/* Nor in the preview (§579): the list reads the public cache, and a draft has nobody on it. */}
      {dated && !membersOnly && visit && <StartList event={dated} page={visit.lista} />}
    </>
  );
}
