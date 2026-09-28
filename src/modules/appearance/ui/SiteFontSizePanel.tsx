import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateSiteFontSizeAction } from "@/app/[locale]/admin/settings/appearance/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { DEFAULT_SITE_FONT_SIZE, SITE_FONT_SIZES, siteFontSizePixels } from "@/modules/appearance/domain/site-font-size";
import type { SiteFontSizeState } from "@/modules/appearance/site-font-size";
import ActionForm from "@/shared/forms/ActionForm";
import { RecallRadio } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  state: SiteFontSizeState;
  /** Administrator only (§450); the action and the service refuse anybody else. */
  mayEdit: boolean;
  /** §336. */
  openWhen?: FoldOpenWhen;
};

/**
 * «Mărimea textului» (§530), shaped like §488's panel: a radio per step with a sample line at that
 * size; Save behind the §384 confirmation. Read-only for other roles.
 */
export default async function SiteFontSizePanel({ locale, state, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const { setting } = state;

  return (
    <Panel glyph="textSize" title={t("fontSize.title")} intro={t("fontSize.intro")} introMore={t("fontSize.introMore")} id="site-font-size" data-testid="site-font-size" openWhen={openWhen}>
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="site-font-size-current">
        {t("fontSize.current", { size: t(`fontSize.sizes.${setting.size}.name`) })}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("fontSize.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("fontSize.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateSiteFontSizeAction}
            messages={await refusalMessages({ size: t("fontSize.legend") })}
            confirm={{
              title: t("confirm.siteFontSizeTitle"),
              body: t("confirm.siteFontSizeBody"),
              confirmLabel: t("fontSize.save"),
              cancelLabel: words.cancel,
            }}
            scope="siteFontSize"
            data-testid="site-font-size-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
              <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t("fontSize.legend")}
                </Typography>
                {SITE_FONT_SIZES.map((size) => {
                  const px = siteFontSizePixels(size);
                  return (
                    // A plain label with children, never `FormControlLabel`'s element prop (§370); 44px to a thumb.
                    <Box
                      key={size}
                      component="label"
                      sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5, cursor: "pointer" }}
                      data-testid={`site-font-size-option-${size}`}
                    >
                      <RecallRadio name="size" value={size} defaultChecked={setting.size === size} style={{ width: 20, height: 20, flexShrink: 0 }} />
                      <Box component="span" sx={{ minWidth: 0 }}>
                        <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 500 }}>
                          {t(`fontSize.sizes.${size}.name`)}
                          {size === DEFAULT_SITE_FONT_SIZE ? ` · ${t("fontSize.default")}` : ""}
                        </Typography>
                        {/* In pixels: the backoffice itself never takes the setting. */}
                        <Box component="span" sx={{ display: "block", fontSize: px, lineHeight: 1.5 }} data-testid={`site-font-size-sample-${size}`}>
                          {t("fontSize.sample")}
                        </Box>
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {t(`fontSize.sizes.${size}.help`, { px })}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
              <Box>
                <GlyphSubmitButton label={t("fontSize.save")} pendingLabel={t("fontSize.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        {t("fontSize.scope")}
      </Typography>
    </Panel>
  );
}
