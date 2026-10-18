import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { answerRsvpAction, requestRsvpWithdrawAction } from "@/app/[locale]/events/[slug]/actions";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { BOT_CHECK_SLOT_SX } from "@/modules/registrations/domain/turnstile-widget";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import { spamHintWords } from "@/modules/registrations/ui/link-wait-words";
import { turnstileSiteKey } from "@/modules/registrations/turnstile";
import CheckboxField from "@/shared/ui/CheckboxField";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import SubmitButton from "@/shared/ui/SubmitButton";
import { DENSITY } from "@/theme/density";
import { RSVP_BOX_ID, type RsvpOutcome } from "../rsvp-box";
import RsvpCount from "./RsvpCount";
import RsvpRemembered from "./RsvpRemembered";

/**
 * «Vii?» (§NNN, «Vin!» part 1; the owner, 2026-10-18: «how do I mark myself as "Going"?») — the answer «Vin!» on a turn-up event
 * the club ticked, and under it «Vin (N)»: who comes. Drawn by `EventPageView` where the registration card would stand, with the
 * anchor `#vin`, **only while `rsvpOffered` says so** (the page decides, from the one rule): otherwise the page shows nothing — no
 * box, no count, no sentence.
 *
 * Not a registration: no place, no declaration. The interest box's twin (`registrations/ui/RegistrationInterestForm.tsx`) in how
 * it works — a Server Component around a Server Action, the honeypot and the rendering time riding along as hidden fields, the
 * Turnstile widget when the club switched it on, the answer a sentence after a redirect, **the same sentence whatever the address
 * turned out to mean** — plus a tick, «Vreau să apar cu numele», which is the person's own consent to a public name (§143, §396).
 *
 * Without JavaScript the typed form stands and works. The one client island (`RsvpRemembered`) wraps it: a browser that used a
 * «Da, vin» link carries a hint cookie, and the island swaps the typed form for one tap. The page stays static for everybody.
 */
export default async function RsvpBox({
  locale,
  slug,
  eventId,
  renderedAt,
  outcome,
}: {
  locale: Locale;
  slug: string;
  eventId: string;
  /** When this form was rendered — or, on a corrected address, when the one it corrects was. */
  renderedAt: Date;
  outcome: RsvpOutcome | null;
}) {
  const t = await getTranslations("Event");
  const siteKey = turnstileSiteKey();

  const labels = {
    rememberedAs: t.raw("rsvp.rememberedAs") as string,
    going: t("rsvp.going"),
    cancel: t("rsvp.cancel"),
    cancelling: t("rsvp.submitting"),
    notMe: t("rsvp.notMe"),
    help: t("rsvp.help"),
    failed: t("rsvp.failed"),
    submit: t("rsvp.submit"),
    submitting: t("rsvp.submitting"),
    showName: t("rsvp.showName"),
  };

  return (
    <>
      <Box
        id={RSVP_BOX_ID}
        component="section"
        aria-labelledby={`${RSVP_BOX_ID}-heading`}
        data-testid="rsvp-box"
        sx={{ mt: { xs: DENSITY.gapSm, sm: 3 }, p: 2, border: 1, borderColor: "divider", borderRadius: 2, maxWidth: 480, scrollMarginTop: 16 }}
      >
        <Typography id={`${RSVP_BOX_ID}-heading`} variant="h3" component="h2" sx={{ fontSize: "1rem", fontWeight: 700, mb: 0.5 }}>
          {t("rsvp.heading")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("rsvp.intro")}
        </Typography>

        {outcome === "sent" ? (
          // The same sentence whether the address was new, already counted or held back by the throttle (BR-REQ-031-01
          // criterion 3): the box is not an oracle for who answered.
          <>
            <Alert severity="success" role="status" data-testid="rsvp-sent">
              {t("rsvp.done")}
            </Alert>
            {/* The email is still to come: where to look for it (§619). */}
            <Alert severity="info" sx={{ mt: 1.5 }} data-testid="spam-hint">
              {await spamHintWords()}
            </Alert>
          </>
        ) : (
          <RsvpRemembered slug={slug} locale={locale} labels={labels}>
            {outcome === "withdrawSent" && (
              <Alert severity="info" role="status" sx={{ mb: 1.5 }} data-testid="rsvp-withdraw-sent">
                {t("rsvp.withdrawDone")}
              </Alert>
            )}
            <form action={answerRsvpAction}>
              <Stack spacing={1.5}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="slug" value={slug} />
                {/* Bots fill every field; a human never sees or fills this one. */}
                <input type="text" name="honeypot" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
                <input type="hidden" name="renderedAt" value={renderedAt.toISOString()} />

                {(outcome === "invalid" || outcome === "captcha") && (
                  <Alert severity="error" role="alert">
                    {t(`rsvp.${outcome}`)}
                  </Alert>
                )}

                <TextField
                  name="email"
                  type="email"
                  label={t("rsvp.email")}
                  required
                  fullWidth
                  autoComplete="email"
                  slotProps={{ htmlInput: { maxLength: 320 } }}
                  error={outcome === "invalid"}
                />
                <TextField name="name" label={t("rsvp.name")} fullWidth autoComplete="name" slotProps={{ htmlInput: { maxLength: 80 } }} />
                <CheckboxField name="showName">{t("rsvp.showName")}</CheckboxField>

                {/* Cloudflare Turnstile, when the club switched it on (§97): the same explicit widget as every other form (§185, §518, §577). */}
                {siteKey && (
                  <Box sx={BOT_CHECK_SLOT_SX}>
                    <BotCheck siteKey={siteKey} locale={locale} attempt={renderedAt.toISOString()} notice />
                  </Box>
                )}

                <SubmitButton label={t("rsvp.submit")} pendingLabel={t("rsvp.submitting")} size="large">
                  <EventAvailableIcon />
                </SubmitButton>

                <Typography variant="body2" color="text.secondary">
                  {t("rsvp.note")} <Link href="/legal/privacy">{t("rsvp.privacy")}</Link>
                </Typography>
              </Stack>
            </form>

            {/* «Nu mai vin»: the withdraw link by email, never saying whether the address is on the list (BR-REQ-031-01 criterion 3). */}
            <Box
              component="details"
              data-testid="rsvp-withdraw"
              sx={{ mt: 1.5, "& > summary": { ...DISCLOSURE_SUMMARY_SX, minHeight: 44, py: 0.5, fontSize: "0.9375rem" }, ...DISCLOSURE_OPEN_ARROW }}
            >
              <Box component="summary">
                <EventBusyIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
                {t("rsvp.withdrawSummary")}
              </Box>
              <form action={requestRsvpWithdrawAction}>
                <Stack spacing={1.5} sx={{ pt: 1, pb: 0.5 }}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="text" name="honeypot" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
                  <input type="hidden" name="renderedAt" value={renderedAt.toISOString()} />
                  <Typography variant="body2" color="text.secondary">
                    {t("rsvp.withdrawIntro")}
                  </Typography>
                  <TextField name="withdrawEmail" type="email" label={t("rsvp.email")} required fullWidth autoComplete="email" slotProps={{ htmlInput: { maxLength: 320 } }} />
                  <SubmitButton label={t("rsvp.withdrawSubmit")} pendingLabel={t("rsvp.withdrawSubmitting")} variant="outlined">
                    <EventBusyIcon />
                  </SubmitButton>
                </Stack>
              </form>
            </Box>
          </RsvpRemembered>
        )}
      </Box>
      <RsvpCount eventId={eventId} />
    </>
  );
}
