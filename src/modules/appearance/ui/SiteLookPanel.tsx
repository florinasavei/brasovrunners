import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateSiteLookAction } from "@/app/[locale]/admin/settings/appearance/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { CUSTOM_LOOK_ACCENT, DEFAULT_LOOK_ACCENT, LOOK_ACCENT_PRESETS, lookAccentOf } from "@/modules/appearance/domain/site-look";
import type { SiteLookState } from "@/modules/appearance/site-look";
import { LOOK_ACCENT } from "@/theme/brand";
import AccentPreview from "./AccentPreview";
import CustomAccentOption from "./CustomAccentOption";
import ActionForm from "@/shared/forms/ActionForm";
import { RecallRadio } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  locale: Locale;
  state: SiteLookState;
  /** Administrator only (§450); the action and the service refuse anybody else. */
  mayEdit: boolean;
  /** Why the fold opens on arrival (§336). */
  openWhen?: FoldOpenWhen;
};

/** The two choices, in the order the form shows them: today's look first, the default. */
const CHOICES = ["off", "on"] as const;

/**
 * «Aspectul nou» (§708; `docs/REDESIGN.md`, decision 12): the facelift's look on the public pages,
 * one switch — off until the club approves it on QA, and then the one-press way back.
 *
 * The shape of «Mărimea textului» beside it (§530): a Server Component, one form, a radio per
 * choice with a line that says what it does, Save behind the §384 confirmation. The look itself is
 * not drawn here — the backoffice never wears it — but one button opens the design page's
 * side-by-side, where both looks are drawn from the same rules. A role that may not change it reads
 * the choice in force.
 *
 * Since §723 the same form carries «Culoarea de accent»: the presets of `LOOK_ACCENT` (`theme/brand.ts`),
 * each drawn in miniature by day and after dark (`AccentPreview`), and «Personalizat», the one client
 * island (`CustomAccentOption`), live as the colour is typed. One save sets both, so the club never
 * saves a look in an accent it has not seen.
 */
export default async function SiteLookPanel({ locale, state, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const choice = state.setting.on ? "on" : "off";
  const accent = lookAccentOf(state.setting);
  const accentName =
    accent.accent === CUSTOM_LOOK_ACCENT ? `${t("look.accent.custom.name")} (${accent.hex})` : t(`look.accent.presets.${accent.accent}.name`);
  const preview = { button: t("look.accent.preview.button"), tag: t("look.accent.preview.tag") };

  return (
    <Panel glyph="preview" title={t("look.title")} intro={t("look.intro")} introMore={t("look.introMore")} id="site-look" data-testid="site-look" openWhen={openWhen}>
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="site-look-current">
        {t("look.current", { look: t(`look.choices.${choice}.name`) })}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="site-look-accent-current">
        {t("look.accent.current", { accent: accentName })}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("look.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("look.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateSiteLookAction}
            messages={await refusalMessages({ look: t("look.legend"), accent: t("look.accent.legend"), accentHex: t("look.accent.hexLabel") })}
            confirm={{
              title: t("confirm.siteLookTitle"),
              body: t("confirm.siteLookBody"),
              confirmLabel: t("look.save"),
              cancelLabel: words.cancel,
            }}
            scope="siteLook"
            data-testid="site-look-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t("look.legend")}
                </Typography>
                {CHOICES.map((value) => (
                  // A plain label with children, never `FormControlLabel`'s element prop (§370); 44px to a thumb.
                  <Box
                    key={value}
                    component="label"
                    sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5, cursor: "pointer" }}
                    data-testid={`site-look-option-${value}`}
                  >
                    <RecallRadio name="look" value={value} defaultChecked={choice === value} style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <Box component="span" sx={{ minWidth: 0 }}>
                      <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 500 }}>
                        {t(`look.choices.${value}.name`)}
                        {value === "off" ? ` · ${t("look.default")}` : ""}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {t(`look.choices.${value}.help`)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
              {/* «Culoarea de accent» (§723): a preset or a typed colour, worn only under the new look. */}
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }} data-testid="site-look-accent">
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t("look.accent.legend")}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {t("look.accent.intro")}
                </Typography>
                {LOOK_ACCENT_PRESETS.map((preset) => (
                  // A plain label with children, never `FormControlLabel`'s element prop (§370); 44px to a thumb.
                  <Box
                    key={preset}
                    component="label"
                    sx={{ display: "flex", flexWrap: { xs: "wrap", sm: "nowrap" }, alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5, cursor: "pointer" }}
                    data-testid={`site-look-accent-option-${preset}`}
                  >
                    <RecallRadio name="accent" value={preset} defaultChecked={accent.accent === preset} style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <AccentPreview shades={LOOK_ACCENT[preset]} words={preview} />
                    <Box component="span" sx={{ minWidth: 0, flexBasis: { xs: "calc(100% - 32px)", sm: "auto" } }}>
                      <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 500 }}>
                        {t(`look.accent.presets.${preset}.name`)}
                        {preset === DEFAULT_LOOK_ACCENT ? ` · ${t("look.default")}` : ""}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {t(`look.accent.presets.${preset}.help`)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
                <CustomAccentOption
                  initialHex={accent.accent === CUSTOM_LOOK_ACCENT ? accent.hex : LOOK_ACCENT[DEFAULT_LOOK_ACCENT].light.accent}
                  defaultChecked={accent.accent === CUSTOM_LOOK_ACCENT}
                  words={{
                    name: t("look.accent.custom.name"),
                    help: t("look.accent.custom.help"),
                    hexLabel: t("look.accent.hexLabel"),
                    pickerLabel: t("look.accent.pickerLabel"),
                    rule: t("look.accent.rule"),
                    shades: t("look.accent.shades"),
                    ok: t("look.accent.verdict.ok"),
                    notAColour: t("look.accent.verdict.notAColour"),
                    tooGrey: t("look.accent.verdict.tooGrey"),
                  }}
                  preview={preview}
                />
              </Box>
              <Box>
                <GlyphSubmitButton label={t("look.save")} pendingLabel={t("look.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}

      <Box sx={{ mt: 1.5 }}>
        <GlyphButtonLink icon="preview" href={{ pathname: "/admin/design", hash: "look" }} variant="outlined" size="small" sx={TAP_TARGET} data-testid="site-look-compare">
          {t("look.compare")}
        </GlyphButtonLink>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("look.scope")}
      </Typography>
    </Panel>
  );
}
