import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

/** The terms and conditions. See `legal/privacy/page.tsx` for why this never 404s. */
export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    return null;
  }
  setRequestLocale(locale);

  const t = await getTranslations("Legal");
  const document = await findCurrentApprovedDocument(getDb(), "TERMS", locale, new Date());

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
      {document ? (
        <>
          <Typography variant="h1" gutterBottom>
            {document.title}
          </Typography>
          <LegalDocumentBody body={document.body} />
        </>
      ) : (
        <Alert severity="info">{t("unavailable")}</Alert>
      )}
    </Container>
  );
}
