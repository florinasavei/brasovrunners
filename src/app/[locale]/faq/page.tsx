import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { type PublicFaqItem, type PublicFaqPage, faqPageOnSite, groupFaqItems } from "@/modules/content/faq/repository";
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

/**
 * Static, made on its first visit and kept by the CDN (§NNN, amending §333); a save of the page or
 * its questions expires it through the rows' own tag, and a day is the ceiling. A literal, as Next
 * requires: it equals `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const revalidate = 86400;

/** The answer under its question: the renderer's own type, the fold's body indented under the arrow. */
const ANSWER_SX = { pl: { xs: DENSITY.sectionGap, sm: 3 }, pb: { xs: DENSITY.gapSm, sm: 2 }, "& > :last-child": { mb: 0 } } as const;

/** The room under the page's lead — the club's introduction or the catalogue's sentence. */
const LEAD_SX = { mb: { xs: DENSITY.sectionGap, sm: 3 } } as const;

/** A category's heading over its folds: the page's section heading, a step under the title. */
const GROUP_HEADING_SX = { fontSize: { xs: "1.125rem", sm: "1.25rem" }, fontWeight: 700, mt: 3, mb: 1 } as const;

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
  // The club's introduction when it wrote one, else the catalogue's sentence — cut where a search
  // engine cuts a description.
  const description = (page?.introText ?? t("lead", { club: CLUB_NAME })).slice(0, 300);
  return {
    title: t("title"),
    description,
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/faq")),
    // The card a shared link draws (§90): the page's title and description, at its own address.
    openGraph: {
      title: t("title"),
      description,
      url: staticRouteUrl(env.APP_BASE_URL, "/faq", locale),
      locale: locale === "en" ? "en_GB" : "ro_RO",
      type: "website",
    },
    // An address with no question on it is not for a search engine; the sitemap leaves it out too.
    ...(page && faqPageOnSite(page) ? {} : { robots: { index: false, follow: true } }),
  };
}

/** One question: a native fold, its glyph and its words on the line, the answer under it. */
function Question({ item }: { item: PublicFaqItem }) {
  return (
    <Box component="li" role="listitem" sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Box component="details" id={faqItemAnchor(item.id)} sx={{ ...DISCLOSURE_SX, scrollMarginTop: 16 }}>
        <summary>
          {/* The glyph every fold header wears (the owner's rule), inline: a flex summary drops the marker. */}
          <HelpOutlineIcon aria-hidden fontSize="small" sx={{ verticalAlign: "text-bottom", mr: 0.75, color: "primary.main" }} data-testid="faq-glyph" />
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
  );
}

/**
 * «Întrebări frecvente» / "FAQ" (§525): the club's introduction, then the club's questions grouped
 * under their «Categorie», each a fold that opens on its answer — a `<details>` that works with
 * JavaScript off, 44 pixels to a thumb (BR-REQ-041-01 criterion 6) — and the same questions as an
 * `FAQPage` in JSON-LD for search engines.
 *
 * A platform page, like «Echipa» (§459): its address and title are the platform's; the club keeps
 * the introduction, the questions and the page's switch in `/admin/pages/faq`. A DRAFT page is a
 * 404. Each question reads the page's own language alone (§28). A Server Component; the one island
 * is `OpenFoldFromHash`, which opens the question a link's `#q-…` names (§336).
 */
export default async function FaqPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Faq");
  const page = await faqOrNull(locale);
  if (page && !page.published) notFound();
  const items = page?.items ?? [];
  const groups = groupFaqItems(items);
  const jsonLd = faqPageJsonLd(items, staticRouteUrl(env.APP_BASE_URL, "/faq", locale), locale);

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {jsonLd && <JsonLd data={jsonLd} />}
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>
      {page?.intro ? (
        // The club's own introduction (§525), through the renderer's allowlist (§11.3).
        <Box sx={LEAD_SX} data-testid="faq-intro">
          <RichText body={page.intro} />
        </Box>
      ) : (
        <Typography variant="body1" color="text.secondary" sx={LEAD_SX}>
          {t("lead", { club: CLUB_NAME })}
        </Typography>
      )}

      {items.length === 0 ? (
        <Typography variant="body1">{t("empty")}</Typography>
      ) : (
        groups.map((group, index) => (
          <Box component="section" key={group.category ?? "__loose"} aria-labelledby={group.category ? `faq-group-${index}` : undefined} data-testid="faq-group">
            {group.category && (
              <Typography variant="h2" id={`faq-group-${index}`} sx={GROUP_HEADING_SX}>
                {group.category}
              </Typography>
            )}
            <Box
              component="ul"
              // `role="list"` restated for WebKit, which drops it from a list with no markers (§169).
              role="list"
              aria-label={group.category ?? t("listLabel")}
              data-testid="faq-list"
              sx={{ listStyle: "none", m: 0, p: 0, borderTop: 1, borderColor: "divider" }}
            >
              {group.items.map((item) => (
                <Question key={item.id} item={item} />
              ))}
            </Box>
          </Box>
        ))
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
        {t.rich("contact", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
      </Typography>
      <OpenFoldFromHash />
    </Container>
  );
}
