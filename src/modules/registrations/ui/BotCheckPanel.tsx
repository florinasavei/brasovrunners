import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateBotCheckAction } from "@/app/[locale]/admin/tasks/actions";
import type { Locale } from "@/i18n/routing";
import type { BotCheckState } from "@/modules/registrations/bot-check";
import SubmitButton from "@/shared/ui/SubmitButton";

/**
 * The anti-bot challenge, on or off, from the backoffice (`DECISIONS.md` §254; the owner: "I
 * wanna be able to enable/disable the captcha from the backoffice").
 *
 * One button, because there are two states and naming the one you are going to is clearer than
 * a switch that has to be read: "oprește verificarea" when it is running, "pornește-o" when it
 * is not. The sentence above it says what is actually in force, including the case the club
 * cannot fix from here — no keys on this deployment, so there is nothing to switch on.
 *
 * The warning is not decoration either. Turning it off is the right move on the day the widget
 * is refusing real people (§216, §205: "trebuie să lăsăm oamenii să se înscrie cu orice preț"),
 * and it is a defence removed — so the panel says which defences remain.
 */
export default async function BotCheckPanel({
  locale,
  state,
  keysPresent,
}: {
  locale: Locale;
  state: BotCheckState;
  /** Both Turnstile keys on this deployment (§97). Without them there is nothing to run. */
  keysPresent: boolean;
}) {
  const t = await getTranslations("Admin");
  const running = keysPresent && state.enabled;

  return (
    <Box component="section" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }} data-testid="bot-check">
      <Typography variant="h2" sx={{ fontSize: "1.1rem", mb: 0.5 }}>
        {t("botCheck.title")}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t(`botCheck.state.${keysPresent ? (state.enabled ? "on" : "off") : "noKeys"}`)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t("botCheck.others")}
      </Typography>
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {t("botCheck.updatedAt", {
            when: new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              hourCycle: "h23",
              timeZone: "Europe/Bucharest",
            }).format(state.updatedAt),
          })}
        </Typography>
      )}

      {keysPresent && (
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {running && <Alert severity="warning" sx={{ py: 0.5 }}>{t("botCheck.warning")}</Alert>}
          <Box component="form" action={updateBotCheckAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="enabled" value={state.enabled ? "0" : "1"} />
            <SubmitButton
              label={t(state.enabled ? "botCheck.turnOff" : "botCheck.turnOn")}
              pendingLabel={t("botCheck.saving")}
              color={state.enabled ? "warning" : "primary"}
              variant={state.enabled ? "outlined" : "contained"}
            />
          </Box>
        </Stack>
      )}
    </Box>
  );
}
