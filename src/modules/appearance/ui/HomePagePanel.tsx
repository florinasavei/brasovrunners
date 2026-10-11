import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateHomePageAction } from "@/app/[locale]/admin/settings/appearance/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { HOME_HEADLINE_MAX, HOME_SUBLINE_MAX } from "@/modules/appearance/domain/home-page";
import type { HomePageState } from "@/modules/appearance/home-page";
import { coverPhotoLabels } from "@/modules/content/events/ui/cover-labels";
import { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import TeamPhotoField from "@/modules/content/team/ui/TeamPhotoField";
import { getStorage, isStorageConfigured, objectKey } from "@/modules/media/storage";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { RecallRadio } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  locale: Locale;
  state: HomePageState;
  /** Administrator only (§450); the action and the service refuse anybody else. */
  mayEdit: boolean;
  /** Why the fold opens on arrival (§336). */
  openWhen?: FoldOpenWhen;
};

/** The two choices, in the order the form shows them: off first, the default. */
const CHOICES = ["off", "on"] as const;

/** The hero's crop box starts at the largest 16∶9 of the picture, the hero's own frame. */
const HERO_SHAPE = "16:9" as const;

/** The two pairs of boxes, each in both languages or neither (§352). */
const LINES = [
  { stem: "headline", max: HOME_HEADLINE_MAX },
  { stem: "subline", max: HOME_SUBLINE_MAX },
] as const;

/**
 * «Pagina principală» (§NNN; `docs/REDESIGN.md`, decision 3): a real home page at `/ro` and `/en`,
 * reached from the logo and never from a menu entry — one switch, off until the club says yes, and
 * then the one-press way back to the listing at the root.
 *
 * The shape of «Aspectul nou» beside it (§708): a Server Component, one form, a radio per choice,
 * Save behind the §384 confirmation; plus what the hero shows — its photograph, chosen like every
 * picture in the house (`TeamPhotoField` under its own stem, `hero`: the upload with its quality,
 * «Din galerie», the crop box at 16∶9), and its two lines in both languages or neither. An empty
 * photograph is an empty slot on the page, never a stock picture (decision 6); empty lines are the
 * platform's own two. A role that may not change it reads the choice in force.
 */
export default async function HomePagePanel({ locale, state, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const choice = state.setting.on ? "on" : "off";
  const hero = state.setting.hero;
  const storage = isStorageConfigured();
  const store = storage ? getStorage() : null;
  const base = coverPhotoLabels(t, richTextEditorLabels(await getTranslations("Admin.richText")));
  const labels = {
    ...base,
    legend: t("homePage.heroLegend"),
    help: t("homePage.heroHelp"),
    crop: { ...base.crop, title: t("homePage.heroCropTitle"), help: t("homePage.heroCropHelp") },
  };

  return (
    <Panel glyph="home" title={t("homePage.title")} intro={t("homePage.intro")} introMore={t("homePage.introMore")} id="home-page" data-testid="home-page" openWhen={openWhen}>
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="home-page-current">
        {t("homePage.current", { state: t(`homePage.choices.${choice}.name`) })}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("homePage.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("homePage.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateHomePageAction}
            messages={await refusalMessages({
              page: t("homePage.legend"),
              heroAssetId: t("homePage.heroLegend"),
              headlineRo: t("homePage.headlineRo"),
              headlineEn: t("homePage.headlineEn"),
              sublineRo: t("homePage.sublineRo"),
              sublineEn: t("homePage.sublineEn"),
            })}
            confirm={{
              title: t("confirm.homePageTitle"),
              body: t("confirm.homePageBody"),
              confirmLabel: t("homePage.save"),
              cancelLabel: words.cancel,
            }}
            scope="homePage"
            data-testid="home-page-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={2} sx={{ maxWidth: 640 }}>
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t("homePage.legend")}
                </Typography>
                {CHOICES.map((value) => (
                  // A plain label with children, never `FormControlLabel`'s element prop (§370); 44px to a thumb.
                  <Box
                    key={value}
                    component="label"
                    sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5, cursor: "pointer" }}
                    data-testid={`home-page-option-${value}`}
                  >
                    <RecallRadio name="page" value={value} defaultChecked={choice === value} style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <Box component="span" sx={{ minWidth: 0 }}>
                      <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 500 }}>
                        {t(`homePage.choices.${value}.name`)}
                        {value === "off" ? ` · ${t("homePage.default")}` : ""}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {t(`homePage.choices.${value}.help`)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>

              {store ? (
                <TeamPhotoField
                  photo={
                    hero
                      ? {
                          id: hero.assetId,
                          src: store.publicUrl(objectKey(hero.keyPrefix, "web")),
                          preview: store.publicUrl(objectKey(hero.keyPrefix, "thumb")),
                          width: hero.width,
                          height: hero.height,
                        }
                      : null
                  }
                  crop={hero?.crop ?? null}
                  labels={labels}
                  inputId="home-hero"
                  fieldPrefix="hero"
                  shape={HERO_SHAPE}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("homePage.noStorage")}
                </Typography>
              )}

              {LINES.map(({ stem, max }) => (
                <Box key={stem} component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                  <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                    {t(`homePage.${stem}Legend`)}
                  </Typography>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    {(["ro", "en"] as const).map((language) => {
                      const name = `${stem}${language === "ro" ? "Ro" : "En"}`;
                      return (
                        <RecallField
                          key={name}
                          name={name}
                          label={t(`homePage.${name}`)}
                          fullWidth
                          multiline={stem === "subline"}
                          defaultValue={state.setting[stem]?.[language] ?? ""}
                          helperText={t(`homePage.${stem}Help`)}
                          slotProps={{ htmlInput: { maxLength: max, lang: language } }}
                        />
                      );
                    })}
                  </Stack>
                </Box>
              ))}

              <Box>
                <GlyphSubmitButton label={t("homePage.save")} pendingLabel={t("homePage.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}

      {state.setting.on && (
        <Box sx={{ mt: 1.5 }}>
          <GlyphButtonLink icon="preview" href="/" variant="outlined" size="small" sx={TAP_TARGET} data-testid="home-page-open">
            {t("homePage.open")}
          </GlyphButtonLink>
        </Box>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("homePage.scope")}
      </Typography>
    </Panel>
  );
}
