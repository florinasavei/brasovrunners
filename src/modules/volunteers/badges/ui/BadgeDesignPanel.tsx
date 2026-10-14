import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { saveBadgeDesignAction } from "@/app/[locale]/admin/events/[id]/badges/actions";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import BibDesignPreview from "@/modules/content/events/ui/BibDesignPreview";
import BibHeaderWarning from "@/modules/content/events/ui/BibHeaderWarning";
import BibPictureField, { type BibPictureLabels } from "@/modules/content/events/ui/BibPictureField";
import OnlyWhenChosen from "@/modules/content/events/ui/OnlyWhenChosen";
import OnlyWhenTicked from "@/modules/content/events/ui/OnlyWhenTicked";
import { BIB_COLOURS } from "@/modules/content/events/ui/bib-colours";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { isStorageConfigured } from "@/modules/media/storage";
import { BIB_EMERGENCY_PHONE_MAX } from "@/modules/registrations/bib-design";
import { readBibPictureFacts } from "@/modules/registrations/bib-pictures";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import RadioField from "@/shared/ui/RadioField";
import { HEADER_CLEARANCE_PX } from "@/theme/brand";
import { BADGE_LABEL_MAX, BADGE_PHONE_LABEL_MAX, BADGE_TITLE_MAX, type BadgeDesign, badgeColourReadable } from "../badge-design";
import { BADGE_CUSTOM_BOUNDS, BADGE_SIZE_PRESETS, BADGE_SIZES, badgeImageSize, badgePaper, badgeRows, badgeSheetGrid, badgeSizeMm } from "../badge-geometry";
import { BADGE_DESIGN_FORM_PREFIX, badgePreviewUrl } from "../badge-query";
import { badgeDefaultWords } from "../badge-words";

/** A form box's full name. */
const box = (key: string) => `${BADGE_DESIGN_FORM_PREFIX}${key}`;

/** A small group's legend inside a section: what the radios below it choose (the bib designer's `Legend`). */
function Legend({ children }: { children: string }) {
  return (
    <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
      {children}
    </Typography>
  );
}

/** Two boxes side by side on a computer, one under the other on a phone: a club text in both languages. */
const PAIR = { direction: { xs: "column", sm: "row" }, spacing: 1.5 } as const;

/**
 * «Cum arată ecusonul» (§NNN): the volunteer badge's designer, the bib designer's twin (§759) — named
 * sections top to bottom as the badge prints, each a fold of its own (`Panel`, level 5) with its glyph and
 * a line saying what it holds; the live preview at the top (`BibDesignPreview` with `kind="badge"`, the
 * same island), sticky on a wide screen; the header's picture through the bib's own control
 * (`BibPictureField`, `place="badge"`, its crop box in the header's shape for the saved size), and the
 * same warning when the picture hides the title (`BibHeaderWarning`). A plain form posted by
 * «Salvează ecusonul» (`ActionForm`), every field in it while its fold is closed.
 *
 * No name is printed (the owner: «numele îl scriem manual cu markerul»): «Locul pentru nume» is a white
 * area with «Nume:» and, if the club wants it, a faint line.
 */
export default async function BadgeDesignPanel({
  eventId,
  locale,
  design,
  sampleRole,
  version,
}: {
  eventId: string;
  locale: Locale;
  design: BadgeDesign;
  /** The role the preview's sample is drawn for: the event's first, or `none`. */
  sampleRole: string;
  /** What the sample is drawn from beside the form (the roles' saved names and colours), in its address. */
  version: string;
}) {
  const t = await getTranslations("Admin");
  const storage = isStorageConfigured();
  const facts = storage && design.headerImageSrc ? await readBibPictureFacts(getDb(), [design.headerImageSrc]) : new Map<string, never>();
  const stored = design.headerImageSrc ? facts.get(design.headerImageSrc) : undefined;
  const rich = richTextEditorLabels(await getTranslations("Admin.richText"));
  const messages = await refusalMessages({
    [box("size")]: t("badges.design.size"),
    [box("customWidthMm")]: t("badges.design.customWidth"),
    [box("customHeightMm")]: t("badges.design.customHeight"),
    [box("bandColour")]: t("badges.design.bandColour"),
    [box("titleRo")]: t("badges.design.titleRo"),
    [box("titleEn")]: t("badges.design.titleEn"),
    [box("labelRo")]: t("badges.design.labelRo"),
    [box("labelEn")]: t("badges.design.labelEn"),
    [box("phone")]: t("badges.design.phone"),
    [box("phoneLabelRo")]: t("badges.design.phoneLabelRo"),
    [box("phoneLabelEn")]: t("badges.design.phoneLabelEn"),
  });

  // The header's shape at the saved size, for the crop box (§560's rule; a crop drawn at another size is trimmed, never squashed).
  const rows = badgeRows(badgePaper(design), design.showPhone && design.phone !== "");
  const headerRatio = (badgePaper(design).width - 2 * rows.content.left) / rows.header.height;
  const ratioWords = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const initialSrc = badgePreviewUrl({ eventId, locale, role: sampleRole, design, version });
  const { widthMm, heightMm } = badgeSizeMm(design);
  const perSheet = (size: (typeof BADGE_SIZES)[number]) =>
    size === "custom" ? null : badgeSheetGrid(badgePaper({ size, customWidthMm: 0, customHeightMm: 0 })).perSheet;
  // The palette's colours the band may wear, and a kept colour that is not one of them (an imported event
  // file's): offered as its own selected choice, so «Salvează ecusonul» keeps it unless the person changes it
  // — the bib designer's own rule (`BibDesignPanel`'s band colour). The reader already turned a colour no
  // word reads on into the club's blue, so a kept one always reads.
  const offeredColours = BIB_COLOURS.filter((choice) => badgeColourReadable(choice.hex));
  const colourChoice = offeredColours.find((choice) => choice.hex === design.bandColour);
  const keptColour = design.bandColour && !colourChoice ? design.bandColour : null;
  // The platform's words in each box's own language — what the badge prints in that language when the box is empty.
  const [roDefaults, enDefaults] = await Promise.all([badgeDefaultWords("ro"), badgeDefaultWords("en")]);

  const pictureLabels: BibPictureLabels = {
    legend: t("badges.design.headerPicture"),
    help: t("badges.design.headerPictureHelp"),
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
    quality: { ...rich.imageQuality, help: t("editor.bibDesign.picture.qualityHelp") },
    crop: {
      title: t("editor.bibDesign.picture.cropTitle"),
      help: t("badges.design.headerPictureCropHelp"),
      reset: t("editor.bibDesign.picture.cropReset.header"),
      position: rich.imageCropPosition,
      ...rich.imageShapes,
    },
    shape: t("badges.design.headerPictureShape", { ratio: ratioWords.format(headerRatio) }),
    chosen: rich.imageChosen,
    stored: rich.imageStored,
    picked: rich.imageFromGalleryPicked,
  };

  /** One line of a section's closed summary. */
  const words = (...parts: Array<string | null | false>) => parts.filter((part): part is string => Boolean(part)).join(" · ");
  const sizeAside = t("badges.design.sizeAside", { width: String(widthMm), height: String(heightMm), perSheet: String(badgeSheetGrid(badgePaper(design)).perSheet) });
  const headerAside = words(
    design.headerImageSrc
      ? t("badges.design.headerPicture")
      : colourChoice
        ? t(`editor.bibColours.${colourChoice.key}`)
        : keptColour
          ? t("badges.design.keptColour", { colour: keptColour })
          : t("editor.bibColours.club"),
    design.showLogo && !design.headerImageSrc && t("badges.design.showLogo"),
    design.showTitle && !design.headerImageSrc && t("badges.design.showTitle"),
  );
  const roleAside = design.labelRo ? `${design.labelRo} / ${design.labelEn}` : t("badges.design.labelDefaultAside");
  const writingAside = design.writingLine ? t("badges.design.writingLine") : t("badges.design.writingPlain");
  const phoneAside = design.showPhone && design.phone ? design.phone : t("badges.design.phoneOff");
  const cutAside = design.cutMarks ? t("badges.design.cutMarks") : t("badges.design.cutLinesOnly");

  return (
    <Panel
      glyph="badges"
      collapsible
      level={2}
      id="box-badge-design"
      title={t("badges.design.title")}
      aside={sizeAside}
      // The live preview is the page's own verb (`fold.ts`, §336): open on every arrival.
      openWhen={{ primary: true }}
      data-testid="badge-design"
    >
      <ActionForm action={saveBadgeDesignAction} scope="badge-design" messages={messages} data-testid="badge-design-form">
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={eventId} />
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {t("badges.design.intro")}
          </Typography>

          {/* The badge as it would print with the boxes as they are now, redrawn as they change (the bib's island). */}
          <Box sx={{ position: { md: "sticky" }, top: { md: HEADER_CLEARANCE_PX.sm }, zIndex: 1, bgcolor: "background.paper", py: 0.5 }}>
            <BibDesignPreview
              kind="badge"
              eventId={eventId}
              locale={locale}
              role={sampleRole}
              initialSrc={initialSrc}
              initialBox={badgeImageSize(design)}
              version={version}
              labels={{ alt: t("badges.design.previewAlt"), caption: t(sampleRole === "none" ? "badges.design.previewCaptionNone" : "badges.design.previewCaption"), pending: t("editor.bibDesign.previewPending") }}
            />
          </Box>

          {/* «Dimensiunea»: the two strips, or the club's own size within bounds; how many fit on an A4 sheet. */}
          <Panel glyph="badgeSize" collapsible level={5} title={t("badges.design.sections.size")} aside={sizeAside} data-testid="badge-section-size">
            <Stack spacing={1.5}>
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid="badge-size">
                <Legend>{t("badges.design.size")}</Legend>
                {BADGE_SIZES.map((size) => (
                  <RadioField key={size} name={box("size")} value={size} defaultChecked={design.size === size}>
                    {size === "custom"
                      ? t("badges.design.sizes.custom")
                      : t("badges.design.sizes.preset", {
                          width: String(BADGE_SIZE_PRESETS[size].widthMm),
                          height: String(BADGE_SIZE_PRESETS[size].heightMm),
                          perSheet: String(perSheet(size)),
                        })}
                  </RadioField>
                ))}
              </Box>
              <OnlyWhenChosen name={box("size")} value="custom" initial={design.size}>
                <Stack {...PAIR}>
                  <RecallField
                    name={box("customWidthMm")}
                    type="number"
                    label={t("badges.design.customWidth")}
                    helperText={t("badges.design.customBounds", { min: String(BADGE_CUSTOM_BOUNDS.width.min), max: String(BADGE_CUSTOM_BOUNDS.width.max) })}
                    defaultValue={String(design.customWidthMm)}
                    slotProps={{ htmlInput: { min: BADGE_CUSTOM_BOUNDS.width.min, max: BADGE_CUSTOM_BOUNDS.width.max, step: 1, inputMode: "numeric" }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 220 } }}
                  />
                  <RecallField
                    name={box("customHeightMm")}
                    type="number"
                    label={t("badges.design.customHeight")}
                    helperText={t("badges.design.customHeightBounds", { min: String(BADGE_CUSTOM_BOUNDS.height.min), max: String(BADGE_CUSTOM_BOUNDS.height.max), small: String(BADGE_SIZE_PRESETS.strip90.heightMm) })}
                    defaultValue={String(design.customHeightMm)}
                    slotProps={{ htmlInput: { min: BADGE_CUSTOM_BOUNDS.height.min, max: BADGE_CUSTOM_BOUNDS.height.max, step: 1, inputMode: "numeric" }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 220 } }}
                  />
                </Stack>
              </OnlyWhenChosen>
              <Typography variant="caption" color="text.secondary" data-testid="badge-per-sheet">
                {t("badges.design.perSheet", { count: String(badgeSheetGrid(badgePaper(design)).perSheet), width: String(widthMm), height: String(heightMm) })}
              </Typography>
            </Stack>
          </Panel>

          {/* «Antet»: the band's colour or the club's picture, the logo on its own white ground, the short title. */}
          <Panel glyph="bibHeader" collapsible level={5} title={t("badges.design.sections.header")} aside={headerAside} data-testid="badge-section-header">
            <Stack spacing={1.5}>
              <RecallField
                select
                name={box("bandColour")}
                label={t("badges.design.bandColour")}
                helperText={t("badges.design.bandColourHelp")}
                defaultValue={design.bandColour ?? ""}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ width: { sm: 280 } }}
              >
                <option value="">{t("editor.bibColours.club")}</option>
                {keptColour && <option value={keptColour}>{t("badges.design.keptColour", { colour: keptColour })}</option>}
                {offeredColours.map((choice) => (
                  <option key={choice.hex} value={choice.hex}>
                    {t(`editor.bibColours.${choice.key}`)}
                  </option>
                ))}
              </RecallField>
              <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
                <CheckboxField name={box("showLogo")} defaultChecked={design.showLogo}>
                  {t("badges.design.showLogo")}
                </CheckboxField>
                <CheckboxField name={box("showTitle")} defaultChecked={design.showTitle}>
                  {t("badges.design.showTitle")}
                </CheckboxField>
              </Stack>
              <OnlyWhenTicked name={box("showTitle")} initiallyTicked={design.showTitle}>
                <Stack {...PAIR}>
                  <RecallField
                    name={box("titleRo")}
                    label={t("badges.design.titleRo")}
                    helperText={t("badges.design.titleHelp", { max: String(BADGE_TITLE_MAX) })}
                    defaultValue={design.titleRo}
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: BADGE_TITLE_MAX, autoComplete: "off" }, inputLabel: { shrink: true } }}
                  />
                  <RecallField
                    name={box("titleEn")}
                    label={t("badges.design.titleEn")}
                    helperText={t("badges.design.bothLanguages")}
                    defaultValue={design.titleEn}
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: BADGE_TITLE_MAX, autoComplete: "off" }, inputLabel: { shrink: true } }}
                  />
                </Stack>
              </OnlyWhenTicked>
              {storage && (
                <BibPictureField
                  slot="header"
                  place="badge"
                  ratio={headerRatio}
                  picture={stored ? { id: stored.id, src: stored.src, thumb: stored.thumb, width: stored.width, height: stored.height } : null}
                  crop={stored ? design.headerImageCrop : null}
                  scope={{ kind: "event", id: eventId }}
                  labels={pictureLabels}
                />
              )}
              {storage && (
                <BibHeaderWarning
                  message={t("badges.design.headerHidesTitle")}
                  initial={Boolean(design.headerImageSrc) && design.showTitle}
                  fields={{ picture: box("headerImageSrc"), title: box("showTitle") }}
                  testId="badge-header-warning"
                />
              )}
            </Stack>
          </Panel>

          {/* «Rolul»: the role's band — its colour in «Culorile rolurilor» — and the word above the role's name. */}
          <Panel glyph="badgeRole" collapsible level={5} title={t("badges.design.sections.role")} aside={roleAside} data-testid="badge-section-role">
            <Stack spacing={1.5}>
              <Typography variant="caption" color="text.secondary">
                {t("badges.design.roleHelp")}
              </Typography>
              <Stack {...PAIR}>
                <RecallField
                  name={box("labelRo")}
                  label={t("badges.design.labelRo")}
                  placeholder={roDefaults.label}
                  helperText={t("badges.design.labelHelp", { max: String(BADGE_LABEL_MAX) })}
                  defaultValue={design.labelRo}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: BADGE_LABEL_MAX, autoComplete: "off" }, inputLabel: { shrink: true } }}
                />
                <RecallField
                  name={box("labelEn")}
                  label={t("badges.design.labelEn")}
                  placeholder={enDefaults.label}
                  helperText={t("badges.design.bothLanguages")}
                  defaultValue={design.labelEn}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: BADGE_LABEL_MAX, autoComplete: "off" }, inputLabel: { shrink: true } }}
                />
              </Stack>
            </Stack>
          </Panel>

          {/* «Locul pentru nume»: no name is printed; «Nume:» and, if wanted, one faint line for the marker. */}
          <Panel glyph="badgeWriting" collapsible level={5} title={t("badges.design.sections.writing")} aside={writingAside} data-testid="badge-section-writing">
            <Stack spacing={1.5}>
              <Typography variant="caption" color="text.secondary">
                {t("badges.design.writingHelp")}
              </Typography>
              <CheckboxField name={box("writingLine")} defaultChecked={design.writingLine}>
                {t("badges.design.writingLine")}
              </CheckboxField>
            </Stack>
          </Panel>

          {/* «Telefon coordonator»: the club's number with its label, the bib's own check on the number. */}
          <Panel glyph="publicPhone" collapsible level={5} title={t("badges.design.sections.phone")} aside={phoneAside} data-testid="badge-section-phone">
            <Stack spacing={1.5}>
              <CheckboxField name={box("showPhone")} defaultChecked={design.showPhone} help={t("badges.design.showPhoneHelp")}>
                {t("badges.design.showPhone")}
              </CheckboxField>
              <OnlyWhenTicked name={box("showPhone")} initiallyTicked={design.showPhone}>
                <Stack spacing={1.5}>
                  <RecallField
                    name={box("phone")}
                    type="tel"
                    label={t("badges.design.phone")}
                    helperText={t("badges.design.phoneHelp")}
                    defaultValue={design.phone}
                    slotProps={{ htmlInput: { maxLength: BIB_EMERGENCY_PHONE_MAX, inputMode: "tel", autoComplete: "off" }, inputLabel: { shrink: true } }}
                    sx={{ width: { sm: 280 } }}
                  />
                  <Stack {...PAIR}>
                    <RecallField
                      name={box("phoneLabelRo")}
                      label={t("badges.design.phoneLabelRo")}
                      placeholder={roDefaults.phoneLabel}
                      helperText={t("badges.design.phoneLabelHelp", { max: String(BADGE_PHONE_LABEL_MAX) })}
                      defaultValue={design.phoneLabelRo}
                      fullWidth
                      slotProps={{ htmlInput: { maxLength: BADGE_PHONE_LABEL_MAX, autoComplete: "off" }, inputLabel: { shrink: true } }}
                    />
                    <RecallField
                      name={box("phoneLabelEn")}
                      label={t("badges.design.phoneLabelEn")}
                      placeholder={enDefaults.phoneLabel}
                      helperText={t("badges.design.bothLanguages")}
                      defaultValue={design.phoneLabelEn}
                      fullWidth
                      slotProps={{ htmlInput: { maxLength: BADGE_PHONE_LABEL_MAX, autoComplete: "off" }, inputLabel: { shrink: true } }}
                    />
                  </Stack>
                </Stack>
              </OnlyWhenTicked>
            </Stack>
          </Panel>

          {/* «Tăiere»: the dashed lines every sheet has, and the solid marks in the margin. */}
          <Panel glyph="badgeCut" collapsible level={5} title={t("badges.design.sections.cut")} aside={cutAside} data-testid="badge-section-cut">
            <CheckboxField name={box("cutMarks")} defaultChecked={design.cutMarks} help={t("badges.design.cutMarksHelp")}>
              {t("badges.design.cutMarks")}
            </CheckboxField>
          </Panel>

          <Box>
            <GlyphSubmitButton label={t("badges.design.save")} pendingLabel={t("badges.design.saving")} icon="save" />
          </Box>
        </Stack>
      </ActionForm>
    </Panel>
  );
}
