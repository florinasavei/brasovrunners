import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Script from "next/script";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  CONTACT_ERROR_SUMMARY_ID,
  CONTACT_MESSAGE_MAX,
  parseContactError,
  parseContactErrorFields,
} from "@/modules/contact/fields";
import { readFormDraft } from "@/modules/registrations/form-draft";
import { TURNSTILE_SCRIPT_URL, turnstileSiteKey } from "@/modules/registrations/turnstile";
import { env } from "@/shared/config/env";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { submitContactAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string; error?: string; fields?: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Contact" });
  return { title: t("title"), description: t("intro") };
}

const fieldId = (name: string) => `c-${name}`;

/**
 * "Scrie-ne" (BR-REQ-070-04, `DECISIONS.md` §149): three boxes, the registration form's bot
 * defences, and a message that lands in the club's own mailbox without touching the outbox.
 *
 * A Server Component with one client island — the submit button, which says the server is
 * working. Every guard is on the server; a rejection is a redirect back here with the field
 * names and the typed values in the draft cookie, the same shape as the registration form.
 *
 * On a deployment where the form has no way out (`CONTACT_FORM_MODE=off`) the page shows the
 * club's address as a `mailto:` instead of a form that would fail — the address from the
 * environment, never the source (§8).
 */
export default async function ContactPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { sent, error: rawError, fields } = await searchParams;
  const t = await getTranslations("Contact");
  const now = new Date();

  const error = parseContactError(rawError);
  const rejected = parseContactErrorFields(fields);
  const invalid = new Set<string>(rejected);
  // What they typed before the rejection (§142) — and, after a send, the address alone, so
  // the confirmation can name where the answer goes without the address touching the URL.
  const draft = error || sent ? await readFormDraft() : null;
  const typed = (name: string) => draft?.[name];

  const writeTo = env.EMAIL_REPLY_TO;
  const formAvailable = env.CONTACT_FORM_MODE !== "off";
  const inlineLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight } as const;

  const field = (name: "name" | "email" | "message", help?: string) => ({
    id: fieldId(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
    defaultValue: typed(name),
  });

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        {t("intro")}
      </Typography>

      {sent ? (
        <Alert severity="success" role="status">
          <AlertTitle>{t("sent.title")}</AlertTitle>
          {typed("email") ? t("sent.bodyTo", { email: typed("email") ?? "" }) : t("sent.body")}
        </Alert>
      ) : !formAvailable ? (
        // No form on this deployment: the club's address, when the club has named one (§8).
        <Typography variant="body1">
          {writeTo ? (
            <>
              {t("off.writeTo")}{" "}
              <MuiLink href={`mailto:${writeTo}`} sx={inlineLink}>
                {writeTo}
              </MuiLink>
            </>
          ) : (
            t("off.none")
          )}
        </Typography>
      ) : (
        <>
          {/* The redirect's landing: focusable, so a rejection is read rather than hunted for (§47). */}
          {error && (
            <Alert severity="error" id={CONTACT_ERROR_SUMMARY_ID} role="alert" tabIndex={-1} sx={{ mb: 2 }}>
              <AlertTitle>{t("errors.title")}</AlertTitle>
              {error === "VALIDATION_ERROR" && rejected.length > 0 ? (
                <>
                  {t("errors.fieldsIntro")}
                  <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
                    {rejected.map((name) => (
                      <li key={name}>
                        <MuiLink href={`#${fieldId(name)}`}>{t(`fieldNames.${name}`)}</MuiLink>
                      </li>
                    ))}
                  </Box>
                </>
              ) : error === "VALIDATION_ERROR" ? (
                t("errors.generic")
              ) : error === "DELIVERY" && writeTo ? (
                <>
                  {t("errors.DELIVERY")}{" "}
                  <MuiLink href={`mailto:${writeTo}`} sx={inlineLink}>
                    {writeTo}
                  </MuiLink>
                </>
              ) : error === "DELIVERY" ? (
                t("errors.DELIVERY_NO_ADDRESS")
              ) : (
                t(`errors.${error}`)
              )}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("requiredLegend")}
          </Typography>

          <form action={submitContactAction}>
            <Stack spacing={2}>
              <input type="hidden" name="locale" value={locale} />
              {/* Bots fill every field; a human never sees or fills this one. */}
              <input
                type="text"
                name="honeypot"
                autoComplete="off"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
              />
              <input type="hidden" name="renderedAt" value={now.toISOString()} />

              <TextField {...field("name")} label={t("name")} required autoComplete="name" fullWidth />
              <TextField
                {...field("email", t("emailHelp"))}
                type="email"
                label={t("email")}
                required
                autoComplete="email"
                fullWidth
              />
              <TextField
                {...field("message", t("messageHelp"))}
                label={t("message")}
                required
                multiline
                minRows={6}
                fullWidth
                slotProps={{ htmlInput: { maxLength: CONTACT_MESSAGE_MAX } }}
              />

              {/* Cloudflare Turnstile, when the club switched it on (§97). */}
              {turnstileSiteKey() && (
                <Box id={fieldId("captcha")}>
                  <div className="cf-turnstile" data-sitekey={turnstileSiteKey()} data-language={locale} />
                  {invalid.has("captcha") && (
                    <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                      {t("errors.captcha")}
                    </Typography>
                  )}
                  <Script src={TURNSTILE_SCRIPT_URL} async defer strategy="afterInteractive" />
                </Box>
              )}

              {/* The notice, named as the registration form names it — a sentence, not the footer's bare "GDPR". */}
              <Typography variant="body2" color="text.secondary">
                {t("privacy")} {t("privacyDetails")}{" "}
                <Link href="/legal/privacy" style={inlineLink}>
                  {t("privacyLinkLabel")}
                </Link>
                .
              </Typography>

              <SubmitButton label={t("submit")} pendingLabel={t("submitting")} incompleteHint={t("incompleteHint")} size="large" fullWidth />
            </Stack>
          </form>
        </>
      )}
    </Container>
  );
}
