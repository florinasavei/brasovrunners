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
import { holdsOptionalData } from "@/modules/registrations/consent-withdrawal";
import ActionLinkNotice from "@/modules/registrations/ui/ActionLinkNotice";
import { readRaceDayContext, readSpentRegistrationLink } from "@/modules/registrations/token-actions";
import { env } from "@/shared/config/env";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  cancelRegistrationAction,
  selfCheckInAction,
  setListConsentFromManageAction,
  withdrawFromManageAction,
} from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{
    done?: string;
    invalid?: string;
    started?: string;
    here?: string;
    list?: string;
    withdrawn?: string;
  }>;
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

  const { done, invalid, started, here, list, withdrawn } = await searchParams;
  const t = await getTranslations("Registrations");
  const format = await getFormatter();

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 2, sm: 3 } }}>
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
  //
  // The token is read even after a failed POST. `invalid=1` used to skip the read, so somebody
  // who had already cancelled from this link — the one action that spends it — was told the
  // link was broken rather than that the registration was cancelled and the place released.
  const context = started ? null : await readRaceDayContext(token, new Date());
  const spent =
    context && !context.ok
      ? await readSpentRegistrationLink(
          token,
          [{ purpose: "MANAGE_REGISTRATION" as const, reason: context.reason }],
          locale,
          new Date(),
        )
      : null;
  const blocked = context === null || !context.ok || Boolean(invalid);
  const live = context !== null && context.ok && !invalid ? context : null;
  const confirmed = live !== null && live.registration.status === "CONFIRMED" ? live : null;

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 2, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("manage.title")}
      </Typography>

      {started ? (
        <Alert severity="info">{t("manage.eventStarted")}</Alert>
      ) : blocked ? (
        <ActionLinkNotice locale={locale} status={spent} />
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

          {/*
            The public participant list, the participant's own switch (BR-REQ-039-01;
            `DECISIONS.md` §143). The manage token is read, never spent — the same page must
            still be able to cancel — and the sentence reads the row as it stands now.
          */}
          {live && (
            <Box component="section" id="list">
              <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
                {t("list.title")}
              </Typography>
              {list === "1" && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {t("list.changed")}
                </Alert>
              )}
              {list === "0" && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t("list.failed")}
                </Alert>
              )}
              <Typography sx={{ mb: 2 }}>{live.registration.listOptOut ? t("list.notListed") : t("list.listed")}</Typography>
              <form action={setListConsentFromManageAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="listed" value={live.registration.listOptOut ? "1" : "0"} />
                <Button type="submit" variant="outlined" sx={TAP_TARGET}>
                  {live.registration.listOptOut ? t("list.optIn") : t("list.optOut")}
                </Button>
              </form>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("list.help")}
              </Typography>
              <Divider sx={{ mt: 3 }} />
            </Box>
          )}

          {/*
            What was given on consent, withdrawn from here (§322; art. 7(3) GDPR: as easy as it
            was to give). A button only for what the row still holds — never the value itself on
            the page — each its own POST, the link read and not spent, so cancel below still works.
            The outcome stays shown after the button that caused it has gone.
          */}
          {live && (holdsOptionalData(live.registration, "health") || holdsOptionalData(live.registration, "socials") || (withdrawn !== undefined && withdrawn !== "")) && (
            <Box component="section" id="consent">
              <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
                {t("withdraw.title")}
              </Typography>
              {withdrawn === "health" && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {t("withdraw.healthDone")}
                </Alert>
              )}
              {withdrawn === "socials" && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {t("withdraw.socialsDone")}
                </Alert>
              )}
              {withdrawn === "0" && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t("withdraw.failed")}
                </Alert>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("withdraw.help")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: "flex-start" }}>
                {holdsOptionalData(live.registration, "health") && (
                  <form action={withdrawFromManageAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="field" value="health" />
                    <Button type="submit" variant="outlined" sx={TAP_TARGET}>
                      {t("withdraw.health")}
                    </Button>
                  </form>
                )}
                {holdsOptionalData(live.registration, "socials") && (
                  <form action={withdrawFromManageAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="field" value="socials" />
                    <Button type="submit" variant="outlined" sx={TAP_TARGET}>
                      {t("withdraw.socials")}
                    </Button>
                  </form>
                )}
              </Stack>
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
