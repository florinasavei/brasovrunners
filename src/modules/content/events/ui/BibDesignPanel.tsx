import { formatRaceNumber, RACE_NUMBER_FORMATS } from "@/modules/registrations/domain/race-number";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RecallField from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { shownContactAddressesOrDefault } from "@/modules/contact/shown-address";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { listCheckpoints } from "@/modules/event-checkpoints/checkpoints";
import { checkpointsStampPart } from "@/modules/event-checkpoints/domain/checkpoint";
import { bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";
import { isStorageConfigured } from "@/modules/media/storage";
import {
  BIB_EMERGENCY_LABEL_MAX,
  BIB_EMERGENCY_NAME_MAX,
  BIB_EMERGENCY_PHONE_MAX,
  BIB_MEMBER_LABEL_MAX,
  BIB_MEMBER_STYLES,
  BIB_NAME_POSITIONS,
  BIB_NUMBER_SCALES,
  BIB_PROFILE_ORIENTATIONS,
  BIB_PROFILE_SOURCES,
  BIB_SPONSOR_PLACES,
  type BibDesign,
  bibEmergencyLine,
  bibMemberCardColourReadable,
  DEFAULT_BIB_DESIGN,
} from "@/modules/registrations/bib-design";
import { BIB_MEMBER_MARK_PATHS, BIB_MEMBER_MARK_VIEWBOX, BIB_MEMBER_MARKS, isVectorMark } from "@/modules/registrations/bib-member-mark";
import { CLUB_NAME, HEADER_CLEARANCE_PX, LOGO } from "@/theme/brand";
import { bibPreviewUrl } from "@/modules/registrations/bib-design-query";
import { BIB_FOOTER_TEXT_MAX, bibWebsiteHost } from "@/modules/registrations/bib-footer";
import { BIB_PICTURE_RATIO, BIB_PROFILE_PICTURE_RATIOS, type BibPictureSlot } from "@/modules/registrations/bib-picture-frame";
import { readBibPictureFacts } from "@/modules/registrations/bib-pictures";
import { env } from "@/shared/config/env";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import Panel from "@/shared/ui/Panel";
import RadioField from "@/shared/ui/RadioField";
import BibDesignPreview from "./BibDesignPreview";
import BibHeaderWarning from "./BibHeaderWarning";
import BibPictureField, { type BibPictureLabels } from "./BibPictureField";
import BibFooterTextField from "./BibFooterTextField";
import OnlyWhenChosen from "./OnlyWhenChosen";
import OnlyWhenTicked from "./OnlyWhenTicked";
import { BIB_COLOURS } from "./bib-colours";

/** The radios' glyphs, by name from the registry (§318, §759): the GPX's route, a picture, the right way up, turned; the figures' ruler. */
const FiguresGlyph = ACTION_ICONS.profileFigures;
const RouteGlyph = ACTION_ICONS.route;
const PictureGlyph = ACTION_ICONS.picture;
const UprightGlyph = ACTION_ICONS.upright;
const TurnedGlyph = ACTION_ICONS.turned;
const PROFILE_SOURCE_GLYPHS = { gpx: RouteGlyph, picture: PictureGlyph } as const;
const ORIENTATION_GLYPHS = { normal: UprightGlyph, turned: TurnedGlyph } as const;

/** A row of choices that wraps on a phone: the house's ticks and radios side by side where they fit. */
const CHOICE_ROW = { flexWrap: "wrap", columnGap: 2 } as const;

/** A small group's legend inside a section: what the radios below it choose. */
function Legend({ children }: { children: string }) {
  return (
    <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
      {children}
    </Typography>
  );
}

/**
 * What a race number looks like, as the club decides it (`DECISIONS.md` §249; the owner: "I
 * wanna be able to design the BIDs").
 *
 * A Server Component with ordinary inputs, folded away under the race numbers' card. No
 * JavaScript decides the switches: the checkboxes, the radios and the selects post their own
 * values. The picture places — the header strip, the sponsors' band, the profile's picture, the
 * members' pictures — are the backoffice's own picture control since §560 (`BibPictureField`): an
 * upload or «Din galerie», then (but for the profile's) the crop box in the place's one shape, the
 * address and the crop in hidden fields the save posts with the rest.
 *
 * **In named sections, top to bottom as the number prints** (§759, amending §750; the owner,
 * 2026-10-13: «Aici am nevoie de separatoare și iconițe, că nu mai înțeleg nimic...»): «Antet» (the
 * band's colour, its picture, the lockup, the race and its date, the distance badge), «Numărul»
 * (its size, how it is written, the sheet's cut marks), «Numele» (whether and where), «Profilul și
 * urgențele» (the route's profile — from the GPX or a picture, its figures, its orientation, the
 * checkpoints — and the emergency phones: one block above the bottom band, wherever the sponsors
 * go), «Subsol și sponsori» (the sponsors' band and its place, the stubs, the small print), and
 * «Membrii» (the members' own number, its mark — not a place on the bib, so last). Each is a fold of its
 * own with its glyph and a line saying what it holds, closed until opened; every field in it is
 * still in the form while it is closed, so the save posts the whole design.
 *
 * The one client island at the top is the preview (`BibDesignPreview`; the owner: "la BID îmi
 * trebuie un preview aici"): the bib as the picture route draws it for a sample runner, with the
 * boxes' current, unsaved values in its address. On a wide screen it stays in sight while the
 * sections below scroll under it. This component gives it the first address, from the stored
 * design, so the picture is there before any script runs; the island only rebuilds it.
 *
 * **The marker input is not decoration.** A checkbox that is off posts nothing, so a form
 * without this panel — the create form — would otherwise read as "every switch off" and
 * silently redesign a bib. `present=1` is what tells the action that the design was on screen
 * (`app/[locale]/admin/actions.ts`).
 */
export default async function BibDesignPanel({
  eventId,
  design = DEFAULT_BIB_DESIGN,
  bibStartNumber,
  bibColour,
  hasRouteGpx = false,
  summary,
}: {
  /**
   * The event being designed; the preview asks the picture route for its title and date. Null on
   * the create page (§350): every setting is there, and no preview — the route needs an event.
   */
  eventId: string | null;
  /** What is stored, or the platform's own on an event nobody has designed. */
  design?: BibDesign;
  /** The stored start number and band colour (§173), for the preview's first address and «Antet»'s colour. */
  bibStartNumber: number;
  bibColour: string | null;
  /** Whether the event has a route GPX in the store (§718): «Desenat din traseul evenimentului» draws from it, and says so without one. */
  hasRouteGpx?: boolean;
  /** The card's closed line: what is printed, from the saved design. */
  summary?: string;
}) {
  const t = await getTranslations("Admin");
  // The reader's own language, for the picture list's titles; the form has no locale prop.
  const locale = (await getLocale()) as Locale;
  // The route's saved checkpoints (§757): the strip draws them, so what is saved is part of the sample's address (`v=`), and the tick below is offered only when there are some.
  const checkpoints = eventId ? await listCheckpoints(getDb(), eventId) : [];
  const hasCheckpoints = checkpoints.length > 0;
  const version = hasCheckpoints ? bibPictureStamp(checkpointsStampPart(checkpoints)) : undefined;
  const initialSrc = eventId ? bibPreviewUrl({ eventId, locale, number: String(bibStartNumber), colour: bibColour, design, version }) : null;
  const memberSrc = eventId
    ? bibPreviewUrl({ eventId, locale, number: String(bibStartNumber), colour: bibColour, design, member: true, version })
    : null;
  /*
    The stored pictures' facts — the asset, its small file, its size for the crop box (§560) — read
    here in one query; the gallery's list is asked for only when «Din galerie» opens (§485). A
    picture that no longer exists reads as none, so the next save drops it from the design. Nothing
    is offered when there is no store configured — a local machine without R2.
  */
  const storage = isStorageConfigured();
  const facts = storage
    ? await readBibPictureFacts(getDb(), [design.headerImageSrc, design.sponsorImageSrc, design.profileImageSrc, design.member.headerImageSrc, design.member.cardImageSrc])
    : new Map<string, never>();
  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const ratioWords = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const cardRatioWords = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  // What the footer's two switches would print here: this deployment's own values, never a
  // literal — on QA the host is QA's, and the mailbox may not be set at all (§317).
  const siteHost = bibWebsiteHost(env.APP_BASE_URL);
  // The first address the club shows (§442), as the bib routes print it.
  const replyTo = (await shownContactAddressesOrDefault())[0] ?? null;
  const colourChoice = BIB_COLOURS.find((choice) => choice.hex === bibColour);

  /** A footer switch, with what it prints beside its words when there is something to name. */
  const footerSwitch = (
    field: "showEventInFooter" | "showPartners" | "showWebsite" | "showEmail",
    label: string,
    prints?: string | null,
  ) => (
    // A `CheckboxField` like every other tick of the design (§315): it comes back as it was after a
    // refused save, and its label travels as children, never as an element prop (the defect it documents).
    <CheckboxField name={`event.bibDesign.${field}`} defaultChecked={design[field]}>
        <span>
          {label}
          {prints !== undefined ? (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75, overflowWrap: "anywhere" }}>
              {prints ?? t("editor.bibDesign.footer.notConfigured")}
            </Typography>
          ) : null}
        </span>
    </CheckboxField>
  );

  /** One of the design's ticks, with its words. */
  const designTick = (field: "showName" | "showEventTitle" | "showDate" | "showLogo" | "cutMarks", words: string) => (
    <CheckboxField key={field} name={`event.bibDesign.${field}`} defaultChecked={design[field]}>
      {words}
    </CheckboxField>
  );

  /**
   * One picture place (§560): the stored picture and its crop, and the words of the control. With
   * `member`, the members' header (§664): the header's place and shape, the members' fields.
   */
  const picture = (slot: BibPictureSlot, place?: "member") => {
    const field = slot === "header" ? "headerImageSrc" : slot === "profile" ? "profileImageSrc" : "sponsorImageSrc";
    // A member's card (§NNN) is the members' own place; their header is the header's place under their fields (§664).
    const card = slot === "memberCard";
    const src = card ? design.member.cardImageSrc : place === "member" ? design.member.headerImageSrc : design[field];
    const stored = src ? facts.get(src) : undefined;
    const crop = card
      ? design.member.cardImageCrop
      : place === "member"
        ? design.member.headerImageCrop
        : slot === "profile"
          ? null
          : design[slot === "header" ? "headerImageCrop" : "sponsorImageCrop"];
    const labels: BibPictureLabels = {
      legend: card
        ? t("editor.bibDesign.member.cardImageSrc")
        : place === "member"
          ? t("editor.bibDesign.member.headerImageSrc")
          : t(`editor.bibDesign.${field}`),
      help: card
        ? t("editor.bibDesign.member.cardImageSrcHelp")
        : place === "member"
          ? t("editor.bibDesign.member.headerImageSrcHelp")
          : slot === "profile"
            ? // Never cropped, so no crop box says its shape: the help names both of the strip's (§759).
              t("editor.bibDesign.profileImageSrcHelp", {
                alone: ratioWords.format(BIB_PROFILE_PICTURE_RATIOS.alone),
                beside: ratioWords.format(BIB_PROFILE_PICTURE_RATIOS.beside),
              })
            : t(`editor.bibDesign.${field}Help`),
      none: t("editor.bibDesign.noPicture"),
      choose: t("editor.bibDesign.picture.choose"),
      replace: t("editor.bibDesign.picture.replace"),
      remove: t("editor.bibDesign.noPicture"),
      uploading: t("editor.bibDesign.picture.uploading"),
      failed: t("editor.bibDesign.picture.failed"),
      fromGallery: t("editor.bibDesign.picture.fromGallery"),
      gallery: {
        loading: rich.imageGalleryLoading,
        empty: rich.imageGalleryEmpty,
        close: rich.imageGalleryClose,
        filter: rich.imageGalleryFilter,
        noMatch: rich.imageGalleryNoMatch,
        sourceLegend: rich.imageGallerySourceLegend,
        sources: rich.imageGallerySources,
        here: rich.imageGalleryHere.event,
      },
      // The «Calitate» row's line, shorter here (§759): what a bib's pictures are — logos and text, or photographs.
      quality: { ...rich.imageQuality, help: t("editor.bibDesign.picture.qualityHelp") },
      crop: {
        title: t("editor.bibDesign.picture.cropTitle"),
        help: t(`editor.bibDesign.picture.cropHelp.${slot}`),
        reset: t(`editor.bibDesign.picture.cropReset.${slot}`),
        position: rich.imageCropPosition,
        ...rich.imageShapes,
      },
      // The place's shape in words: the paper's width to the strip's height (`bib-picture-frame.ts`).
      // The card's 1.54 would round to «2 la 1»; the strips' 9 and 22 read whole (§NNN).
      shape: t(`editor.bibDesign.picture.shape.${slot}`, { ratio: (card ? cardRatioWords : ratioWords).format(BIB_PICTURE_RATIO[slot]) }),
      chosen: rich.imageChosen,
      stored: rich.imageStored,
      picked: rich.imageFromGalleryPicked,
    };
    return (
      <BibPictureField
        slot={slot}
        picture={stored ? { id: stored.id, src: stored.src, thumb: stored.thumb, width: stored.width, height: stored.height } : null}
        crop={stored ? crop : null}
        scope={eventId ? { kind: "event", id: eventId } : null}
        labels={labels}
        place={place}
      />
    );
  };

  /*
    Each section's closed line (§759): what it holds as saved, in a few words — a closed fold that says
    nothing is a fold nobody opens (`Panel`).
  */
  const words = (...parts: Array<string | null | false>) => parts.filter((part): part is string => Boolean(part)).join(" · ");
  const headerAside = words(
    design.headerImageSrc ? t("editor.bibDesign.sectionSummary.headerPicture") : colourChoice ? t(`editor.bibColours.${colourChoice.key}`) : bibColour ?? t("editor.bibColours.club"),
    design.showLogo && t("editor.bibDesign.showLogo"),
    design.showEventTitle && t("editor.bibDesign.showEventTitle"),
    design.showDate && t("editor.bibDesign.showDate"),
    design.showDistance && t("editor.bibDesign.showDistance"),
  );
  const numberAside = words(t(`editor.bibDesign.scales.${design.numberScale}`), formatRaceNumber(bibStartNumber, design.numberFormat));
  const nameAside = design.showName ? t(`editor.bibDesign.positions.${design.namePosition}`) : t("editor.bibDesign.sectionSummary.nameOff");
  const footerAside = design.sponsorImageSrc
    ? t("editor.bibDesign.sectionSummary.sponsors", { place: t(`editor.bibDesign.sponsorPlaces.${design.sponsorPlace}`) })
    : t("editor.bibDesign.sectionSummary.sponsorsNone");
  /*
    The profile's words follow what the renderers print (`bibProfileRow`): a picture chosen with none
    stored — or one the store no longer has — prints no profile, nor does the GPX on an event without one — so the line says it is missing
    rather than naming a source that draws nothing. The phone follows `bibEmergencyLine`: either number
    alone prints.
  */
  const profileWords = !design.showProfile
    ? null
    : design.profileSource === "picture"
      ? design.profileImageSrc && facts.has(design.profileImageSrc)
        ? t("editor.bibDesign.profileSources.picture")
        : t("editor.bibDesign.sectionSummary.pictureMissing")
      : hasRouteGpx
        ? t("editor.bibDesign.profileSources.gpx")
        : t("editor.bibDesign.sectionSummary.gpxMissing");
  const profileAside =
    words(profileWords, bibEmergencyLine(design, "x") !== null && t("editor.bibDesign.sectionSummary.phone")) ||
    t("editor.bibDesign.sectionSummary.nothing");
  const membersAside = design.member.enabled
    ? words(t("editor.bibDesign.sectionSummary.membersOn"), design.member.mark && t(`editor.bibDesign.member.markShapes.${design.member.markShape}`))
    : t("editor.bibDesign.sectionSummary.membersOff");

  return (
    <Panel glyph="bibDesign" collapsible level={4} id="box-bib-design" title={t("editor.bibDesign.title")} aside={summary} data-testid="bib-design">
      {/* What tells the action that this panel was on the form; see the note above. */}
      <input type="hidden" name="event.bibDesign.present" value="1" />

      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">
          {t("editor.bibDesign.intro")}
        </Typography>

        {/* The bib as it would print with the boxes as they are now, redrawn as they change —
            once the event exists: the picture route draws an event's title and date. In sight on a
            wide screen while the sections below scroll (§759). */}
        {eventId && initialSrc && (
          <Box sx={{ position: { md: "sticky" }, top: { md: HEADER_CLEARANCE_PX.sm }, zIndex: 1, bgcolor: "background.paper", py: 0.5 }}>
            <BibDesignPreview
              eventId={eventId}
              locale={locale}
              initialSrc={initialSrc}
              version={version}
              labels={{
                alt: t("editor.bibDesign.previewAlt"),
                caption: t("editor.bibDesign.previewCaption"),
                pending: t("editor.bibDesign.previewPending"),
              }}
            />
          </Box>
        )}

        {/* «Antet» (§759): the band — its colour or the club's picture — the lockup, the race, its date and the badge. */}
        <Panel glyph="bibHeader" collapsible level={5} title={t("editor.bibDesign.sections.header")} aside={headerAside} data-testid="bib-section-header">
          <Stack spacing={1.5}>
            {/* A palette, not a colour picker (§177): the club's own is the empty choice. */}
            <RecallField
              select
              name="event.bibColour"
              label={t("editor.bibColour")}
              helperText={t("editor.bibColourHelp")}
              defaultValue={bibColour ?? ""}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ width: { sm: 280 } }}
            >
              <option value="">{t("editor.bibColours.club")}</option>
              {BIB_COLOURS.map((choice) => (
                <option key={choice.hex} value={choice.hex}>
                  {t(`editor.bibColours.${choice.key}`)}
                </option>
              ))}
              {bibColour && !colourChoice && <option value={bibColour}>{bibColour}</option>}
            </RecallField>
            <Stack direction="row" sx={CHOICE_ROW}>
              {designTick("showLogo", t("editor.bibDesign.showLogo"))}
              {designTick("showEventTitle", t("editor.bibDesign.showEventTitle"))}
              {designTick("showDate", t("editor.bibDesign.showDate"))}
            </Stack>
            <CheckboxField name="event.bibDesign.showDistance" defaultChecked={design.showDistance} help={t("editor.bibDesign.showDistanceHelp")}>
              {t("editor.bibDesign.showDistance")}
            </CheckboxField>
            {storage && picture("header")}
            {/* The header picture hides the event's name (§750): said while both are on, with the way out. */}
            {storage && <BibHeaderWarning message={t("editor.bibDesign.headerHidesTitle")} initial={Boolean(design.headerImageSrc) && design.showEventTitle} />}
          </Stack>
        </Panel>

        {/* «Numărul» (§759): its size, how it is written (§735), and the sheet's cut marks. */}
        <Panel glyph="bibNumber" collapsible level={5} title={t("editor.bibDesign.sections.number")} aside={numberAside} data-testid="bib-section-number">
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <RecallField
                select
                name="event.bibDesign.numberScale"
                label={t("editor.bibDesign.numberScale")}
                defaultValue={design.numberScale}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ width: { sm: 220 } }}
              >
                {BIB_NUMBER_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {t(`editor.bibDesign.scales.${scale}`)}
                  </option>
                ))}
              </RecallField>
              {/* «Cum arată numărul» (§735): the zeros in front, on the bib and everywhere the number is written. */}
              <RecallField
                select
                name="event.bibDesign.numberFormat"
                label={t("editor.bibDesign.numberFormat")}
                helperText={t("editor.bibDesign.numberFormatHelp")}
                defaultValue={design.numberFormat}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ width: { sm: 260 } }}
              >
                {RACE_NUMBER_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {t(`editor.bibDesign.numberFormats.${format}`)}
                  </option>
                ))}
              </RecallField>
            </Stack>
            {designTick("cutMarks", t("editor.bibDesign.cutMarks"))}
          </Stack>
        </Panel>

        {/* «Numele» (§759): whether the runner's name prints, and above or below the number. */}
        <Panel glyph="bibName" collapsible level={5} title={t("editor.bibDesign.sections.name")} aside={nameAside} data-testid="bib-section-name">
          <Stack spacing={1.5}>
            {designTick("showName", t("editor.bibDesign.showName"))}
            <RecallField
              select
              name="event.bibDesign.namePosition"
              label={t("editor.bibDesign.namePosition")}
              defaultValue={design.namePosition}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ width: { sm: 220 } }}
            >
              {BIB_NAME_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {t(`editor.bibDesign.positions.${position}`)}
                </option>
              ))}
            </RecallField>
          </Stack>
        </Panel>

        {/* «Profilul și urgențele» (§750, amended §759): the route's profile — from the GPX or a picture,
            its figures, its orientation, the checkpoints on the drawn one — and the emergency phones. */}
        <Panel glyph="bibProfile" collapsible level={5} title={t("editor.bibDesign.sections.profile")} aside={profileAside} data-testid="bib-section-profile">
          <Stack spacing={1.5} data-testid="bib-design-extras">
            <CheckboxField name="event.bibDesign.showProfile" defaultChecked={design.showProfile} help={t("editor.bibDesign.showProfileHelp")}>
              {t("editor.bibDesign.showProfile")}
            </CheckboxField>
            {/* Everything the profile decides shows only while it is ticked (the house's OnlyWhenTicked: hidden, still posted). */}
            <OnlyWhenTicked name="event.bibDesign.showProfile" initiallyTicked={design.showProfile}>
              <Stack spacing={1.5} sx={{ pl: { sm: 2 }, borderLeft: { sm: 2 }, borderColor: { sm: "divider" } }}>
                {/* «De unde vine profilul» (§759): the GPX, drawn — the default — or the club's picture. */}
                <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="bib-profile-source">
                  <Legend>{t("editor.bibDesign.profileSource")}</Legend>
                  {BIB_PROFILE_SOURCES.map((source) => {
                    const Glyph = PROFILE_SOURCE_GLYPHS[source];
                    return (
                      <RadioField key={source} name="event.bibDesign.profileSource" value={source} defaultChecked={design.profileSource === source}>
                        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                          <Glyph aria-hidden fontSize="small" sx={{ color: "text.secondary" }} />
                          {t(`editor.bibDesign.profileSources.${source}`)}
                        </Box>
                      </RadioField>
                    );
                  })}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {hasRouteGpx ? t("editor.bibDesign.profileSourceHelp") : t("editor.bibDesign.showProfileNoGpx")}
                  </Typography>
                </Box>
                {storage && (
                  <OnlyWhenChosen name="event.bibDesign.profileSource" value="picture" initial={design.profileSource}>
                    {picture("profile")}
                  </OnlyWhenChosen>
                )}
                <CheckboxField name="event.bibDesign.showProfileFigures" defaultChecked={design.showProfileFigures} help={t("editor.bibDesign.showProfileFiguresHelp")}>
                  <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                    <FiguresGlyph aria-hidden fontSize="small" sx={{ color: "text.secondary" }} />
                    {t("editor.bibDesign.showProfileFigures")}
                  </Box>
                </CheckboxField>
                {/* «Orientarea profilului» (§759): normal, or turned half a circle for the runner — with the phone, as one block, when it is turned too. */}
                <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="bib-profile-orientation">
                  <Legend>{t("editor.bibDesign.profileOrientation")}</Legend>
                  {BIB_PROFILE_ORIENTATIONS.map((orientation) => {
                    const Glyph = ORIENTATION_GLYPHS[orientation];
                    return (
                      <RadioField key={orientation} name="event.bibDesign.profileOrientation" value={orientation} defaultChecked={design.profileOrientation === orientation}>
                        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                          <Glyph aria-hidden fontSize="small" sx={{ color: "text.secondary" }} />
                          {t(`editor.bibDesign.profileOrientations.${orientation}`)}
                        </Box>
                      </RadioField>
                    );
                  })}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {t("editor.bibDesign.profileOrientationHelp")}
                  </Typography>
                </Box>
                {/* «Punctele de control pe profil» (`bib-checkpoints.ts`): on the line drawn from the GPX only, so offered with that source. On by
                    default, drawn only with the event's checkpoints; greyed — and says why — while the event has none: a greyed
                    box posts nothing, so its stored tick is carried in a hidden field and adding checkpoints later finds it. */}
                <OnlyWhenChosen name="event.bibDesign.profileSource" value="gpx" initial={design.profileSource}>
                  <Stack spacing={1}>
                    <CheckboxField
                      name="event.bibDesign.showCheckpoints"
                      defaultChecked={design.showCheckpoints}
                      disabled={!hasCheckpoints}
                      help={hasCheckpoints ? t("editor.bibDesign.showCheckpointsHelp") : t("editor.bibDesign.showCheckpointsNone")}
                    >
                      {t("editor.bibDesign.showCheckpoints")}
                    </CheckboxField>
                    {!hasCheckpoints && design.showCheckpoints && <input type="hidden" name="event.bibDesign.showCheckpoints" value="on" />}
                    {/* «…cu orele limită» (`bib-checkpoints.ts`): off by default; the cut-offs beside the points where every one fits. */}
                    <CheckboxField
                      name="event.bibDesign.showCheckpointTimes"
                      defaultChecked={design.showCheckpointTimes}
                      disabled={!hasCheckpoints}
                      help={hasCheckpoints ? t("editor.bibDesign.showCheckpointTimesHelp") : t("editor.bibDesign.showCheckpointsNone")}
                    >
                      {t("editor.bibDesign.showCheckpointTimes")}
                    </CheckboxField>
                    {!hasCheckpoints && design.showCheckpointTimes && <input type="hidden" name="event.bibDesign.showCheckpointTimes" value="on" />}
                  </Stack>
                </OnlyWhenChosen>
              </Stack>
            </OnlyWhenTicked>

            {/* «Telefon pentru urgențe» (§750, amended §759): its label and up to two numbers, each with its own name, on one line. */}
            <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
              <CheckboxField name="event.bibDesign.showEmergency" defaultChecked={design.showEmergency} help={t("editor.bibDesign.showEmergencyHelp")}>
                {t("editor.bibDesign.showEmergency")}
              </CheckboxField>
            </Box>
            <OnlyWhenTicked name="event.bibDesign.showEmergency" initiallyTicked={design.showEmergency}>
              <Stack spacing={1.5} sx={{ pl: { sm: 2 }, borderLeft: { sm: 2 }, borderColor: { sm: "divider" } }}>
                <RecallField
                  name="event.bibDesign.emergencyLabel"
                  label={t("editor.bibDesign.emergencyLabel")}
                  helperText={t("editor.bibDesign.emergencyLabelHelp", { max: BIB_EMERGENCY_LABEL_MAX })}
                  placeholder={t("bibs.emergencyLabel")}
                  defaultValue={design.emergencyLabel}
                  autoComplete="off"
                  slotProps={{ htmlInput: { maxLength: BIB_EMERGENCY_LABEL_MAX }, inputLabel: { shrink: true } }}
                  sx={{ width: { sm: 360 } }}
                />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <RecallField
                    name="event.bibDesign.emergencyPhoneLabel"
                    label={t("editor.bibDesign.emergencyPhoneLabel")}
                    helperText={t("editor.bibDesign.emergencyPhoneLabelHelp", { max: BIB_EMERGENCY_NAME_MAX })}
                    defaultValue={design.emergencyPhoneLabel}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: BIB_EMERGENCY_NAME_MAX }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 240 } }}
                  />
                  <RecallField
                    name="event.bibDesign.emergencyPhone"
                    type="tel"
                    label={t("editor.bibDesign.emergencyPhone")}
                    helperText={t("editor.bibDesign.emergencyPhoneHelp")}
                    placeholder={t("editor.bibDesign.emergencyPhonePlaceholder")}
                    defaultValue={design.emergencyPhone}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: BIB_EMERGENCY_PHONE_MAX, inputMode: "tel" }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 280 } }}
                  />
                </Stack>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <RecallField
                    name="event.bibDesign.emergencyPhone2Label"
                    label={t("editor.bibDesign.emergencyPhone2Label")}
                    helperText={t("editor.bibDesign.emergencyPhoneLabelHelp", { max: BIB_EMERGENCY_NAME_MAX })}
                    defaultValue={design.emergencyPhone2Label}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: BIB_EMERGENCY_NAME_MAX }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 240 } }}
                  />
                  <RecallField
                    name="event.bibDesign.emergencyPhone2"
                    type="tel"
                    label={t("editor.bibDesign.emergencyPhone2")}
                    helperText={t("editor.bibDesign.emergencyPhone2Help")}
                    placeholder={t("editor.bibDesign.emergencyPhonePlaceholder")}
                    defaultValue={design.emergencyPhone2}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: BIB_EMERGENCY_PHONE_MAX, inputMode: "tel" }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 280 } }}
                  />
                </Stack>
                <CheckboxField name="event.bibDesign.emergencyUpsideDown" defaultChecked={design.emergencyUpsideDown} help={t("editor.bibDesign.emergencyUpsideDownHelp")}>
                  {t("editor.bibDesign.emergencyUpsideDown")}
                </CheckboxField>
              </Stack>
            </OnlyWhenTicked>
          </Stack>
        </Panel>

        {/* «Subsol și sponsori» (§759): the sponsors' band and its place (§750), the stubs, and the small print (§317). */}
        <Panel glyph="bibFooter" collapsible level={5} title={t("editor.bibDesign.sections.footer")} aside={footerAside} data-testid="bib-section-footer">
          <Stack spacing={1.5}>
            {storage && picture("sponsors")}
            {/* «Locul benzii cu sponsori» (§750): «Jos de tot, în subsol» for every event unless the club moves it. */}
            <RecallField
              select
              name="event.bibDesign.sponsorPlace"
              label={t("editor.bibDesign.sponsorPlace")}
              helperText={t("editor.bibDesign.sponsorPlaceHelp")}
              defaultValue={design.sponsorPlace}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ width: { sm: 360 } }}
            >
              {BIB_SPONSOR_PLACES.map((place) => (
                <option key={place} value={place}>
                  {t(`editor.bibDesign.sponsorPlaces.${place}`)}
                </option>
              ))}
            </RecallField>
            <CheckboxField name="event.bibDesign.numberStubs" defaultChecked={design.numberStubs} help={t("editor.bibDesign.numberStubsHelp")}>
              {t("editor.bibDesign.numberStubs")}
            </CheckboxField>
            {/* The small print, the club's to compose (§317), in the order it prints: the event,
                the partners, the club's own line, the website, the mailbox. */}
            <Box component="fieldset" sx={{ border: 0, borderTop: 1, borderColor: "divider", pt: 1.5, px: 0, pb: 0, m: 0, minWidth: 0 }} data-testid="bib-design-footer">
              <Typography component="legend" variant="body2" sx={{ fontWeight: 600, px: 0.5 }}>
                {t("editor.bibDesign.footer.title")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                {t("editor.bibDesign.footer.intro")}
              </Typography>
              <Stack spacing={1}>
                <Stack direction="row" sx={CHOICE_ROW}>
                  {footerSwitch("showEventInFooter", t("editor.bibDesign.footer.showEventInFooter"))}
                  {footerSwitch("showPartners", t("editor.bibDesign.footer.showPartners"))}
                </Stack>
                <BibFooterTextField
                  name="event.bibDesign.footerText"
                  defaultValue={design.footerText}
                  maxLength={BIB_FOOTER_TEXT_MAX}
                  label={t("editor.bibDesign.footer.footerText")}
                  placeholder={t("editor.bibDesign.footer.footerTextPlaceholder")}
                  help={t("editor.bibDesign.footer.footerTextHelp")}
                />
                <Stack direction="row" sx={CHOICE_ROW}>
                  {footerSwitch("showWebsite", t("editor.bibDesign.footer.showWebsite"), siteHost)}
                  {footerSwitch("showEmail", t("editor.bibDesign.footer.showEmail"), replyTo)}
                </Stack>
              </Stack>
            </Box>
          </Stack>
        </Panel>

        {/* «Membrii» (§664): the members' own header and label, and their mark; the rest is the design
            above. The switch is what makes the form ask «Vreau numărul de membru». */}
        <Panel glyph="bibMembers" collapsible level={5} title={t("editor.bibDesign.sections.members")} aside={membersAside} data-testid="bib-section-members">
          <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="bib-design-member">
            <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t("editor.bibDesign.member.title")}
            </Typography>
            <Stack spacing={1.5}>
              <CheckboxField
                name="event.bibDesign.member.enabled"
                defaultChecked={design.member.enabled}
                help={t("editor.bibDesign.member.enabledHelp", { club: CLUB_NAME })}
              >
                {t("editor.bibDesign.member.enabled")}
              </CheckboxField>
              {/* Everything the members' number decides shows only while it is on (the house's
                  OnlyWhenTicked: hidden, still posted), the preview with it. */}
              <OnlyWhenTicked name="event.bibDesign.member.enabled" initiallyTicked={design.member.enabled}>
                <Stack spacing={1.5}>
                  {eventId && memberSrc && (
                    <BibDesignPreview
                      eventId={eventId}
                      locale={locale}
                      initialSrc={memberSrc}
                      version={version}
                      member
                      labels={{
                        alt: t("editor.bibDesign.member.previewAlt"),
                        caption: t("editor.bibDesign.member.previewCaption"),
                        pending: t("editor.bibDesign.previewPending"),
                      }}
                    />
                  )}
                  {/* «Fundalul» (§750): the whole card, or «Același fundal ca restul numerelor» — the header
                      alone, the race's own background kept. While the members' bib is off the
                      select starts on the whole card, whatever was stored; once it is on, the stored choice. */}
                  <RecallField
                    select
                    name="event.bibDesign.member.style"
                    label={t("editor.bibDesign.member.style")}
                    helperText={t("editor.bibDesign.member.styleHelp")}
                    defaultValue={design.member.enabled ? design.member.style : "card"}
                    slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 360 } }}
                  >
                    {BIB_MEMBER_STYLES.map((style) => (
                      <option key={style} value={style}>
                        {t(`editor.bibDesign.member.styles.${style}`)}
                      </option>
                    ))}
                  </RecallField>
                  <RecallField
                    select
                    name="event.bibDesign.member.bandColour"
                    label={t("editor.bibDesign.member.bandColour")}
                    helperText={t("editor.bibDesign.member.bandColourHelp")}
                    defaultValue={design.member.bandColour ?? ""}
                    slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 280 } }}
                  >
                    <option value="">{t("editor.bibDesign.member.eventColour")}</option>
                    {BIB_COLOURS.map((choice) => (
                      <option key={choice.hex} value={choice.hex}>
                        {/* White does not read on it at AA: on the whole card it prints the club's gradient (§750). */}
                        {bibMemberCardColourReadable(choice.hex)
                          ? t(`editor.bibColours.${choice.key}`)
                          : t("editor.bibDesign.member.bandOnly", { colour: t(`editor.bibColours.${choice.key}`) })}
                      </option>
                    ))}
                    {design.member.bandColour && !BIB_COLOURS.some((choice) => choice.hex === design.member.bandColour) && (
                      <option value={design.member.bandColour}>{design.member.bandColour}</option>
                    )}
                  </RecallField>
                  {storage && picture("memberCard", "member")}
                  {storage && picture("header", "member")}
                  <BibFooterTextField
                    name="event.bibDesign.member.label"
                    defaultValue={design.member.label}
                    maxLength={BIB_MEMBER_LABEL_MAX}
                    label={t("editor.bibDesign.member.label")}
                    placeholder={t("bibs.memberLabelDefault", { club: CLUB_NAME })}
                    help={t("editor.bibDesign.member.labelHelp", { max: BIB_MEMBER_LABEL_MAX, club: CLUB_NAME })}
                    countTestId="bib-member-label-count"
                  />
                  {/* «Semn de membru pe număr» (§750): a mark on every member's number, off until ticked. */}
                  <CheckboxField name="event.bibDesign.member.mark" defaultChecked={design.member.mark} help={t("editor.bibDesign.member.markHelp")}>
                    {t("editor.bibDesign.member.mark")}
                  </CheckboxField>
                  {/* «Semnul de membru» (§759): the star by default, the club's logo, or a registry glyph — each radio
                      shows the mark itself, drawn from the one path the sheet and the picture draw (`bib-member-mark.ts`). */}
                  <OnlyWhenTicked name="event.bibDesign.member.mark" initiallyTicked={design.member.mark}>
                    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="bib-member-mark-shape">
                      <Legend>{t("editor.bibDesign.member.markShape")}</Legend>
                      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, columnGap: 2 }}>
                        {BIB_MEMBER_MARKS.map((mark) => (
                          <RadioField key={mark} name="event.bibDesign.member.markShape" value={mark} defaultChecked={design.member.markShape === mark}>
                            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                              {isVectorMark(mark) ? (
                                <Box component="svg" viewBox={`0 0 ${BIB_MEMBER_MARK_VIEWBOX} ${BIB_MEMBER_MARK_VIEWBOX}`} aria-hidden sx={{ width: 22, height: 22, flexShrink: 0, color: "text.primary" }}>
                                  <path d={BIB_MEMBER_MARK_PATHS[mark]} fill="currentColor" />
                                </Box>
                              ) : (
                                // The club's lockup in its own blue, never recoloured (the owner's rule, §711), on the
                                // white plate the bib gives it — on the dark scheme the blue would vanish into the panel.
                                <Box
                                  component="span"
                                  sx={{ flexShrink: 0, display: "inline-flex", bgcolor: "common.white", border: 1, borderColor: "divider", px: 0.5, borderRadius: 0.5 }}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element -- the club's own SVG, a few pixels tall */}
                                  <img src={LOGO.lockup.src} alt="" width={53} height={22} style={{ display: "block" }} />
                                </Box>
                              )}
                              {t(`editor.bibDesign.member.markShapes.${mark}`)}
                            </Box>
                          </RadioField>
                        ))}
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {t("editor.bibDesign.member.markShapeHelp")}
                      </Typography>
                    </Box>
                  </OnlyWhenTicked>
                </Stack>
              </OnlyWhenTicked>
            </Stack>
          </Box>
        </Panel>

        {eventId && (
          <Typography variant="caption" color="text.secondary">
            {t("editor.bibDesign.previewNote")}
          </Typography>
        )}
      </Stack>
    </Panel>
  );
}
