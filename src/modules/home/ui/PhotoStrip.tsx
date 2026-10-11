import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import ArrowButtonLink from "@/shared/ui/ArrowButtonLink";
import type { ClubSocialLink } from "@/shared/ui/club-socials";
import MountainMark from "@/shared/ui/MountainMark";
import SocialIcon from "@/shared/ui/SocialIcon";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { pickText } from "../domain/home-text";
import { STRIP_WIDE_COUNT, type StripContent } from "../domain/photo-strip";
import type { StripPicture } from "../strip-pictures";
import { HOME_HEADING_SX, HOME_RADIUS_PX } from "./home-surfaces";

export type PhotoStripProps = {
  /** The heading the club typed, or the platform's. */
  content: Pick<StripContent, "title">;
  /** The chosen pictures, in the club's order, built by `strip-pictures.ts`. None, and nothing is drawn. */
  pictures: readonly StripPicture[];
  /** The club's Instagram from the footer's one list (`clubSocialLinks`, §565), or null when it is not set. */
  instagram: ClubSocialLink | null;
  locale: Locale;
  /**
   * The design page's sample only: this many empty tiles where pictures would stand, since the page
   * has no club photo to show (decision 6) and the repository is public. A page never passes it: an
   * unset strip is not drawn.
   */
  emptySlots?: number;
};

/** The gap between tiles, in pixels: `ladder.ts`'s `strip` column is measured with it. */
const GAP_PX = 12;

/**
 * The photo strip (§714; `docs/REDESIGN.md`, decisions 6 and 7): the club's own pictures in a row
 * that scrolls sideways under the thumb — CSS scroll snap, no script, no island — six to the row on a
 * laptop, two and a half on a tablet, one and a bit on a phone, so the next one peeks in and says
 * «there is more». Then the gallery's door and the club's Instagram as a plain link: a link, never a
 * feed or an embed (AGENTS.md §18.3).
 *
 * Square tiles at the plan's 16-pixel radius; each a plain `img` with the ladder's `srcset` and
 * `sizes` (§414, §601), lazy and decoded off the main thread, never the page's largest paint (only
 * the hero is eager). The row is a named region a keyboard can reach and scroll (`tabIndex`), and
 * the page never scrolls sideways at 320 pixels: the row scrolls inside itself.
 *
 * No picture, no section (phase 3: «an unset strip is not drawn»): returns null.
 */
export default async function PhotoStrip({ content, pictures, instagram, locale, emptySlots = 0 }: PhotoStripProps) {
  if (pictures.length === 0 && emptySlots <= 0) return null;
  const t = await getTranslations("HomeSections");

  return (
    <Box component="section" aria-labelledby="home-strip-title" data-testid="home-strip" sx={{ py: { xs: 4, md: 6 } }}>
      <Typography variant="h2" id="home-strip-title" sx={{ ...HOME_HEADING_SX, mb: 2 }}>
        {pickText(content.title, locale) ?? t("strip.title")}
      </Typography>

      <Box
        role="region"
        aria-label={t("strip.region")}
        tabIndex={0}
        sx={{
          overflowX: "auto",
          overscrollBehaviorX: "contain",
          scrollSnapType: "x mandatory",
          scrollbarWidth: "thin",
          pb: 1,
          borderRadius: `${HOME_RADIUS_PX}px`,
          "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
        }}
      >
        <Box
          component="ul"
          sx={{
            listStyle: "none",
            m: 0,
            p: 0,
            display: "grid",
            gridAutoFlow: "column",
            gap: `${GAP_PX}px`,
            gridAutoColumns: { xs: "72%", sm: "40%", md: `calc((100% - ${(STRIP_WIDE_COUNT - 1) * GAP_PX}px) / ${STRIP_WIDE_COUNT})` },
          }}
        >
          {pictures.map((picture) => (
            <Box component="li" key={picture.id} sx={{ scrollSnapAlign: "start", minWidth: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- our own WebP from the gallery, with the ladder's srcset */}
              <img
                src={picture.src}
                srcSet={picture.srcSet}
                sizes={picture.sizes}
                alt={picture.alt}
                width={picture.width}
                height={picture.height}
                loading="lazy"
                decoding="async"
                style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: HOME_RADIUS_PX }}
              />
            </Box>
          ))}
          {Array.from({ length: pictures.length === 0 ? emptySlots : 0 }, (_, index) => (
            <Box
              component="li"
              key={`empty-${index}`}
              data-testid="home-strip-empty"
              aria-label={t("strip.emptySlot")}
              sx={{
                scrollSnapAlign: "start",
                minWidth: 0,
                aspectRatio: "1 / 1",
                borderRadius: `${HOME_RADIUS_PX}px`,
                border: 1,
                borderStyle: "dashed",
                borderColor: "divider",
                bgcolor: "action.hover",
                color: "text.disabled",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MountainMark width={64} />
            </Box>
          ))}
        </Box>
      </Box>

      <Box sx={{ mt: 2, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
        <ArrowButtonLink href="/gallery" label={t("strip.gallery")} variant="outlined" data-testid="home-strip-gallery" />
        {instagram && (
          <MuiLink
            href={instagram.href}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            data-testid="home-strip-instagram"
            sx={{ ...TAP_TARGET, display: "inline-flex", alignItems: "center", gap: 1, fontWeight: 600, color: "text.primary" }}
          >
            <SocialIcon network="instagram" size={22} />
            {t("strip.instagram")}
          </MuiLink>
        )}
      </Box>
    </Box>
  );
}
