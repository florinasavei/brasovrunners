import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ImageAlignment, ImageWidthPercent } from "../domain/schema";
import { youtubeEmbedUrl } from "@/modules/events/domain/video";
import { env } from "@/shared/config/env";
import VideoFacade from "@/shared/ui/VideoFacade";
import { imageFigureSx } from "./image-layout";

/**
 * A YouTube film inside an editorial body (`DECISIONS.md` §110, §266, §403).
 *
 * ## It is a figure in the text, sized like a picture
 *
 * `widthPercent` and `align` are the picture's own two attributes, drawn by the same function —
 * `imageFigureSx` — so a film beside a paragraph behaves exactly as a photograph beside one.
 *
 * ## The poster is this site's own copy, and the player carries a volume bar
 *
 * `VideoFacade` — shared with the event page's own film — shows `poster`, the club's stored
 * copy of the thumbnail (`attrs.poster`, filled in by `attachYoutubePosters` at save time), so
 * nothing is fetched from Google until the reader presses play (§69, §110 still stand). The
 * editor's own thumbnail in the backoffice is a separate, organizer-facing request
 * (`i.ytimg.com`, §110) and unaffected by this: it shows an organizer their own footage while
 * placing it, before the poster the reader gets has necessarily been fetched and stored.
 */
export default async function RichTextVideo({
  videoId,
  caption,
  poster = null,
  widthPercent = 100,
  align = "block",
  floats = false,
}: {
  videoId: string;
  caption: string;
  /** This site's own stored copy of the film's thumbnail, or null while none has been fetched. */
  poster?: string | null;
  /** The share of the column, as a picture's (§266). */
  widthPercent?: ImageWidthPercent;
  align?: ImageAlignment;
  /** Whether this document floats anything anywhere; see `imageFigureSx`. */
  floats?: boolean;
}) {
  const t = await getTranslations("Event");
  const origin = new URL(env.APP_BASE_URL).origin;

  return (
    <Box component="figure" sx={imageFigureSx({ align, widthPercent }, floats)}>
      <VideoFacade
        embedSrc={youtubeEmbedUrl(videoId, origin)}
        posterUrl={poster}
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
