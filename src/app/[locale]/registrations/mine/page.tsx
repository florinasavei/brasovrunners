import ForwardToInboxIcon from "@mui/icons-material/ForwardToInbox";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { cachedBotCheckSiteKey, cachedEmailWaitMinutes } from "@/modules/public-cache/reads";
import { BOT_CHECK_ERROR_ATTRIBUTE, BOT_CHECK_SLOT_SX } from "@/modules/registrations/domain/turnstile-widget";
import { parseInterestSince } from "@/modules/registrations/interest-box";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import { spamHintWords } from "@/modules/registrations/ui/link-wait-words";
import { emailDelayNotice } from "@/modules/registrations/ui/email-delay-notice";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { requestMyRegistrationsLinkAction } from "./actions";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string; captcha?: string; since?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * "My registrations": type the address, get one link (BR-REQ-036-04, `DECISIONS.md` §77).
 * The same shape as the resend form and the same one answer, because a form anybody can type
 * any address into must not say whether that address is known. The form's defences are the
 * contact form's (§675): the honeypot, the timing check and Cloudflare's check when the club has
 * it on — the one other sentence is the check's own refusal, which says nothing of the address.
 */
export default async function MyRegistrationsRequestPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { sent, captcha, since } = await searchParams;
  // One-word namespaces (the i18n check reads `getTranslations("Registrations.mine")` as none).
  const t = await getTranslations("Registrations");
  const legal = await getTranslations("Legal");
  // The bot check's refusal line, in the registration form's words (`Registration.errors.captcha`).
  const registration = await getTranslations("Registration");
  const now = new Date();
  // The link leaves on the scheduler's tick by default (§513): "just sent" would be untrue for up to
  // the outbox job's wait, as on the resend page — the same real wait, read only on "sent".
  const waitMinutes = sent ? await cachedEmailWaitMinutes(now) : null;
  // The widget only while the club has the check on (§254), from the public cache as the contact
  // page reads it — a GET wakes nothing.
  const siteKey = sent ? undefined : await cachedBotCheckSiteKey();
  const refused = captcha === "1";
  // Timed from the render the person first saw on a refused redraw (§146), so a quick retry is not a bot.
  const renderedAt = ((refused ? parseInterestSince(since, now) : null) ?? now).toISOString();

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("mine.title")}
      </Typography>

      {sent ? (
        <>
          {/* While the club's emails are late (§623), above the wait the sentence below promises. */}
          {await emailDelayNotice({ variant: "link", sx: { mb: 2 } })}
          <Alert severity="success">
            {waitMinutes === null ? t("mine.sent") : t("mine.sentScheduled", { wait: minutesPhrase(locale, waitMinutes) })}
          </Alert>
          {/* Where the link most often hides (§619), in its own box under the sentence. */}
          <Alert severity="info" sx={{ mt: 2 }} data-testid="spam-hint">
            {await spamHintWords()}
          </Alert>
        </>
      ) : (
        <form action={requestMyRegistrationsLinkAction}>
          {/* Bots fill every field; a human never sees or fills this one. */}
          <input
            type="text"
            name="honeypot"
            autoComplete="off"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
          />
          <input type="hidden" name="renderedAt" value={renderedAt} />
          <Stack spacing={2}>
            <input type="hidden" name="locale" value={locale} />
            <Typography variant="body1">{t("mine.intro")}</Typography>
            <TextField
              name="email"
              type="email"
              label={t("mine.email")}
              required
              autoComplete="email"
              // No helper (§546): the sentence above says which address.
            />
            {/* Cloudflare's check (§675), as on the contact form: its own island, reset by this
                render's time (§185), Cloudflare's sentence with it (§323), no room before (§593). */}
            {siteKey && (
              <Box sx={BOT_CHECK_SLOT_SX}>
                <BotCheck siteKey={siteKey} locale={locale} attempt={now.toISOString()} notice />
                {refused && (
                  <Typography variant="body2" color="error" sx={{ mt: 1 }} {...{ [BOT_CHECK_ERROR_ATTRIBUTE]: "true" }}>
                    {registration("errors.captcha")}
                  </Typography>
                )}
              </Box>
            )}
            <Button type="submit" variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
              <ForwardToInboxIcon aria-hidden="true" sx={glyphSx("medium")} />
              {t("mine.submit")}
            </Button>
          </Stack>
        </form>
      )}
      {/* The notice, under the form that asks for an address (§323). */}
      <Typography variant="body2" sx={{ mt: 2 }}>
        <Link href="/legal/privacy" style={{ display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight }}>
          {legal("privacyLinkLabel")}
        </Link>
      </Typography>
    </Container>
  );
}
