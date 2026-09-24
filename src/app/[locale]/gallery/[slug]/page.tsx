import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findPublishedAlbumBySlug } from "@/modules/content/gallery/repository";
import ContactLink from "@/shared/ui/ContactLink";
import { PAGE_WIDTH } from "@/theme/brand";
import { riseIn } from "@/theme/motion";

type Props = { params: Promise<{ locale: string; slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const album = await findPublishedAlbumBySlug(getDb(), locale, slug);
  if (!album) return {};
  return {
    title: album.title,
    description: album.description ?? undefined,
    robots: { index: true, follow: true },
    ...(album.coverThumbUrl ? { openGraph: { images: [album.coverThumbUrl] } } : {}),
  };
}

/**
 * One album (BR-REQ-054-01): the photos in a grid of thumbnails, each a plain link to its
 * larger variant. No lightbox and no script — a tap opens the photo, the back button returns —
 * which is what "super light" means on a phone at the finish line with one bar of signal.
 * Every image carries its dimensions, so the grid does not jump as they load.
 */
export default async function AlbumPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  // `notFound()` on the result rather than inside the loader: thrown in there it would be
  // caught and answered with the previous visitor's album (§281).
  const read = await readWithLastGood(`album:${locale}:${slug}`, () =>
    findPublishedAlbumBySlug(getDb(), locale, slug),
  );
  const album = read.value;
  if (!album) notFound();

  const t = await getTranslations("Gallery");

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 2, sm: 3 } }}>
      <LastGoodNotice read={read} />

      <Typography variant="body2" sx={{ mb: 2 }}>
        <Link href="/gallery">{t("backToGallery")}</Link>
      </Typography>
      <Typography variant="h1" gutterBottom>
        {album.title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: album.description ? 1 : 3 }}>
        {formatDay(album.takenOn, { locale, timeZone: CLUB_TIME_ZONE, style: "long" })} · {t("photoCount", { count: album.photoCount })}
        {album.event && (
          <>
            {" · "}
            <Link href={{ pathname: "/events/[slug]", params: { slug: album.event.slug } }}>{album.event.title}</Link>
          </>
        )}
      </Typography>
      {album.description && (
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: "60rem" }}>
          {album.description}
        </Typography>
      )}

      <Box
        component="ul"
        sx={{
          listStyle: "none",
          m: 0,
          p: 0,
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(4, 1fr)" },
          gap: { xs: 1, sm: 1.5 },
        }}
      >
        {album.photos.map((photo, index) => (
          <Box component="li" key={photo.id} sx={riseIn(index)}>
            <a href={photo.webUrl} style={{ display: "block" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- our own WebP thumbnail, sized on upload */}
              <img
                src={photo.thumbUrl}
                alt={t("photoAlt", { n: photo.position, total: album.photoCount, title: album.title })}
                width={photo.width}
                height={photo.height}
                loading={index < 8 ? "eager" : "lazy"}
                decoding="async"
                style={{ display: "block", width: "100%", height: "auto", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 6 }}
              />
            </a>
          </Box>
        ))}
      </Box>

      {/* Under the photographs, where somebody recognises themselves (§323): how to have one taken down. */}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
        {t.rich("photosNotice", { contact: (chunks) => <ContactLink>{chunks}</ContactLink> })}
      </Typography>
    </Container>
  );
}
