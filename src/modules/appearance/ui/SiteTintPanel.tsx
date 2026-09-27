import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateSiteTintAction } from "@/app/[locale]/admin/settings/appearance/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { CUSTOM_SITE_TINT, DEFAULT_SITE_TINT, SITE_TINT_PRESETS } from "@/modules/appearance/domain/site-tint";
import type { SiteTintState } from "@/modules/appearance/site-tint";
import ActionForm from "@/shared/forms/ActionForm";
import { RecallRadio } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";
import { CLUB_NAME, COLOR, SITE_TINT } from "@/theme/brand";
import CustomTintOption from "./CustomTintOption";
import TintPreview from "./TintPreview";

type Props = {
  locale: Locale;
  state: SiteTintState;
  /** Administrator only (§450); the action and the service refuse anybody else. */
  mayEdit: boolean;
  /** Why the fold opens on arrival (§336): «Setări» → «Aspect» is this card alone (§516). */
  openWhen?: FoldOpenWhen;
};

/**
 * «Aspectul site-ului» (§488): the public pages' light background — one of the presets drawn from
 * the club's colours (`SITE_TINT` in `theme/brand.ts`) or «Personalizat», a colour typed as
 * `#rrggbb` and refused unless text stays readable on it and it stays light.
 *
 * The shape of «Adresa de contact afișată» (§442): a Server Component, one form, a radio per
 * choice — each with the page in miniature on that colour (`TintPreview`: the header, a card, a
 * line of text), so the choice is seen, not guessed from a name — Save behind the §384
 * confirmation. «Personalizat» is the one client island (`CustomTintOption`), live as the colour
 * is typed. A role that may not change it reads the choice in force and who changes it.
 */
export default async function SiteTintPanel({ locale, state, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const { setting } = state;
  const current =
    setting.tint === CUSTOM_SITE_TINT ? `${t("appearance.tints.custom.name")} (${setting.hex})` : t(`appearance.tints.${setting.tint}.name`);
  const preview = { header: CLUB_NAME, card: t("appearance.preview.card"), text: t("appearance.preview.text") };

  return (
    <Panel glyph="appearance" title={t("appearance.title")} intro={t("appearance.intro")} id="site-tint" data-testid="site-tint" openWhen={openWhen}>
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="site-tint-current">
        {t("appearance.current", { tint: current })}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("appearance.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("appearance.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateSiteTintAction}
            messages={await refusalMessages({ tint: t("appearance.legend"), hex: t("appearance.hexLabel") })}
            confirm={{
              title: t("confirm.siteTintTitle"),
              body: t("confirm.siteTintBody"),
              confirmLabel: t("appearance.save"),
              cancelLabel: words.cancel,
            }}
            scope="siteTint"
            data-testid="site-tint-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t("appearance.legend")}
                </Typography>
                {SITE_TINT_PRESETS.map((tint) => (
                  // A plain label with children, never `FormControlLabel`'s element prop (§370); 44px to a thumb.
                  <Box
                    key={tint}
                    component="label"
                    sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5, cursor: "pointer" }}
                    data-testid={`site-tint-option-${tint}`}
                  >
                    <RecallRadio name="tint" value={tint} defaultChecked={setting.tint === tint} style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <TintPreview page={SITE_TINT[tint]} words={preview} />
                    <Box component="span" sx={{ minWidth: 0 }}>
                      <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 500 }}>
                        {t(`appearance.tints.${tint}.name`)}
                        {tint === DEFAULT_SITE_TINT ? ` · ${t("appearance.default")}` : ""}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {t(`appearance.tints.${tint}.help`)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
                <CustomTintOption
                  initialHex={setting.tint === CUSTOM_SITE_TINT ? setting.hex : COLOR.paper}
                  defaultChecked={setting.tint === CUSTOM_SITE_TINT}
                  words={{
                    name: t("appearance.tints.custom.name"),
                    help: t("appearance.tints.custom.help"),
                    hexLabel: t("appearance.hexLabel"),
                    pickerLabel: t("appearance.pickerLabel"),
                    rule: t("appearance.rule"),
                    ok: t("appearance.verdict.ok"),
                    notAColour: t("appearance.verdict.notAColour"),
                    unreadable: t("appearance.verdict.unreadable"),
                    tooDark: t("appearance.verdict.tooDark"),
                  }}
                  preview={preview}
                />
              </Box>
              <Box>
                <GlyphSubmitButton label={t("appearance.save")} pendingLabel={t("appearance.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("appearance.scope")}
      </Typography>
    </Panel>
  );
}
