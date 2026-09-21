import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { findPublishedPageBySlug } from "@/modules/content/pages/repository";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { PAGE_WIDTH, PROSE_MEASURE } from "@/theme/brand";

type Props = { params: Promise<{ locale: string; slug: string }> };

/** A page's text changes when the club saves it, with no deploy in between. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const page = await findPublishedPageBySlug(getDb(), locale, slug);
  if (!page) return {};

  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? undefined,
    robots: { index: true, follow: true },
    // Shared as an article, with the site's card (`[locale]/opengraph-image.tsx`, §90).
    openGraph: { title: page.seoTitle ?? page.title, description: page.seoDescription ?? undefined, type: "article" },
  };
}

/**
 * A standing page the club wrote for itself — "About Brașov Runners" and its like
 * (BR-REQ-050-03, `DECISIONS.md` §51).
 *
 * Unpublished is a 404, and so is a locale with no translation: BR-REQ-040-02 forbids falling
 * back to the other language, and this route never does — `findPublishedPageBySlug` joins on
 * this locale's row and nothing else.
 *
 * The body renders through the legal-document renderer, which takes the same section shape and
 * uses no `dangerouslySetInnerHTML` anywhere. Reused rather than generalised: `AGENTS.md` §1.5
 * abstracts on the third occurrence and this is the second.
 */
export default async function StandingPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const page = await findPublishedPageBySlug(getDb(), locale, slug);
  if (!page) notFound();

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
      {/* As wide as the header, so the title sits on the logo's column; the prose stops at a
          readable measure rather than running the whole width (AGENTS.md §18.2). */}
      <Box sx={{ maxWidth: PROSE_MEASURE }}>
        <Typography variant="h1" gutterBottom>
          {page.title}
        </Typography>
        <RichText body={page.bodyJson} />
      </Box>
    </Container>
  );
}
