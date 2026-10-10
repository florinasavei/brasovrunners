import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { PAYMENT_WORDS_MAX } from "@/modules/content/shop/fields";
import type { ShopSettings } from "@/modules/content/shop/settings";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import ActionForm, { type RefusalMessages } from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { saveShopSettingsAction } from "@/app/[locale]/admin/shop/actions";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/**
 * «Cum se plătește și cine primește comenzile» (§683), the shop's «Setări» tab since §NNN: the
 * payment words in both languages or neither (§352) — shown under every unpaid order and in the
 * confirmation email — and one address for the club's notice of each order, or none. Whoever runs
 * the shop writes them (§687); the Organizer reads them. «Copiază și tradu tot: RO → EN» (§482) at the top.
 */
export default function ShopSettingsCard({
  settings,
  locale,
  words: t,
  cancel,
  messages,
  mayManage,
}: {
  settings: ShopSettings;
  locale: Locale;
  words: Words;
  cancel: string;
  messages: RefusalMessages;
  mayManage: boolean;
}) {
  const pairSx = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 } as const;
  return (
    <Panel glyph="cost" title={t("members.shop.settings")} intro={t("members.shop.settingsHelp")} id="shop-settings" data-testid="shop-settings">
      {mayManage ? (
        <ActionForm
          action={saveShopSettingsAction}
          messages={messages}
          scope="shop-settings"
          confirm={{ title: t("members.shop.settingsTitle"), body: t("members.shop.settingsBody"), confirmLabel: t("editor.save"), cancelLabel: cancel }}
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <Stack spacing={2}>
            <TranslateAllButton />
            <Box sx={pairSx}>
              <RecallField
                name="paymentRo"
                label={t("members.shop.paymentRo")}
                fullWidth
                multiline
                minRows={2}
                defaultValue={settings.paymentRo ?? ""}
                helperText={t("members.shop.paymentHelp")}
                slotProps={{ htmlInput: { maxLength: PAYMENT_WORDS_MAX, lang: "ro" } }}
              />
              <RecallField
                name="paymentEn"
                label={t("members.shop.paymentEn")}
                fullWidth
                multiline
                minRows={2}
                defaultValue={settings.paymentEn ?? ""}
                helperText={t("members.shop.bothOrNeither")}
                slotProps={{ htmlInput: { maxLength: PAYMENT_WORDS_MAX, lang: "en" } }}
              />
            </Box>
            <RecallField
              name="ordersTo"
              label={t("members.shop.ordersTo")}
              type="email"
              fullWidth
              defaultValue={settings.ordersTo ?? ""}
              helperText={t("members.shop.ordersToHelp")}
              slotProps={{ htmlInput: { maxLength: 320, autoComplete: "off" } }}
            />
            <Box>
              <GlyphSubmitButton label={t("editor.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
            </Box>
          </Stack>
        </ActionForm>
      ) : (
        <Stack spacing={0.5}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
            {t("members.shop.paymentRo")}: {settings.paymentRo ?? t("members.shop.notSet")}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
            {t("members.shop.paymentEn")}: {settings.paymentEn ?? t("members.shop.notSet")}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
            {t("members.shop.ordersTo")}: {settings.ordersTo ?? t("members.shop.notSet")}
          </Typography>
        </Stack>
      )}
    </Panel>
  );
}
