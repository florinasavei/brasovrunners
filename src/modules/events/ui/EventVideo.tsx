import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { youtubeEmbedUrl, youtubeVideoId } from "@/modules/events/domain/video";
import { env } from "@/shared/config/env";
import { DENSITY } from "@/theme/density";
import VideoFacade from "@/shared/ui/VideoFacade";

/**
 * Last year's film on the event page (BR-REQ-011-01 criterion 9), smarter since `DECISIONS.md`
 * §403: a real poster before the click, mute and a volume bar after it — `VideoFacade`, shared
 * with the editorial body's own film (`RichTextVideo`).
 *
 * `posterUrl` is this site's own stored copy of the thumbnail (`videoPosterUrl`, fetched once
 * at save time by `modules/media/video-poster.ts`), never a request to YouTube's image host —
 * that keeps §69's rule, "no request, no cookie, no script until the visitor opens it", exactly
 * as true as it was when the facade was a line of text. Null while no poster has been stored
 * (a fetch that has not run yet, or has failed for this video) falls back to the plain dark
 * rectangle §69 always showed.
 */
export default async function EventVideo({
  videoUrl,
  posterUrl,
  eventTitle,
}: {
  videoUrl: string | null;
  posterUrl: string | null;
  /** Read into the play button's accessible name (§403, found by re-review): several films on
   *  one page used to share the one generic "Play the film" label. */
  eventTitle?: string;
}) {
  const id = youtubeVideoId(videoUrl);
  if (!id) return null;
  const t = await getTranslations("Event");
  const origin = new URL(env.APP_BASE_URL).origin;

  return (
    <Box
      sx={{
        mt: { xs: DENSITY.sectionGap, sm: 3 },
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      <VideoFacade
        embedSrc={youtubeEmbedUrl(id, origin)}
        posterUrl={posterUrl}
        title={t("video.title")}
        labels={{
          play: eventTitle ? t("video.playNamed", { name: eventTitle }) : t("video.play"),
          mute: t("video.mute"),
          unmute: t("video.unmute"),
          volume: t("video.volume"),
        }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, py: 1 }}>
        {t("video.notice")}
      </Typography>
    </Box>
  );
}
