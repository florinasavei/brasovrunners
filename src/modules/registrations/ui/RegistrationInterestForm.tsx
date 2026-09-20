import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Script from "next/script";
import { getTranslations } from "next-intl/server";
import { registerInterestAction } from "@/app/[locale]/events/[slug]/actions";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import SubmitButton from "@/shared/ui/SubmitButton";
import { INTEREST_BOX_ID, type InterestOutcome } from "../interest-box";
import { TURNSTILE_SCRIPT_URL, turnstileSiteKey } from "../turnstile";

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

            {/* Cloudflare Turnstile, when the club switched it on (§97). */}
            {siteKey && (
              <Box>
                <div className="cf-turnstile" data-sitekey={siteKey} data-language={locale} />
                <Script src={TURNSTILE_SCRIPT_URL} async defer strategy="afterInteractive" />
              </Box>
            )}

            <SubmitButton label={t("interest.submit")} pendingLabel={t("interest.submitting")} size="large" />

            <Typography variant="body2" color="text.secondary">
              {t("interest.note")} <Link href="/legal/privacy">{t("interest.privacy")}</Link>
            </Typography>
          </Stack>
        </form>
      )}
    </Box>
  );
}
