import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDateInWords } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import { minimumAgeMergeValue } from "@/modules/legal-documents/domain/merge-fields";
import { legalPageMetadata, readLegalDocumentsInForce } from "@/modules/legal-documents/public-page";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { VOLUNTEER_MINIMUM_AGE } from "@/modules/volunteers/domain/volunteer";
import { env } from "@/shared/config/env";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";

type Props = { params: Promise<{ locale: string }> };

/** Static, kept by the CDN — the terms' arrangement, for the same reasons (§549). */
export const revalidate = 86400;

/** Its own title, indexed only while a text is in force in this language (§342, `public-page.ts`). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Legal" });
  return legalPageMetadata({
    baseUrl: env.APP_BASE_URL,
    key: "VOLUNTEER_AGREEMENT",
    locale,
    inForce: await readLegalDocumentsInForce("VOLUNTEER_AGREEMENT", new Date()),
    fallbackTitle: t("volunteerAgreementTitle"),
  });
}

/**
 * The volunteer agreement in force (§NNN) — the text «Vreau să fiu voluntar»'s tick «Am citit și accept contractul
 * de voluntariat» links, opened in a new tab so the form keeps what was typed (§197). One text for every event and
 * role: the person's name, the role, the event, its date and place are blanks here, filled when the person accepts
 * (the PDF they receive prints them); the age is the platform's own, so it is filled. Never a 404 — the terms'
 * reasoning (`legal/privacy/page.tsx`): a page that says «not published yet» is an answer.
 */
export default async function VolunteerAgreementPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    return null;
  }
  setRequestLocale(locale);

  const t = await getTranslations("Legal");
  // The text in effect, with the last copy of it behind it (§281), as the terms and the notice read theirs.
  const read = await readWithLastGood(`legal:VOLUNTEER_AGREEMENT:${locale}`, () => cachedCurrentApprovedDocument("VOLUNTEER_AGREEMENT", locale, new Date()));
  const document = read.value;

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <LastGoodNotice read={read} />

      {document ? (
        <>
          <Typography variant="h1" gutterBottom>
            {document.title}
          </Typography>
          {/* The same version line as the terms and the notice (§323, §534). */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: { xs: DENSITY.gapSm, sm: 2 } }}>
            {t("inForce", {
              version: document.version,
              date: formatDateInWords(new Date(document.effectiveAt), { locale, timeZone: CLUB_TIME_ZONE }),
            })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: { xs: DENSITY.gapSm, sm: 2 } }} data-testid="volunteer-agreement-blanks">
            {t("volunteerAgreementBlanks")}
          </Typography>
          <LegalDocumentBody body={document.body} values={{ minimumAge: minimumAgeMergeValue(VOLUNTEER_MINIMUM_AGE, locale) }} />
        </>
      ) : (
        <>
          <Typography variant="h1" gutterBottom>
            {t("volunteerAgreementTitle")}
          </Typography>
          <Alert severity="info">{t("unavailable")}</Alert>
        </>
      )}
    </Container>
  );
}
