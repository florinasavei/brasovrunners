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
import { cancelRegistrationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ done?: string; invalid?: string; started?: string }>;
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

  const { done, invalid, started } = await searchParams;
  const t = await getTranslations("Registrations");

  if (done) {
    return (
      <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
        <Alert severity="success">{t("manage.done")}</Alert>
      </Container>
    );
  }

  const context =
    invalid || started ? { ok: false as const } : await readRegistrationTokenContext(token, "MANAGE_REGISTRATION");

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
        <form action={cancelRegistrationAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <Typography sx={{ mb: 2 }}>{t("manage.prompt")}</Typography>
          <Button type="submit" variant="outlined" color="error">
            {t("manage.action")}
          </Button>
        </form>
      )}
    </Container>
  );
}
