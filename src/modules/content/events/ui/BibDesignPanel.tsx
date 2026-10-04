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
import { isStorageConfigured } from "@/modules/media/storage";
import {
  BIB_MEMBER_LABEL_MAX,
  BIB_NAME_POSITIONS,
  BIB_NUMBER_SCALES,
  type BibDesign,
  DEFAULT_BIB_DESIGN,
} from "@/modules/registrations/bib-design";
import { CLUB_NAME } from "@/theme/brand";
import { bibPreviewUrl } from "@/modules/registrations/bib-design-query";
import { BIB_FOOTER_TEXT_MAX, bibWebsiteHost } from "@/modules/registrations/bib-footer";
import { BIB_PICTURE_RATIO, type BibPictureSlot } from "@/modules/registrations/bib-picture-frame";
import { readBibPictureFacts } from "@/modules/registrations/bib-pictures";
import { env } from "@/shared/config/env";
import Panel from "@/shared/ui/Panel";
import BibDesignPreview from "./BibDesignPreview";
import BibPictureField, { type BibPictureLabels } from "./BibPictureField";
import BibFooterTextField from "./BibFooterTextField";
import { BIB_COLOURS } from "./bib-colours";

/**
 * What a race number looks like, as the club decides it (`DECISIONS.md` §249; the owner: "I
 * wanna be able to design the BIDs").
 *
 * A Server Component with ordinary inputs, folded away under the colour it extends — the bib's
 * colour has lived in this form since §173 and this is the rest of the same question. No
 * JavaScript decides the switches: the checkboxes and the two selects post their own values. The
 * two pictures — the header strip and the sponsors' band — are the backoffice's own picture
 * control since §560 (`BibPictureField`): an upload or «Din galerie», then the crop box in the
 * place's one shape, the address and the crop in hidden fields the save posts with the rest.
 *
 * The one client island is the preview at the top (`BibDesignPreview`; the owner: "la BID îmi
 * trebuie un preview aici"): the bib as the picture route draws it for a sample runner, with
 * the boxes' current, unsaved values in its address. This component gives it the first address,
 * from the stored design, so the picture is there before any script runs; the island only
 * rebuilds it as the boxes change.
 *
 * **The marker input is not decoration.** A checkbox that is off posts nothing, so a form
 * without this panel — the create form — would otherwise read as "every switch off" and
 * silently redesign a bib. `present=1` is what tells the action that the design was on screen
 * (`app/[locale]/admin/actions.ts`).
 *
 * **The footer is a group of its own** ("Subsol", §317; the owner: "on the bid I have some
 * email, I wanna be able to control and toggle that!"): the switches and the club's own line,
 * laid out in the order they print, each switch naming what it would print on this deployment —
 * the mailbox, the site's host — so the club is never switching on a word it cannot see. The
 * line's box is the panel's second island, for its character count; everything else posts
 * itself, and the preview above follows all of it through the same query-string mirror.
 *
 * **«Numărul membrilor» is the last group** (§664): the switch, the members' header — a colour or
 * a picture through the same `BibPictureField` as the main header, under the members' field names —
 * and «Eticheta», with a preview of a member's bib of its own. Everything else a member's bib
 * prints is the design above; who gets one is the registration's tick and the club's member list.
 */
export default async function BibDesignPanel({
  eventId,
  design = DEFAULT_BIB_DESIGN,
  bibStartNumber,
  bibColour,
  summary,
}: {
  /**
   * The event being designed; the preview asks the picture route for its title and date. Null on
   * the create page (§350): every setting is there, and no preview — the route needs an event.
   */
  eventId: string | null;
  /** What is stored, or the platform's own on an event nobody has designed. */
  design?: BibDesign;
  /** The stored start number and band colour (§173), for the preview's first address. */
  bibStartNumber: number;
  bibColour: string | null;
  /** The card's closed line: what is printed, from the saved design. */
  summary?: string;
}) {
  const t = await getTranslations("Admin");
  // The reader's own language, for the picture list's titles; the form has no locale prop.
  const locale = (await getLocale()) as Locale;
  const initialSrc = eventId ? bibPreviewUrl({ eventId, locale, number: String(bibStartNumber), colour: bibColour, design }) : null;
  const memberSrc = eventId
    ? bibPreviewUrl({ eventId, locale, number: String(bibStartNumber), colour: bibColour, design, member: true })
    : null;
  /*
    The two stored pictures' facts — the asset, its small file, its size for the crop box (§560) —
    read here in one query; the gallery's list is asked for only when «Din galerie» opens (§485).
    A picture that no longer exists reads as none, so the next save drops it from the design.
    Nothing is offered when there is no store configured — a local machine without R2.
  */
  const storage = isStorageConfigured();
  const facts = storage ? await readBibPictureFacts(getDb(), [design.headerImageSrc, design.sponsorImageSrc, design.member.headerImageSrc]) : new Map<string, never>();
  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const ratioWords = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  // What the footer's two switches would print here: this deployment's own values, never a
  // literal — on QA the host is QA's, and the mailbox may not be set at all (§317).
  const siteHost = bibWebsiteHost(env.APP_BASE_URL);
  // The first address the club shows (§442), as the bib routes print it.
  const replyTo = (await shownContactAddressesOrDefault())[0] ?? null;

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

  /**
   * One picture place (§560): the stored picture and its crop, and the words of the control. With
   * `member`, the members' header (§664): the header's place and shape, the members' fields.
   */
  const picture = (slot: BibPictureSlot, place?: "member") => {
    const field = slot === "header" ? "headerImageSrc" : "sponsorImageSrc";
    const src = place === "member" ? design.member.headerImageSrc : design[field];
    const stored = src ? facts.get(src) : undefined;
    const crop = place === "member" ? design.member.headerImageCrop : design[slot === "header" ? "headerImageCrop" : "sponsorImageCrop"];
    const labels: BibPictureLabels = {
      legend: place === "member" ? t("editor.bibDesign.member.headerImageSrc") : t(`editor.bibDesign.${field}`),
      help: place === "member" ? t("editor.bibDesign.member.headerImageSrcHelp") : t(`editor.bibDesign.${field}Help`),
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
      quality: rich.imageQuality,
      crop: {
        title: t("editor.bibDesign.picture.cropTitle"),
        help: t(`editor.bibDesign.picture.cropHelp.${slot}`),
        reset: t(`editor.bibDesign.picture.cropReset.${slot}`),
        position: rich.imageCropPosition,
        ...rich.imageShapes,
      },
      // The place's shape in words: the paper's width to the strip's height (`bib-picture-frame.ts`).
      shape: t(`editor.bibDesign.picture.shape.${slot}`, { ratio: ratioWords.format(BIB_PICTURE_RATIO[slot]) }),
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

  return (
    <Panel glyph="bibDesign" collapsible level={4} id="box-bib-design" title={t("editor.bibDesign.title")} aside={summary} data-testid="bib-design">
      {/* What tells the action that this panel was on the form; see the note above. */}
      <input type="hidden" name="event.bibDesign.present" value="1" />

      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">
          {t("editor.bibDesign.intro")}
        </Typography>

        {/* The bib as it would print with the boxes as they are now, redrawn as they change —
            once the event exists: the picture route draws an event's title and date. */}
        {eventId && initialSrc && (
          <BibDesignPreview
            eventId={eventId}
            locale={locale}
            initialSrc={initialSrc}
            labels={{
              alt: t("editor.bibDesign.previewAlt"),
              caption: t("editor.bibDesign.previewCaption"),
              pending: t("editor.bibDesign.previewPending"),
            }}
          />
        )}

        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
          {(["showName", "showEventTitle", "showDate", "showLogo", "cutMarks"] as const).map((field) => (
            <CheckboxField key={field} name={`event.bibDesign.${field}`} defaultChecked={design[field]}>
              {t(`editor.bibDesign.${field}`)}
            </CheckboxField>
          ))}
        </Stack>

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

        {storage && picture("header")}
        {storage && picture("sponsors")}

        {/* The small print, the club's to compose (§317), in the order it prints: the event,
            the partners, the club's own line, the website, the mailbox. */}
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }} data-testid="bib-design-footer">
          <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {t("editor.bibDesign.footer.title")}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {t("editor.bibDesign.footer.intro")}
          </Typography>
          <Stack spacing={1}>
            <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
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
            <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
              {footerSwitch("showWebsite", t("editor.bibDesign.footer.showWebsite"), siteHost)}
              {footerSwitch("showEmail", t("editor.bibDesign.footer.showEmail"), replyTo)}
            </Stack>
          </Stack>
        </Box>

        {/* «Numărul membrilor» (§664): the members' own header and label; the rest is the design
            above. The switch is what makes the form ask «Vreau numărul de membru». */}
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="bib-design-member">
          <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {t("editor.bibDesign.member.title")}
          </Typography>
          <Stack spacing={1}>
            <CheckboxField
              name="event.bibDesign.member.enabled"
              defaultChecked={design.member.enabled}
              help={t("editor.bibDesign.member.enabledHelp", { club: CLUB_NAME })}
            >
              {t("editor.bibDesign.member.enabled")}
            </CheckboxField>
            {eventId && memberSrc && (
              <BibDesignPreview
                eventId={eventId}
                locale={locale}
                initialSrc={memberSrc}
                member
                labels={{
                  alt: t("editor.bibDesign.member.previewAlt"),
                  caption: t("editor.bibDesign.member.previewCaption"),
                  pending: t("editor.bibDesign.previewPending"),
                }}
              />
            )}
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
                  {t(`editor.bibColours.${choice.key}`)}
                </option>
              ))}
              {design.member.bandColour && !BIB_COLOURS.some((choice) => choice.hex === design.member.bandColour) && (
                <option value={design.member.bandColour}>{design.member.bandColour}</option>
              )}
            </RecallField>
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
          </Stack>
        </Box>

        {eventId && (
          <Typography variant="caption" color="text.secondary">
            {t("editor.bibDesign.previewNote")}
          </Typography>
        )}
      </Stack>
    </Panel>
  );
}
