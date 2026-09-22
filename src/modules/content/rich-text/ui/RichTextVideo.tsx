import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ImageAlignment, ImageWidthPercent } from "../domain/schema";
import { youtubeEmbedUrl } from "@/modules/events/domain/video";
import { imageFigureSx } from "./image-layout";

/**
 * A YouTube film inside an editorial body (`DECISIONS.md` §110, §266).
 *
 * ## It is a figure in the text, sized like a picture
 *
 * The owner: "that YouTube video must be embedded and resizable, not as a separate section". It
 * was a full-width bordered disclosure — a band across the column with a play line on it —
 * whatever the organizer wanted, because it had no width to choose. It is a `<figure>` now,
 * taking its share of the column and its side from `imageFigureSx`, the *same* function a
 * photograph uses: one description of "how big and where", so a film beside a paragraph behaves
 * exactly as a picture beside one does, down to becoming a full-width band below `sm`.
 *
 * ## Nothing is fetched from Google until the reader presses, and that has not changed
 *
 * §69's reasoning stands and the privacy notice states it ("YouTube, loaded when you press"), so
 * the player is still a native `<details>` and the iframe still `loading="lazy"` inside it: a
 * closed disclosure keeps it out of the viewport, so there is no request, no cookie and no
 * script on load. What changed is that the summary **is** the player's own frame rather than a
 * line of chrome above one: a 16:9 rectangle in the event's own ink with a ▶ in the middle, the
 * same box the iframe then fills. Opening it swaps the facade for the film in place — the
 * summary is hidden when open — so the page does not jump and the film sits exactly where the
 * poster sat.
 *
 * No thumbnail from `i.ytimg.com`, which would be the request this whole shape exists to avoid.
 * The editor shows one, because there the request is the organizer's own doing (§110).
 *
 * The notice under the frame is a caption, not a panel: it says what pressing will load, which
 * is what the privacy notice promises the reader is told.
 */
export default async function RichTextVideo({
  videoId,
  caption,
  widthPercent = 100,
  align = "block",
  floats = false,
}: {
  videoId: string;
  caption: string;
  /** The share of the column, as a picture's (§266). */
  widthPercent?: ImageWidthPercent;
  align?: ImageAlignment;
  /** Whether this document floats anything anywhere; see `imageFigureSx`. */
  floats?: boolean;
}) {
  const t = await getTranslations("Event");

  return (
    <Box component="figure" sx={imageFigureSx({ align, widthPercent }, floats)}>
      <Box
        component="details"
        sx={{
          // The frame is the film's, so the disclosure carries no border of its own.
          "& > summary": {
            cursor: "pointer",
            listStyle: "none",
            display: "block",
            position: "relative",
            aspectRatio: "16 / 9",
            borderRadius: 1,
            overflow: "hidden",
            bgcolor: "common.black",
            "&::-webkit-details-marker": { display: "none" },
          },
          // Open, the film takes the poster's place rather than appearing under it.
          "&[open] > summary": { display: "none" },
        }}
      >
        <Box component="summary" aria-label={caption || t("video.open")}>
          {/* A play mark on the ink, drawn here — no image, no third host. */}
          <Box
            component="span"
            aria-hidden
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "common.white",
              fontSize: "3rem",
              lineHeight: 1,
              textShadow: "0 0 12px rgba(0,0,0,0.6)",
            }}
          >
            ▶
          </Box>
        </Box>
        <Box sx={{ position: "relative", aspectRatio: "16 / 9", borderRadius: 1, overflow: "hidden", bgcolor: "common.black" }}>
          <Box
            component="iframe"
            src={youtubeEmbedUrl(videoId)}
            title={caption || t("video.title")}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        </Box>
      </Box>
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
