import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { routing } from "@/i18n/routing";
import { legalPageMetadata, readLegalDocumentsInForce } from "@/modules/legal-documents/public-page";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { env } from "@/shared/config/env";
import { PAGE_WIDTH } from "@/theme/brand";

type Props = { params: Promise<{ locale: string }> };

/** Per request, from the public cache — the privacy notice's arrangement, for the same reasons (§333). */
export const dynamic = "force-dynamic";

/**
 * Its own title, and indexed only while a text is in force in this language — with a
 * canonical and hreflang to the languages that have one (§342). See `public-page.ts`.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Legal" });
  return legalPageMetadata({
    baseUrl: env.APP_BASE_URL,
    key: "TERMS",
    locale,
    inForce: await readLegalDocumentsInForce("TERMS", new Date()),
    fallbackTitle: t("termsTitle"),
  });
}

/** The terms and conditions. See `legal/privacy/page.tsx` for why this never 404s. */
export default async function TermsPage({ params }: Props) {
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
  const read = await readWithLastGood(`legal:TERMS:${locale}`, () =>
    cachedCurrentApprovedDocument("TERMS", locale, new Date()),
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
          {/* The same version line as the privacy notice (§323). */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("inForce", {
              version: document.version,
              date: formatDay(new Date(document.effectiveAt), { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }),
            })}
          </Typography>
          <LegalDocumentBody body={document.body} />
        </>
      ) : (
        <>
          {/* The document's name even when there is no text yet (§342): the two legal pages
              were one page twice without it. */}
          <Typography variant="h1" gutterBottom>
            {t("termsTitle")}
          </Typography>
          <Alert severity="info">{t("unavailable")}</Alert>
        </>
      )}
    </Container>
  );
}
