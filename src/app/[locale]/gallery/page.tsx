import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { Suspense } from "react";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { readWithLastGood, type Resilient } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { listPublishedAlbums } from "@/modules/content/gallery/repository";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import CardLink from "@/shared/ui/CardLink";
import ContactLink from "@/shared/ui/ContactLink";
import { GalleryGridSkeleton } from "@/shared/ui/PublicSkeleton";
import { PAGE_WIDTH } from "@/theme/brand";
import { headingRule } from "@/theme/surfaces";
import { fadeInSoft, liftOnHover, riseIn } from "@/theme/motion";

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
  // the covers fill a grid of their own size when the query answers.
  const albums = readWithLastGood(`gallery:${locale}`, () => listPublishedAlbums(getDb(), locale));

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
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

/**
 * The albums themselves, behind a `<Suspense>` boundary (§166).
 *
 * The query is started by the page and awaited here, so the shell is sent while the database
 * is still answering and the wait is a grid of covers rather than a blank page.
 */
async function AlbumGrid({ albums: pending }: { albums: ReturnType<typeof listPublishedAlbums> }) {
  const t = await getTranslations("Gallery");
  const format = await getFormatter();
  const albums = await pending;

  return (
    <Box sx={fadeInSoft}>
      {albums.length === 0 ? (
        <Typography variant="body1">{t("empty")}</Typography>
      ) : (
        <Box
          component="ul"
          sx={{
            listStyle: "none",
            m: 0,
            p: 0,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
            gap: 2,
          }}
        >
          {albums.map((album, index) => (
            <Card key={album.id} component="li" variant="outlined" sx={{ ...liftOnHover, ...riseIn(index) }}>
              <CardLink href={{ pathname: "/gallery/[slug]", params: { slug: album.slug } }}>
                {album.coverThumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- our own WebP thumbnail, sized on upload
                  <img
                    src={album.coverThumbUrl}
                    alt=""
                    loading={index < 3 ? "eager" : "lazy"}
                    style={{ display: "block", width: "100%", aspectRatio: "4 / 3", objectFit: "cover" }}
                  />
                )}
                <CardContent>
                  <Typography variant="h2" sx={{ fontSize: "1.125rem", mb: 0.5 }}>
                    {album.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {format.dateTime(album.takenOn, { dateStyle: "long" })} · {t("photoCount", { count: album.photoCount })}
                  </Typography>
                </CardContent>
              </CardLink>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** The "last copy" line for the albums, once the query has settled (§281). */
async function GalleryStaleNotice({ albums }: { albums: Promise<Resilient<unknown>> }) {
  return <LastGoodNotice read={await albums} />;
}
