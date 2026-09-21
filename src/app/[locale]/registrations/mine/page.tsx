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
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { requestMyRegistrationsLinkAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * "My registrations": type the address, get one link (BR-REQ-036-04, `DECISIONS.md` §77).
 * The same shape as the resend form and the same one answer, because a form anybody can type
 * any address into must not say whether that address is known.
 */
export default async function MyRegistrationsRequestPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const { sent } = await searchParams;
  const t = await getTranslations("Registrations.mine");

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 2, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("title")}
      </Typography>

      {sent ? (
        <Alert severity="success">{t("sent")}</Alert>
      ) : (
        <form action={requestMyRegistrationsLinkAction}>
          <Stack spacing={2}>
            <input type="hidden" name="locale" value={locale} />
            <Typography variant="body1">{t("intro")}</Typography>
            <TextField
              name="email"
              type="email"
              label={t("email")}
              required
              autoComplete="email"
              helperText={t("emailHelp")}
            />
            <Button type="submit" variant="contained" sx={TAP_TARGET}>
              {t("submit")}
            </Button>
          </Stack>
        </form>
      )}
    </Container>
  );
}
