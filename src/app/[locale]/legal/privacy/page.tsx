import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { routing } from "@/i18n/routing";
import { legalPageMetadata, readLegalDocumentsInForce } from "@/modules/legal-documents/public-page";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { env } from "@/shared/config/env";
import { PAGE_WIDTH } from "@/theme/brand";

type Props = { params: Promise<{ locale: string }> };

// The current approved version can change without a deploy (a new version becoming
// effective), so this renders per request rather than at build time. The text comes from the
// public cache (§333), which an approval expires and whose key is the stretch between effective
// dates — so a version approved ahead of time takes over on its day with nobody saving anything.
export const dynamic = "force-dynamic";

/**
 * Its own title, and indexed only while a notice is in force in this language — with a
 * canonical and hreflang to the languages that have one (§NNN). See `public-page.ts`.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Legal" });
  return legalPageMetadata({
    baseUrl: env.APP_BASE_URL,
    key: "PRIVACY_NOTICE",
    locale,
    inForce: await readLegalDocumentsInForce("PRIVACY_NOTICE", new Date()),
    fallbackTitle: t("privacyTitle"),
  });
}

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
  const format = await getFormatter();
  /*
    The text in effect, with the last copy of it behind it (§281). A legal document changes a
    handful of times a year, so a copy of one is as true as the live read in every case but the
    hour after an approval — and a privacy notice nobody can read is worse than one that is a
    few hours behind, which the banner says anyway.
  */
  const read = await readWithLastGood(`legal:PRIVACY_NOTICE:${locale}`, () =>
    cachedCurrentApprovedDocument("PRIVACY_NOTICE", locale, new Date()),
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
              date: format.dateTime(new Date(document.effectiveAt), { dateStyle: "long" }),
            })}
          </Typography>
          <LegalDocumentBody body={document.body} />
        </>
      ) : (
        <>
          {/* The document's name even when there is no text yet (§NNN): the two legal pages
              were one page twice without it. */}
          <Typography variant="h1" gutterBottom>
            {t("privacyTitle")}
          </Typography>
          <Alert severity="info">{t("unavailable")}</Alert>
        </>
      )}
    </Container>
  );
}
