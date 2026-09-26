import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { Suspense } from "react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { readWithLastGood, type Resilient } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { routing } from "@/i18n/routing";
import { cachedPublishedAlbums } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import ContactLink from "@/shared/ui/ContactLink";
import AlbumGrid from "./AlbumGrid";
import { GalleryGridSkeleton } from "@/shared/ui/PublicSkeleton";
import { PAGE_WIDTH } from "@/theme/brand";
import { headingRule } from "@/theme/surfaces";
import { DENSITY } from "@/theme/density";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Gallery" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/gallery")),
  };
}

/**
 * The albums (BR-REQ-054-01): a cover, a title, a date, a count — each card one link. Only
 * published albums, only in a locale that has a translation (BR-REQ-040-02). Light on purpose:
 * one thumbnail per album, lazy, sized on upload, no script.
 */
export default async function GalleryPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Gallery");
  // Started, not awaited (§166): the heading and the intro reach the browser at once, and
  // the covers fill a grid of their own size when the query answers — from the public cache,
  // which publishing an album or adding a photo expires (§333).
  const albums = readWithLastGood(`gallery:${locale}`, () => cachedPublishedAlbums(locale));

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
        {t("intro")}
      </Typography>
      {/* Photographs are a legitimate-interest processing, so the way to object is said where
          they are (§323): a message, no reason asked. */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        {t.rich("photosNotice", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
      </Typography>

      <Suspense fallback={null}>
        <GalleryStaleNotice albums={albums} />
      </Suspense>

      <Suspense fallback={<GalleryGridSkeleton label={t("loading")} />}>
        <AlbumGrid albums={albums.then((read) => read.value)} />
      </Suspense>
    </Container>
  );
}

/** The "last copy" line for the albums, once the query has settled (§281). */
async function GalleryStaleNotice({ albums }: { albums: Promise<Resilient<unknown>> }) {
  return <LastGoodNotice read={await albums} />;
}
