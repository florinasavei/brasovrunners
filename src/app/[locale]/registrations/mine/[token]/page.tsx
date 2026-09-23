import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { readMyRegistrations } from "@/modules/registrations/my-registrations";
import { env } from "@/shared/config/env";
import ContactLink from "@/shared/ui/ContactLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  cancelFromMyRegistrationsAction,
  selfCheckInFromMyRegistrationsAction,
  setListConsentFromMyRegistrationsAction,
} from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{
    done?: string;
    invalid?: string;
    started?: string;
    here?: string;
    hereFailed?: string;
    list?: string;
    listFailed?: string;
  }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Every active registration of the person holding the link (BR-REQ-036-04, `DECISIONS.md`
 * §77): the event, the state, the code and its QR once confirmed, "I am here" from the day
 * before, and cancel. A GET reads and never writes; every button is its own POST. An invalid,
 * expired or used token renders the same sentence every token page renders.
 */
export default async function MyRegistrationsPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { done, invalid, started, here, hereFailed, list, listFailed } = await searchParams;
  const t = await getTranslations("Registrations");
  const format = await getFormatter();

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 2, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("mine.cancelledTitle")}
        </Typography>
        <Alert severity="success">{t("mine.cancelled")}</Alert>
        <Typography sx={{ mt: 2 }}>
          <Link href="/registrations/mine">{t("mine.newLink")}</Link>
        </Typography>
      </Container>
    );
  }

  // One token read for the page — throttled per presented token.
  const context = invalid ? { ok: false as const } : await readMyRegistrations(getDb(), token, locale, new Date());

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 2, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("mine.listTitle")}
      </Typography>

      {started && <Alert severity="info" sx={{ mb: 2 }}>{t("manage.eventStarted")}</Alert>}

      {!context.ok ? (
        <>
          <Alert severity="warning">{t("invalidOrExpired")}</Alert>
          <Typography sx={{ mt: 2 }}>
            <Link href="/registrations/mine">{t("mine.newLink")}</Link>
          </Typography>
        </>
      ) : context.items.length === 0 ? (
        <Typography>{t("mine.empty")}</Typography>
      ) : (
        <Stack component="ul" spacing={2} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {context.items.map((item) => (
            <Box
              component="li"
              key={item.id}
              data-testid="my-registration"
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, mb: 1 }}>
                <Typography variant="h2" sx={{ fontSize: "1.125rem" }}>
                  {item.eventSlug ? (
                    <Link href={{ pathname: "/events/[slug]", params: { slug: item.eventSlug } }}>
                      {item.eventTitle ?? item.eventId}
                    </Link>
                  ) : (
                    (item.eventTitle ?? item.eventId)
                  )}
                </Typography>
                <Chip
                  size="small"
                  color={item.status === "CONFIRMED" ? "success" : item.status === "WAITLISTED" ? "default" : "warning"}
                  label={t(`mine.status.${item.status}`)}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {format.dateTime(item.eventStartsAt, {
                  timeZone: item.eventTimezone,
                  dateStyle: "full",
                  timeStyle: "short", hourCycle: "h23",
                })}
              </Typography>

              {item.status === "CONFIRMED" && item.checkinCode && (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "flex-start", sm: "center" }, mb: 1.5 }}>
                  <Box
                    component="img"
                    src={`${env.APP_BASE_URL}/api/registrations/qr/${item.checkinCode}.png`}
                    alt={t("manage.qrAlt", { code: item.checkinCode })}
                    width={160}
                    height={160}
                    sx={{ width: 160, height: 160, border: 1, borderColor: "divider", borderRadius: 1 }}
                  />
                  <Box>
                    {/*
                      The number the runner has (§214). Before registration closes it is the
                      provisional one, and it is said so in a sentence beneath rather than left
                      to look final: this is the number they will quote to a volunteer, and the
                      one thing worse than not showing it is showing it as settled when it is not.
                    */}
                    {raceNumberOf(item) && (
                      <>
                        <Typography variant="body2" color="text.secondary">
                          {t("mine.bib")}
                        </Typography>
                        <Typography sx={{ fontWeight: 700, fontSize: "1.75rem", color: "primary.main" }}>
                          {raceNumberOf(item)?.value}
                        </Typography>
                        {!raceNumberOf(item)?.settled && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                            {t("mine.bibProvisional")}
                          </Typography>
                        )}
                      </>
                    )}
                    <Typography variant="body2" color="text.secondary">
                      {t("mine.code")}
                    </Typography>
                    <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.375rem", letterSpacing: 2 }}>
                      {item.checkinCode}
                    </Typography>
                  </Box>
                </Stack>
              )}

              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                {item.status === "CONFIRMED" &&
                  (here === item.id || item.checkedInAt ? (
                    <Alert severity="success" sx={{ py: 0 }}>
                      {t("manage.selfCheckInDone")}
                    </Alert>
                  ) : hereFailed === item.id ? (
                    <Alert severity="warning" sx={{ py: 0 }}>
                      {t("manage.selfCheckInFailed")}
                    </Alert>
                  ) : item.selfCheckinOpen ? (
                    <form action={selfCheckInFromMyRegistrationsAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="registrationId" value={item.id} />
                      <Button type="submit" variant="contained" sx={TAP_TARGET}>
                        {t("manage.selfCheckIn")}
                      </Button>
                    </form>
                  ) : null)}
                <form action={cancelFromMyRegistrationsAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="registrationId" value={item.id} />
                  <Button type="submit" variant="outlined" color="error" size="small" sx={{ minHeight: 44 }}>
                    {t("mine.cancel")}
                  </Button>
                </form>
              </Stack>
              {/* What cancelling does not do, where it is done (§NNN): the place goes, the record stays. */}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t.rich("cancelKeepsRecord", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
              </Typography>

              {/*
                The public participant list, the participant's own switch (BR-REQ-039-01;
                `DECISIONS.md` §143): the answer as it stands, and the button that sets the other
                one. The link is read, never spent — as "I am here" above — so cancel stays.
              */}
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {list === item.id && (
                  <Alert severity="success" sx={{ py: 0 }}>
                    {t("list.changed")}
                  </Alert>
                )}
                {listFailed === item.id && (
                  <Alert severity="warning" sx={{ py: 0 }}>
                    {t("list.failed")}
                  </Alert>
                )}
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                  <Typography variant="body2" color="text.secondary">
                    {item.listed ? t("list.shortListed") : t("list.shortNotListed")}
                  </Typography>
                  <form action={setListConsentFromMyRegistrationsAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="registrationId" value={item.id} />
                    <input type="hidden" name="listed" value={item.listed ? "0" : "1"} />
                    <Button type="submit" variant="text" size="small" sx={{ minHeight: 44 }}>
                      {item.listed ? t("list.optOut") : t("list.optIn")}
                    </Button>
                  </form>
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Container>
  );
}
