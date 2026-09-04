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

// The current approved version can change without a deploy (a new version becoming
// effective), so this renders per request rather than at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

/**
 * The privacy notice (AGENTS.md §9.2, §12.5; BR-REQ-053-01 criterion 5).
 *
 * Never 404s: an environment with no approved version yet says so plainly, because this route
 * is reachable from the footer of every public page and a 404 there would look like a broken
 * link rather than "the club has not published this yet."
 */
export default async function PrivacyNoticePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    return null;
  }
  setRequestLocale(locale);

  const t = await getTranslations("Legal");
  const document = await findCurrentApprovedDocument(getDb(), "PRIVACY_NOTICE", locale, new Date());

  return (
    <Container component="main" maxWidth="md" sx={{ py: { xs: 3, sm: 6 } }}>
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
