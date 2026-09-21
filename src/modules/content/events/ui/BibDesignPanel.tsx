import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
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
import { DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX } from "@/shared/ui/disclosure";

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
 * **The marker input is not decoration.** A checkbox that is off posts nothing, so a form
 * without this panel — the create form — would otherwise read as "every switch off" and
 * silently redesign a bib. `present=1` is what tells the action that the design was on screen
 * (`app/[locale]/admin/actions.ts`).
 */
export default async function BibDesignPanel({ design = DEFAULT_BIB_DESIGN }: {
  /** What is stored, or the platform's own on an event nobody has designed. */
  design?: BibDesign;
}) {
  const t = await getTranslations("Admin");
  // The reader's own language, for the picture list's titles; the form has no locale prop.
  const locale = (await getLocale()) as Locale;
  /*
    The pictures already uploaded, read here rather than fetched by the browser: this form is a
    Server Component and the list is the same one the pictures page shows. Nothing is offered
    when there is no store configured — a local machine without R2 — and the two choices then
    read "the club's colour" and "no sponsors", which is what such a deployment can honour.
  */
  const assets = isStorageConfigured() ? (await listMediaAssetsForAdmin(getDb(), locale)).slice(0, 60) : [];

  const picker = (field: "headerImageSrc" | "sponsorImageSrc") => (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
      <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {t(`editor.bibDesign.${field}`)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {t(`editor.bibDesign.${field}Help`)}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <FormControlLabel
          control={
            <input
              type="radio"
              name={`event.bibDesign.${field}`}
              value=""
              defaultChecked={design[field] === null}
              style={{ width: 20, height: 20 }}
            />
          }
          label={t("editor.bibDesign.noPicture")}
          sx={{ mr: 2 }}
        />
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
            <input
              type="radio"
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
    <Box component="details" sx={{ ...DISCLOSURE_SX, mt: 1 }} data-testid="bib-design">
      <Typography component="summary" variant="body2" sx={{ ...DISCLOSURE_SUMMARY_SX, fontWeight: 600 }}>
        {t("editor.bibDesign.title")}
      </Typography>
      {/* What tells the action that this panel was on the form; see the note above. */}
      <input type="hidden" name="event.bibDesign.present" value="1" />

      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t("editor.bibDesign.intro")}
        </Typography>

        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
          {(["showName", "showEventTitle", "showDate", "showLogo", "cutMarks"] as const).map((field) => (
            <FormControlLabel
              key={field}
              control={<Checkbox name={`event.bibDesign.${field}`} defaultChecked={design[field]} />}
              label={t(`editor.bibDesign.${field}`)}
            />
          ))}
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField
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
          </TextField>
          <TextField
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
          </TextField>
        </Stack>

        {picker("headerImageSrc")}
        {picker("sponsorImageSrc")}

        <Typography variant="caption" color="text.secondary">
          {t("editor.bibDesign.previewNote")}
        </Typography>
      </Stack>
    </Box>
  );
}
