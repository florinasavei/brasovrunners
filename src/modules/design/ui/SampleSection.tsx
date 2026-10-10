import MenuBookIcon from "@mui/icons-material/MenuBook";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import EventCard from "@/modules/events/ui/EventCard";
import SeriesCard from "@/modules/events/ui/SeriesCard";
import CheckboxField from "@/shared/ui/CheckboxField";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { heroSurface } from "@/theme/surfaces";
import { SAMPLE_NOW, SAMPLE_WEATHER, sampleRace, sampleSeries, sampleTeamMember } from "../fixtures";
import DesignSection, { Block, Code } from "./section";

const SEVERITIES = ["success", "info", "warning", "error"] as const;

/** The listing's grid, as `events/page.tsx` lays the cards: a list, two to a row from `md`. */
const CARD_LIST_SX = { listStyle: "none", m: 0, p: 0, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } } as const;

/**
 * «Mostre» (§692): the listing's two cards from the sample rows — the very components the site
 * renders, `EventCard` and `SeriesCard` — the lead's frame and surface, a team card in its no-photo
 * state (the public team page draws it inline, so its shape is repeated here), the form's field
 * with a helper and a refusal, a native select, the house checkbox, an alert of each severity and
 * the backoffice fold. Server Components throughout; what reaches a client component is a string.
 */
export default async function SampleSection({ locale }: { locale: Locale }) {
  const t = await getTranslations("Admin");
  const race = sampleRace(locale);
  const series = sampleSeries(locale);
  const member = sampleTeamMember(locale);

  return (
    <DesignSection id="samples" title={t("design.sections.samples")} intro={t("design.samples.intro")}>
      <Block title={t("design.samples.cards")} note={t("design.samples.cardsNote")}>
        <Box component="ul" sx={CARD_LIST_SX} data-testid="design-cards">
          <EventCard event={race} index={0} now={SAMPLE_NOW} weather={SAMPLE_WEATHER} />
          <SeriesCard members={series} index={1} now={SAMPLE_NOW} weather={SAMPLE_WEATHER} />
        </Box>
      </Block>

      <Block title={t("design.samples.featured")} note={t("design.samples.featuredNote")}>
        <Box component="ul" sx={CARD_LIST_SX} data-testid="design-featured">
          <EventCard event={race} index={0} now={SAMPLE_NOW} featured={{ raceWeekDays: 7 }} />
          <Box component="li" sx={{ ...heroSurface, border: 1, borderColor: "divider", borderRadius: 1, p: 2, display: "flex", alignItems: "center" }}>
            <Typography variant="body2">
              <Code>heroSurface</Code> · <Code>featuredCard</Code>
            </Typography>
          </Box>
        </Box>
      </Block>

      <Block title={t("design.samples.team")} note={t("design.samples.teamNote")}>
        <Box sx={{ maxWidth: 240 }} data-testid="design-team-card">
          <Card variant="outlined">
            <CardContent sx={{ p: 2, "&:last-child": { pb: 3 } }}>
              <Typography variant="h2" component="p" sx={{ fontSize: { xs: "1rem", sm: "1.25rem" }, mb: 0.25, overflowWrap: "anywhere" }}>
                {member.name}
              </Typography>
              <Typography variant="body2" color="primary" sx={{ fontWeight: 600, fontSize: { xs: "0.8125rem", sm: "0.875rem" } }}>
                {member.role}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Block>

      <Block title={t("design.samples.form")} note={t("design.samples.formNote")}>
        <Stack spacing={2} sx={{ maxWidth: 420 }} data-testid="design-form">
          <TextField name="design-name" label={t("design.samples.field")} helperText={t("design.samples.fieldHelp")} defaultValue={member.name} fullWidth />
          <TextField name="design-name-refused" label={t("design.samples.field")} helperText={t("design.samples.fieldRefused")} defaultValue="" error fullWidth />
          <TextField name="design-surface" label={t("design.samples.select")} select defaultValue="ASPHALT" fullWidth slotProps={{ select: { native: true } }}>
            <option value="ASPHALT">{t("design.samples.optionAsphalt")}</option>
            <option value="TRAIL">{t("design.samples.optionTrail")}</option>
          </TextField>
          <CheckboxField name="design-list" help={t("design.samples.checkboxHelp")}>
            {t("design.samples.checkbox")}
          </CheckboxField>
        </Stack>
      </Block>

      <Block title={t("design.samples.alerts")}>
        <Stack spacing={1} sx={{ maxWidth: 560 }} data-testid="design-alerts">
          {SEVERITIES.map((severity) => (
            <Alert key={severity} severity={severity}>
              {t(`design.samples.alert.${severity}`)}
            </Alert>
          ))}
        </Stack>
      </Block>

      <Block title={t("design.samples.fold")} note={t("design.samples.foldNote")}>
        <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, maxWidth: 560 }} data-testid="design-fold">
          <Typography component="summary" variant="subtitle1" sx={{ fontWeight: 600 }}>
            <MenuBookIcon aria-hidden="true" sx={FOLD_GLYPH_SX} />
            {t("design.samples.foldSummary")}
          </Typography>
          <Typography variant="body2">{t("design.samples.foldBody")}</Typography>
        </Box>
      </Block>
    </DesignSection>
  );
}
