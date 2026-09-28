import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RecallField, { RecallRadio } from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { shownContactAddressesOrDefault } from "@/modules/contact/shown-address";
import { isStorageConfigured } from "@/modules/media/storage";
import { listMediaAssetsForAdmin } from "@/modules/media/references";
import {
  BIB_NAME_POSITIONS,
  BIB_NUMBER_SCALES,
  type BibDesign,
  DEFAULT_BIB_DESIGN,
} from "@/modules/registrations/bib-design";
import { bibPreviewUrl } from "@/modules/registrations/bib-design-query";
import { BIB_FOOTER_TEXT_MAX, bibWebsiteHost } from "@/modules/registrations/bib-footer";
import { env } from "@/shared/config/env";
import Panel from "@/shared/ui/Panel";
import BibDesignPreview from "./BibDesignPreview";
import BibFooterTextField from "./BibFooterTextField";

/**
 * What a race number looks like (§249): a Server Component of ordinary inputs, folded under the
 * bib colour (§173); the pictures are radios over already-uploaded assets. The one island is the
 * preview (`BibDesignPreview`), seeded here with the stored design's address. The footer
 * ("Subsol", §317) lists its switches in print order, each naming what it would print on this
 * deployment; the club's line is a second island for its character count.
 *
 * The `present=1` marker matters: an unticked checkbox posts nothing, so a form without this panel
 * would otherwise read as "every switch off" and silently redesign the bib (`admin/actions.ts`).
 */
export default async function BibDesignPanel({
  eventId,
  design = DEFAULT_BIB_DESIGN,
  bibStartNumber,
  bibColour,
  summary,
}: {
  /** The event being designed, for the preview's title and date; null on create, where there is no preview. */
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
  // The reader's language, for the picture list's titles.
  const locale = (await getLocale()) as Locale;
  const initialSrc = eventId ? bibPreviewUrl({ eventId, locale, number: String(bibStartNumber), colour: bibColour, design }) : null;
  /*
    The uploaded pictures, read on the server. With no store configured (local, no R2) nothing is
    offered and the choices read "the club's colour" and "no sponsors".
  */
  const assets = isStorageConfigured() ? (await listMediaAssetsForAdmin(getDb(), locale)).slice(0, 60) : [];
  // What the footer's switches would print here: this deployment's values, never a literal (§317).
  const siteHost = bibWebsiteHost(env.APP_BASE_URL);
  // The first address the club shows (§442), as the bib routes print it.
  const replyTo = (await shownContactAddressesOrDefault())[0] ?? null;

  /** A footer switch, with what it prints beside its words when there is something to name. */
  const footerSwitch = (
    field: "showEventInFooter" | "showPartners" | "showWebsite" | "showEmail",
    label: string,
    prints?: string | null,
  ) => (
    // A `CheckboxField` (§315): recalled after a refused save; the label travels as children, never an element prop.
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

  const picker = (field: "headerImageSrc" | "sponsorImageSrc") => (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
      <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {t(`editor.bibDesign.${field}`)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {t(`editor.bibDesign.${field}Help`)}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        {/* A plain label with children, not `FormControlLabel`'s element prop (see `CheckboxField`).
            Recalled after a refused submit (§315). */}
        <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 1, mr: 2, cursor: "pointer" }}>
          <RecallRadio
            name={`event.bibDesign.${field}`}
            value=""
            defaultChecked={design[field] === null}
            style={{ width: 20, height: 20 }}
          />
          <Typography component="span" variant="body2">
            {t("editor.bibDesign.noPicture")}
          </Typography>
        </Box>
        {assets.map((asset) => (
          <Box
            key={asset.id}
            component="label"
            title={asset.originalFilename}
            sx={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0.5,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: 0.5,
              cursor: "pointer",
              "&:has(input:checked)": { borderColor: "primary.main", borderWidth: 2, p: "3px" },
            }}
          >
            <Box component="img" src={asset.thumbUrl} alt={asset.originalFilename} width={72} height={72} sx={{ display: "block", width: 72, height: 72, objectFit: "cover", borderRadius: 0.5 }} />
            <RecallRadio
              name={`event.bibDesign.${field}`}
              value={asset.webUrl}
              defaultChecked={design[field] === asset.webUrl}
              aria-label={asset.originalFilename}
              style={{ width: 20, height: 20 }}
            />
          </Box>
        ))}
      </Stack>
    </Box>
  );

  return (
    <Panel glyph="bibDesign" collapsible level={4} id="box-bib-design" title={t("editor.bibDesign.title")} aside={summary} data-testid="bib-design">
      {/* Tells the action this panel was on the form; see above. */}
      <input type="hidden" name="event.bibDesign.present" value="1" />

      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">
          {t("editor.bibDesign.intro")}
        </Typography>

        {/* The live preview, once the event exists: the picture route draws its title and date. */}
        {eventId && initialSrc && (
          <BibDesignPreview
            eventId={eventId}
            locale={locale}
            initialSrc={initialSrc}
            labels={{ alt: t("editor.bibDesign.previewAlt"), caption: t("editor.bibDesign.previewCaption") }}
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

        {picker("headerImageSrc")}
        {picker("sponsorImageSrc")}

        {/* The small print (§317), in print order: event, partners, the club's line, website, mailbox. */}
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

        {eventId && (
          <Typography variant="caption" color="text.secondary">
            {t("editor.bibDesign.previewNote")}
          </Typography>
        )}
      </Stack>
    </Panel>
  );
}
