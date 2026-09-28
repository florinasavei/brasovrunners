import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ImageAlignment, ImageCrop, ImageWidthPercent } from "../domain/schema";
import { youtubeEmbedUrl } from "@/modules/events/domain/video";
import { coverMagnification, type PictureColumn, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { env } from "@/shared/config/env";
import VideoFacade from "@/shared/ui/VideoFacade";
import { cardFrameGeometry, imageFigureSx } from "./image-layout";

/**
 * A YouTube film in a rich text (§110, §266, §403, §481), sized and aligned like a picture
 * through `imageFigureSx`. The poster is the club's stored copy (`attachYoutubePosters` at save),
 * so nothing is fetched from Google until the reader presses play (§69, §110).
 */
export default async function RichTextVideo({
  videoId,
  caption,
  poster = null,
  posterWidth = null,
  posterHeight = null,
  posterCrop = null,
  pictures = "page",
  widthPercent = 100,
  align = "block",
  floats = false,
}: {
  videoId: string;
  caption: string;
  /** The stored thumbnail copy, or null while none has been fetched. */
  poster?: string | null;
  /** With the stored size, the poster is drawn from its ladder (§414). */
  posterWidth?: number | null;
  posterHeight?: number | null;
  /** The club's crop for the 16∶9 box (§485), as §241's fractions. */
  posterCrop?: ImageCrop | null;
  pictures?: PictureColumn;
  /** Share of the column, as a picture's (§266). */
  widthPercent?: ImageWidthPercent;
  align?: ImageAlignment;
  /** Whether this document floats anything anywhere; see `imageFigureSx`. */
  floats?: boolean;
}) {
  const t = await getTranslations("Event");
  const origin = new URL(env.APP_BASE_URL).origin;
  /*
    A poster from §414 on has a ladder; YouTube's own thumbnail (`yt-<id>`) and older posters keep
    one `src`. The poster covers a 16∶9 box, so a wider poster is drawn wider than the box.
  */
  const posterSrcSet = poster ? pictureSrcSet(poster, posterWidth) : undefined;
  // The card's frame arithmetic, since the film's box is the card's shape (§485); without a crop
  // or a size, the poster covers the box, centred.
  const framed = poster && posterCrop ? cardFrameGeometry({ crop: posterCrop, width: posterWidth, height: posterHeight }) : null;
  const posterSizes = posterSrcSet
    ? pictureSizes(
        pictures,
        pictures === "card" ? 100 : widthPercent,
        framed ? framed.magnify : coverMagnification(posterWidth ?? 0, posterHeight ?? 0, 16 / 9),
      )
    : undefined;

  return (
    <Box component="figure" sx={imageFigureSx({ align, widthPercent }, floats)}>
      <VideoFacade
        embedSrc={youtubeEmbedUrl(videoId, origin)}
        posterUrl={poster}
        posterSrcSet={posterSrcSet}
        posterSizes={posterSizes}
        posterFrame={framed ? { width: framed.geometry.width, left: framed.geometry.left, top: framed.geometry.top } : undefined}
        title={caption || t("video.title")}
        labels={{
          play: caption ? t("video.playNamed", { name: caption }) : t("video.play"),
          mute: t("video.mute"),
          unmute: t("video.unmute"),
          volume: t("video.volume"),
        }}
      />
      <Typography
        component="figcaption"
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 0.5, textAlign: "center" }}
      >
        {caption !== "" ? `${caption} · ${t("video.notice")}` : t("video.notice")}
      </Typography>
    </Box>
  );
}
