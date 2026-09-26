import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { formatCalendarDay } from "@/i18n/dates";
import type { PublicAlbumSummary } from "@/modules/content/gallery/repository";
import { coverMagnification, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import CardLink from "@/shared/ui/CardLink";
import { fadeInSoft, liftOnHover, riseIn } from "@/theme/motion";

/**
 * The albums themselves, behind a `<Suspense>` boundary (§166).
 *
 * The query is started by the page and awaited here, so the shell is sent while the database
 * is still answering and the wait is a grid of covers rather than a blank page.
 */
export default async function AlbumGrid({ albums: pending }: { albums: Promise<PublicAlbumSummary[]> }) {
  const t = await getTranslations("Gallery");
  const locale = await getLocale();
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
                    {...coverWidths(album)}
                    alt=""
                    loading={index < 3 ? "eager" : "lazy"}
                    style={{ display: "block", width: "100%", aspectRatio: "4 / 3", objectFit: "cover" }}
                  />
                )}
                <CardContent>
                  <Typography variant="h2" sx={{ fontSize: "1.125rem", mb: 0.5 }}>
                    {album.title}
                  </Typography>
                  {/* An event's album names the event; a free album is named by its date alone (§NNN). */}
                  {album.eventTitle && (
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>
                      {album.eventTitle}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    {formatCalendarDay(album.takenOn, { locale, style: "long" })} · {t("photoCount", { count: album.photoCount })}
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

/**
 * The cover's `srcset` and `sizes` (§414), or neither. The cover is a card's width — a whole
 * phone below `sm` — so a cover stored with a ladder lets the browser choose among its widths
 * rather than enlarge the thumbnail. A cover from before has no ladder and keeps its thumbnail
 * alone: offered the 2400-pixel master beside it, a 390-pixel phone at 3× took the master for a
 * 1074-pixel card (measured by the re-review).
 */
function coverWidths(album: PublicAlbumSummary): { srcSet?: string; sizes?: string } {
  const srcSet = album.coverWebUrl ? pictureSrcSet(album.coverWebUrl, album.coverWidth) : undefined;
  if (!srcSet) return {};
  return { srcSet, sizes: pictureSizes("cover", 100, coverMagnification(album.coverWidth ?? 0, album.coverHeight ?? 0, 4 / 3)) };
}
