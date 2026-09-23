import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RecallField, { RecallRadio } from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
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
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import BibDesignPreview from "./BibDesignPreview";
import BibFooterTextField from "./BibFooterTextField";

/**
 * What a race number looks like, as the club decides it (`DECISIONS.md` §249; the owner: "I
 * wanna be able to design the BIDs").
 *
 * A Server Component with ordinary inputs, folded away under the colour it extends — the bib's
 * colour has lived in this form since §173 and this is the rest of the same question. No
 * JavaScript decides anything: the checkboxes and the two selects post their own values, and
 * the pictures are radio buttons over the pictures already uploaded, so choosing one is a form
 * control rather than a widget.
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
 */
export default async function BibDesignPanel({
  eventId,
  design = DEFAULT_BIB_DESIGN,
  bibStartNumber,
  bibColour,
}: {
  /** The event being designed; the preview asks the picture route for its title and date. */
  eventId: string;
  /** What is stored, or the platform's own on an event nobody has designed. */
  design?: BibDesign;
  /** The stored start number and band colour (§173), for the preview's first address. */
  bibStartNumber: number;
  bibColour: string | null;
}) {
  const t = await getTranslations("Admin");
  // The reader's own language, for the picture list's titles; the form has no locale prop.
  const locale = (await getLocale()) as Locale;
  const initialSrc = bibPreviewUrl({ eventId, locale, number: String(bibStartNumber), colour: bibColour, design });
  /*
    The pictures already uploaded, read here rather than fetched by the browser: this form is a
    Server Component and the list is the same one the pictures page shows. Nothing is offered
    when there is no store configured — a local machine without R2 — and the two choices then
    read "the club's colour" and "no sponsors", which is what such a deployment can honour.
  */
  const assets = isStorageConfigured() ? (await listMediaAssetsForAdmin(getDb(), locale)).slice(0, 60) : [];
  // What the footer's two switches would print here: this deployment's own values, never a
  // literal — on QA the host is QA's, and the mailbox may not be set at all (§317).
  const siteHost = bibWebsiteHost(env.APP_BASE_URL);
  const replyTo = env.EMAIL_REPLY_TO ?? null;

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

  const picker = (field: "headerImageSrc" | "sponsorImageSrc") => (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
      <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {t(`editor.bibDesign.${field}`)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {t(`editor.bibDesign.${field}Help`)}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        {/* A plain label with children rather than `FormControlLabel`'s element prop: the
            defect `CheckboxField` documents. The radio comes back as ticked after a refused
            submit (§315). */}
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
    <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1 }} data-testid="bib-design">
      <Typography component="summary" variant="body2" sx={{ fontWeight: 600 }}>
        {t("editor.bibDesign.title")}
      </Typography>
      {/* What tells the action that this panel was on the form; see the note above. */}
      <input type="hidden" name="event.bibDesign.present" value="1" />

      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">
          {t("editor.bibDesign.intro")}
        </Typography>

        {/* The bib as it would print with the boxes as they are now, redrawn as they change. */}
        <BibDesignPreview
          eventId={eventId}
          locale={locale}
          initialSrc={initialSrc}
          labels={{ alt: t("editor.bibDesign.previewAlt"), caption: t("editor.bibDesign.previewCaption") }}
        />

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

        <Typography variant="caption" color="text.secondary">
          {t("editor.bibDesign.previewNote")}
        </Typography>
      </Stack>
    </Box>
  );
}
