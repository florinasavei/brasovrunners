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
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { requestMyRegistrationsLinkAction } from "./actions";
import { DENSITY } from "@/theme/density";

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
  // One-word namespaces (the i18n check reads `getTranslations("Registrations.mine")` as none).
  const t = await getTranslations("Registrations");
  const legal = await getTranslations("Legal");

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("mine.title")}
      </Typography>

      {sent ? (
        <Alert severity="success">{t("mine.sent")}</Alert>
      ) : (
        <form action={requestMyRegistrationsLinkAction}>
          <Stack spacing={2}>
            <input type="hidden" name="locale" value={locale} />
            <Typography variant="body1">{t("mine.intro")}</Typography>
            <TextField
              name="email"
              type="email"
              label={t("mine.email")}
              required
              autoComplete="email"
              helperText={t("mine.emailHelp")}
            />
            <Button type="submit" variant="contained" sx={TAP_TARGET}>
              {t("mine.submit")}
            </Button>
          </Stack>
        </form>
      )}
      {/* The notice, under the form that asks for an address (§323). */}
      <Typography variant="body2" sx={{ mt: 2 }}>
        <Link href="/legal/privacy" style={{ display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight }}>
          {legal("privacyLinkLabel")}
        </Link>
      </Typography>
    </Container>
  );
}
