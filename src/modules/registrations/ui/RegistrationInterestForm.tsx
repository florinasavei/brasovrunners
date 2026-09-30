import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { registerInterestAction } from "@/app/[locale]/events/[slug]/actions";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubmitButton from "@/shared/ui/SubmitButton";
import { INTEREST_BOX_ID, type InterestOutcome } from "../interest-box";
import { BOT_CHECK_SLOT_SX } from "../domain/turnstile-widget";
import { turnstileSiteKey } from "../turnstile";
import BotCheck from "./BotCheck";

/**
 * "Anunță-mă când se deschid înscrierile" (`DECISIONS.md` §146): one address, one button, one
 * sentence saying what happens to the address and the link to the notice that says it in
 * full — under the opening date on the event's page, only while the window is ahead and that
 * notice is approved (the page decides). A Server Component around a Server Action, like the
 * registration form: the honeypot and the rendering time ride along as hidden fields, the
 * Turnstile widget shows when the club switched it on, and the answer comes back as a
 * sentence under the box after a redirect. No script of the site's own.
 */
export default async function RegistrationInterestForm({
  locale,
  slug,
  renderedAt,
  outcome,
}: {
  locale: Locale;
  slug: string;
  /** When this form was rendered — or, on a corrected address, when the one it corrects was. */
  renderedAt: Date;
  outcome: InterestOutcome | null;
}) {
  const t = await getTranslations("Event");
  const siteKey = turnstileSiteKey();

  return (
    <Box
      id={INTEREST_BOX_ID}
      component="section"
      aria-labelledby={`${INTEREST_BOX_ID}-heading`}
      sx={{ mt: 2, p: 2, border: 1, borderColor: "divider", borderRadius: 2, maxWidth: 480, scrollMarginTop: 16 }}
    >
      <Typography id={`${INTEREST_BOX_ID}-heading`} variant="h3" component="h2" sx={{ fontSize: "1rem", fontWeight: 700, mb: 1 }}>
        {t("interest.heading")}
      </Typography>

      {outcome === "done" ? (
        // The same sentence whether the address was new or already on the list (BR-REQ-031-01
        // criterion 3): the box is not an oracle for who signed up.
        <Alert severity="success" role="status">
          {t("interest.done")}
        </Alert>
      ) : (
        <form action={registerInterestAction}>
          <Stack spacing={1.5}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            {/* Bots fill every field; a human never sees or fills this one. */}
            <input
              type="text"
              name="honeypot"
              autoComplete="off"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
            />
            <input type="hidden" name="renderedAt" value={renderedAt.toISOString()} />

            {outcome && (
              <Alert severity="error" role="alert">
                {t(`interest.${outcome}`)}
              </Alert>
            )}

            <TextField
              name="email"
              type="email"
              label={t("interest.email")}
              required
              fullWidth
              autoComplete="email"
              slotProps={{ htmlInput: { maxLength: 320 } }}
              error={outcome === "invalid"}
            />

            {/*
              Cloudflare Turnstile, when the club switched it on (§97) — the same explicit widget as
              every other form (§185, §518), which loads nothing until the person starts on this
              form (§577). It was Cloudflare's implicit mode here, its script loaded on every view
              of an event page that shows the box: a third-party request per stranger on a page
              the CDN otherwise answers alone.
            */}
            {siteKey && (
              <Box sx={BOT_CHECK_SLOT_SX}>
                {/* Cloudflare's sentence (§323) comes with the widget, and the box takes no room before it (§NNN). */}
                <BotCheck siteKey={siteKey} locale={locale} attempt={renderedAt.toISOString()} notice />
              </Box>
            )}

            <SubmitButton label={t("interest.submit")} pendingLabel={t("interest.submitting")} size="large">
              <NotificationsActiveIcon />
            </SubmitButton>

            <Typography variant="body2" color="text.secondary">
              {t("interest.note")} <Link href="/legal/privacy">{t("interest.privacy")}</Link>
            </Typography>
          </Stack>
        </form>
      )}
    </Box>
  );
}
