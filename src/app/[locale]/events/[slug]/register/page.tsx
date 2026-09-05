import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Container from "@mui/material/Container";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { registrationState } from "@/modules/events/domain/registration-window";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { submitRegistrationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ submitted?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The registration form (BR-REQ-030-01, BR-REQ-031-01, BR-REQ-033-01 criterion 1).
 *
 * Only for an event that is `INTERNAL` and currently open — anything else 404s rather than
 * showing a form that cannot submit, the same reasoning `sign-in/page.tsx` gives for not
 * rendering a switcher nobody can use.
 */
export default async function RegisterPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const event = await findPublishedEventBySlug(getDb(), locale, slug);
  if (!event) notFound();

  const now = new Date();
  const state = registrationState(
    {
      registrationMode: event.registrationMode,
      eventStatus: event.eventStatus,
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      publishedAt: event.publishedAt,
    },
    now,
  );
  if (state !== "OPEN") notFound();

  const { submitted, error } = await searchParams;
  const t = await getTranslations("Registration");

  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title", { event: event.title })}
      </Typography>

      {submitted ? (
        <Alert severity="success">{t("submitted")}</Alert>
      ) : (
        <form action={submitRegistrationAction}>
        <Stack spacing={2}>
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
          <input type="hidden" name="renderedAt" value={now.toISOString()} />

          {error && <Alert severity="error">{t("errors.generic")}</Alert>}

          <TextField name="name" label={t("name")} required autoComplete="name" />
          <TextField name="email" type="email" label={t("email")} required autoComplete="email" />

          <FormControlLabel
            control={<Checkbox name="privacyAcknowledged" required />}
            label={
              <>
                {t("privacyPrefix")} <Link href="/legal/privacy">{t("privacyLinkLabel")}</Link>
              </>
            }
          />
          <FormControlLabel
            control={<Checkbox name="resultsNameConsent" />}
            label={t("resultsNameConsent")}
          />
          {/*
            BR-REQ-039-01. Asked on every form, including for an event that publishes no start
            list today: an organizer can switch one on months later, and a question nobody put
            to this person cannot be answered on their behalf afterwards. The label says "if
            the club publishes one" for exactly that reason.
          */}
          <FormControlLabel
            control={<Checkbox name="listOptOut" />}
            label={t("listOptOut")}
          />

          <Button type="submit" variant="contained">
            {t("submit")}
          </Button>
        </Stack>
        </form>
      )}
    </Container>
  );
}
