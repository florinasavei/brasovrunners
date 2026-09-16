import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { requestRegistrationLinkAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string; event?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Not a page for a search engine: it is a form for one person who lost an email, and
  // indexing it would invite exactly the traffic the throttle exists to bound.
  robots: { index: false, follow: false },
};

/**
 * "Send me that link again" (§19.4's second surface, BR-REQ-036-02).
 *
 * Deliberately not behind a token — this is where somebody goes *because* they have no token.
 * It is also deliberately not behind the registration window: a declaration hold outlives the
 * moment registration closes, and the person holding one still needs their link.
 *
 * The confirmation says "if that address has a registration" rather than "sent", because the
 * page cannot honestly say more without saying who is registered.
 */
export default async function ResendPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { sent, event } = await searchParams;
  const t = await getTranslations("Registration");

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom>
        {t("resend.title")}
      </Typography>

      {sent ? (
        <Alert severity="success">{t("resend.sent")}</Alert>
      ) : (
        <form action={requestRegistrationLinkAction}>
          <Stack spacing={2}>
            <input type="hidden" name="locale" value={locale} />
            {/* Present only when they arrived from an event page; harmless when absent. */}
            <input type="hidden" name="slug" value={event ?? ""} />

            <Typography variant="body1">{t("resend.intro")}</Typography>

            <TextField
              name="email"
              type="email"
              label={t("email")}
              required
              autoComplete="email"
              helperText={t("resend.emailHelp")}
            />

            <Button type="submit" variant="contained">
              {t("resend.submit")}
            </Button>
          </Stack>
        </form>
      )}
    </Container>
  );
}
