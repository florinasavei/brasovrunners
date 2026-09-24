import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { PAGE_WIDTH } from "@/theme/brand";

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
  /*
    The text in effect, with the last copy of it behind it (§281). A legal document changes a
    handful of times a year, so a copy of one is as true as the live read in every case but the
    hour after an approval — and a privacy notice nobody can read is worse than one that is a
    few hours behind, which the banner says anyway.
  */
  const read = await readWithLastGood(`legal:PRIVACY_NOTICE:${locale}`, () =>
    findCurrentApprovedDocument(getDb(), "PRIVACY_NOTICE", locale, new Date()),
  );
  const document = read.value;

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
      <LastGoodNotice read={read} />

      {document ? (
        <>
          <Typography variant="h1" gutterBottom>
            {document.title}
          </Typography>
          {/* Which text this is (§323): a registration records the version it was shown, and a
              reader comparing the two needs the number and the day it took effect. */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("inForce", {
              version: document.version,
              date: formatDay(new Date(document.effectiveAt), { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }),
            })}
          </Typography>
          <LegalDocumentBody body={document.body} />
        </>
      ) : (
        <Alert severity="info">{t("unavailable")}</Alert>
      )}
    </Container>
  );
}
