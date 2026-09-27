import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { type PublicFaqPage, faqPageOnSite } from "@/modules/content/faq/repository";
import { faqPageJsonLd } from "@/modules/content/faq/structured-data";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { cachedFaqPage } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrl, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import ContactLink from "@/shared/ui/ContactLink";
import { DISCLOSURE_SX } from "@/shared/ui/disclosure";
import JsonLd from "@/shared/ui/JsonLd";
import OpenFoldFromHash from "@/shared/ui/OpenFoldFromHash";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";

type Props = { params: Promise<{ locale: string }> };

/** Per request, like every public page; the page and its questions come from the public cache (§333). */
export const dynamic = "force-dynamic";

/** The answer under its question: the renderer's own type, the fold's body indented under the arrow. */
const ANSWER_SX = { pl: { xs: DENSITY.sectionGap, sm: 3 }, pb: { xs: DENSITY.gapSm, sm: 2 }, "& > :last-child": { mb: 0 } } as const;

/**
 * The page's state and questions, or null when the database cannot say — the contact page's rule
 * for a read that may not answer (§281): the page stands with a sentence where the folds would be.
 */
async function faqOrNull(locale: Locale): Promise<PublicFaqPage | null> {
  try {
    return await cachedFaqPage(locale);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[faq] the page did not answer; it stands without its questions", error);
    return null;
  }
}

/** A question's fold id — the address's `#…` a link to one question names. */
function faqItemAnchor(id: string): string {
  return `q-${id.slice(0, 8)}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Faq" });
  const page = await faqOrNull(locale);
  return {
    title: t("title"),
    description: t("lead", { club: CLUB_NAME }),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/faq")),
    // An address with no question on it is not for a search engine; the sitemap leaves it out too.
    ...(page && faqPageOnSite(page) ? {} : { robots: { index: false, follow: true } }),
  };
}

/**
 * «Întrebări frecvente» / "FAQ" (§NNN): the club's questions, each a fold that opens on its answer
 * — a `<details>` that works with JavaScript off, 44 pixels to a thumb (BR-REQ-041-01 criterion 6)
 * — and the same questions as an `FAQPage` in JSON-LD for search engines.
 *
 * A platform page, like «Echipa» (§459): its address, title and lead are the platform's; the club
 * keeps the questions and the page's switch in `/admin/pages/faq`. A DRAFT page is a 404. Each
 * question reads the page's own language alone (§28). A Server Component; the one island is
 * `OpenFoldFromHash`, which opens the question a link's `#q-…` names (§336).
 */
export default async function FaqPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Faq");
  const page = await faqOrNull(locale);
  if (page && !page.published) notFound();
  const items = page?.items ?? [];
  const jsonLd = faqPageJsonLd(items, staticRouteUrl(env.APP_BASE_URL, "/faq", locale), locale);

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {jsonLd && <JsonLd data={jsonLd} />}
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }}>
        {t("lead", { club: CLUB_NAME })}
      </Typography>

      {items.length === 0 ? (
        <Typography variant="body1">{t("empty")}</Typography>
      ) : (
        <Box
          component="ul"
          // `role="list"` restated for WebKit, which drops it from a list with no markers (§169).
          role="list"
          aria-label={t("listLabel")}
          data-testid="faq-list"
          sx={{ listStyle: "none", m: 0, p: 0, borderTop: 1, borderColor: "divider" }}
        >
          {items.map((item) => (
            <Box component="li" role="listitem" key={item.id} sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Box component="details" id={faqItemAnchor(item.id)} sx={{ ...DISCLOSURE_SX, scrollMarginTop: 16 }}>
                <summary>
                  <Typography component="span" sx={{ fontWeight: 600, fontSize: { xs: "1rem", sm: "1.0625rem" }, overflowWrap: "anywhere" }}>
                    {item.question}
                  </Typography>
                </summary>
                {/* Through the renderer's allowlist, never markup the club did not type (§11.3). */}
                <Box sx={ANSWER_SX} data-testid="faq-answer">
                  <RichText body={item.answer} />
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
        {t.rich("contact", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
      </Typography>
      <OpenFoldFromHash />
    </Container>
  );
}
