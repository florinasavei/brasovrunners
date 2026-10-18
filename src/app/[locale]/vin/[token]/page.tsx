import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { readRsvpLink } from "@/modules/rsvp/rsvp";
import { isWithdrawnProof } from "@/modules/rsvp/withdrawn-proof";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { DENSITY } from "@/theme/density";
import { confirmRsvpAction, withdrawRsvpAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ invalid?: string; retras?: string; ok?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The page a «Vin!» message's two buttons open (§NNN, «Vin!» part 1): «Da, vin» (`RSVP_CONFIRM`) or «Nu mai vin» (`RSVP_WITHDRAW`) —
 * one route, because the link itself says which it is.
 *
 * **The GET changes nothing** (AGENTS.md §12.8, BR-REQ-036-02 criterion 4): a mail client's link scanner opens every link before
 * its owner does, and must count nobody and delete nobody. The page names the event and shows ONE button; the button is a POST
 * (`actions.ts`) that spends the link. A link already used, replaced or past its life says so in one sentence and points at the
 * event's page; one that is unknown says so and points at the listing. The read is throttled per link, as every token page is
 * (§19.4, `tokenAttemptAllowed`).
 */
export default async function RsvpLinkPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { invalid, retras, ok } = await searchParams;
  const t = await getTranslations("Rsvp");
  const db = getDb();
  const now = new Date();
  const inlineLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight } as const;

  /*
    After «Nu mai vin» (the answer and its links are gone): the sentence, and the event's page when it is known. The row is gone, so
    the database cannot say the press happened: the redirect carries a keyed proof (`withdrawn-proof.ts`), and without it (an address
    somebody typed) the page names no event and claims nothing.
  */
  if (retras !== undefined && invalid === undefined) {
    const event = retras && isWithdrawnProof(ok, token, retras) ? await findPublishedEventBySlug(db, locale, retras) : undefined;
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
        <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
          {t("withdrawnTitle")}
        </Typography>
        <Stack spacing={1.5}>
          <Alert severity="success" role="status" data-testid="rsvp-withdrawn">
            {event ? t("withdrawDone", { event: event.title }) : t("withdrawDoneNoEvent")}
          </Alert>
          <Typography variant="body2">
            {event ? (
              <Link href={{ pathname: "/events/[slug]", params: { slug: retras ?? "" } }} style={inlineLink}>
                {t("eventLink")}
              </Link>
            ) : (
              <Link href="/events" style={inlineLink}>
                {t("eventsLink")}
              </Link>
            )}
          </Typography>
        </Stack>
      </Container>
    );
  }

  const link = invalid !== undefined || !(await tokenAttemptAllowed(db, token, now)) ? null : await readRsvpLink(db, token, now);
  const live = link?.state === "live" ? link : null;

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {!link ? t("linkInvalid") : link.purpose === "RSVP_WITHDRAW" ? t("withdrawTitle") : t("confirmTitle")}
      </Typography>

      {!live ? (
        <Stack spacing={1.5} data-testid="rsvp-link-invalid">
          <Alert severity="warning">
            <AlertTitle>{t("linkInvalid")}</AlertTitle>
            {link?.state === "over"
              ? t("invalidOver")
              : link?.state === "expired"
                ? t("invalidExpired")
                : link?.state === "used" && link.confirmed && link.purpose === "RSVP_CONFIRM"
                  ? t("confirmAlready", { event: link.title })
                  : t("invalidBody")}
          </Alert>
          <Typography variant="body2">
            {link ? (
              <Link href={{ pathname: "/events/[slug]", params: { slug: link.slug } }} style={inlineLink}>
                {t("eventLink")}
              </Link>
            ) : (
              <Link href="/events" style={inlineLink}>
                {t("eventsLink")}
              </Link>
            )}
          </Typography>
        </Stack>
      ) : live.purpose === "RSVP_CONFIRM" ? (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Typography data-testid="rsvp-confirm-intro">{live.confirmed ? t("confirmAlready", { event: live.title }) : t("confirmIntro", { event: live.title })}</Typography>
          <form action={confirmRsvpAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <SubmitButton label={t("confirmButton")} pendingLabel={t("confirmPending")} size="large">
              <EventAvailableIcon />
            </SubmitButton>
          </form>
          <Typography variant="body2" color="text.secondary">
            {t("rememberNote")}
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Typography data-testid="rsvp-withdraw-intro">{t("withdrawIntro", { event: live.title })}</Typography>
          <form action={withdrawRsvpAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <SubmitButton label={t("withdrawButton")} pendingLabel={t("withdrawPending")} size="large" variant="outlined">
              <EventBusyIcon />
            </SubmitButton>
          </form>
          <Typography variant="body2" color="text.secondary" data-testid="rsvp-withdraw-remember">
            {t("withdrawRememberNote")}
          </Typography>
        </Stack>
      )}
    </Container>
  );
}
