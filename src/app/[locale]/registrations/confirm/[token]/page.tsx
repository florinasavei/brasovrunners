import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { readRegistrationTokenContext } from "@/modules/registrations/token-actions";
import { confirmEmailAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The email-confirmation landing page (AGENTS.md §13.2). The GET here only *reads* the token
 * context — `readRegistrationTokenContext` runs inside a read-only transaction — so a mail
 * scanner fetching this link before a human sees it cannot confirm anything; only the explicit
 * POST below can.
 */
export default async function ConfirmEmailPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { done, invalid } = await searchParams;
  const t = await getTranslations("Registrations");

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
        <Alert severity="success">{t("confirm.done")}</Alert>
      </Container>
    );
  }

  const context = invalid ? { ok: false as const } : await readRegistrationTokenContext(token, "VERIFY_REGISTRATION_EMAIL");

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("confirm.title")}
      </Typography>

      {!context.ok ? (
        <Alert severity="warning">{t("invalidOrExpired")}</Alert>
      ) : (
        <form action={confirmEmailAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <Typography sx={{ mb: 2 }}>{t("confirm.prompt")}</Typography>
          <Button type="submit" variant="contained">
            {t("confirm.action")}
          </Button>
        </form>
      )}
    </Container>
  );
}
