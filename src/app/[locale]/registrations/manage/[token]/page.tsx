import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import { getFormatter } from "next-intl/server";
import { readRaceDayContext } from "@/modules/registrations/token-actions";
import { env } from "@/shared/config/env";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { cancelRegistrationAction, selfCheckInAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string; started?: string; here?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Manage/cancel a registration (BR-REQ-036-01). The GET shows the current state and asks for
 * explicit confirmation; nothing changes until the POST.
 */
export default async function ManageRegistrationPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { done, invalid, started, here } = await searchParams;
  const t = await getTranslations("Registrations");
  const format = await getFormatter();

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
        {/* An outcome page still opens with a heading: a document whose only content is an
            alert gives a screen reader nothing to navigate to. */}
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("manage.doneTitle")}
        </Typography>
        <Alert severity="success">{t("manage.done")}</Alert>
      </Container>
    );
  }

  // One token read for the page — it is throttled per presented token, so a second read here
  // would charge the participant twice. It also carries race day (BR-REQ-037-08): the code,
  // its QR, and "I am here", shown only once confirmed.
  const context = invalid || started ? { ok: false as const } : await readRaceDayContext(token, new Date());
  const confirmed = context.ok && context.registration.status === "CONFIRMED" ? context : null;

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("manage.title")}
      </Typography>

      {started ? (
        <Alert severity="info">{t("manage.eventStarted")}</Alert>
      ) : !context.ok ? (
        <Alert severity="warning">{t("invalidOrExpired")}</Alert>
      ) : (
        <Stack spacing={3}>
          {confirmed?.registration.checkinCode && (
            <Box component="section">
              <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
                {t("manage.raceDayTitle")}
              </Typography>
              <Typography sx={{ mb: 2 }}>{t("manage.codeIntro")}</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "flex-start", sm: "center" } }}>
                <Box
                  component="img"
                  src={`${env.APP_BASE_URL}/api/registrations/qr/${confirmed.registration.checkinCode}.png`}
                  alt={t("manage.qrAlt", { code: confirmed.registration.checkinCode })}
                  width={200}
                  height={200}
                  sx={{ width: 200, height: 200, border: 1, borderColor: "divider", borderRadius: 1 }}
                />
                <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.5rem", letterSpacing: 2 }}>
                  {confirmed.registration.checkinCode}
                </Typography>
              </Stack>

              <Box sx={{ mt: 2 }}>
                {here === "1" || confirmed.registration.checkedInAt ? (
                  <Alert severity="success">{t("manage.selfCheckInDone")}</Alert>
                ) : here === "0" ? (
                  <Alert severity="warning">{t("manage.selfCheckInFailed")}</Alert>
                ) : confirmed.selfCheckinOpen ? (
                  <form action={selfCheckInAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="token" value={token} />
                    <Button type="submit" variant="contained" sx={TAP_TARGET}>
                      {t("manage.selfCheckIn")}
                    </Button>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {t("manage.selfCheckInHelp")}
                    </Typography>
                  </form>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t("manage.selfCheckInClosed", {
                      date: format.dateTime(confirmed.selfCheckinOpensAt, { dateStyle: "long" }),
                    })}
                  </Typography>
                )}
              </Box>
              {/* Their own signed declaration, as a PDF, from the same link (§95). */}
              <Typography variant="body2" sx={{ mt: 2 }}>
                <a href={`/api/registrations/declaration/${token}`} target="_blank" rel="noopener">
                  {t("manage.declarationPdf")}
                </a>
              </Typography>
              <Divider sx={{ mt: 3 }} />
            </Box>
          )}

          {/* `#cancel` is where "I can't make it any more" in the email lands (§96). */}
          <form action={cancelRegistrationAction} id="cancel">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <Typography sx={{ mb: 2 }}>{t("manage.prompt")}</Typography>
            <Button type="submit" variant="outlined" color="error" sx={TAP_TARGET}>
              {t("manage.action")}
            </Button>
          </form>
        </Stack>
      )}
    </Container>
  );
}
