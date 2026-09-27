import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import Box from "@mui/material/Box";
import { useId } from "react";
import VideoVolumeBar from "./VideoVolumeBar";

/**
 * A YouTube film: the club's own poster before the click, the player and a volume bar after it
 * (`DECISIONS.md` §403). Drawn by `RichTextVideo`: a film is a figure in an editorial body, its
 * one home since §NNN retired the event page's own film section (`EventVideo`).
 *
 * ## A Server Component (found by re-review, `DECISIONS.md` §403)
 *
 * The whole disclosure — the poster, the play control and the iframe — is a native
 * `<details>`/`<summary>`, rendered here on the server. **This is why the play control works
 * with no JavaScript at all**: a `<summary>` opens its `<details>` on a plain click, no script
 * required, and every evergreen browser gives a *closed* `<details>`'s contents
 * `content-visibility: hidden` — the iframe's `src` is real from the first paint, but nothing
 * inside a closed disclosure is fetched until it opens, so §69/§110's "no request to a third
 * party before the click" holds exactly as it did when the facade was a line of text. Only the
 * volume bar — talking to the open player over `postMessage` — genuinely needs a script, so it
 * alone is `VideoVolumeBar`, a client island that mounts on nothing more than the iframe's `id`
 * (`frameId`, a plain string; never an element or a ref crosses the server/client boundary) and
 * renders nothing until its `<details>` ancestor is actually open.
 *
 * ## The poster button
 *
 * Styled to show `posterUrl`, this site's own stored copy of YouTube's thumbnail
 * (`modules/media/video-poster.ts`), as a real `<img>` — never a CSS background: an unescaped
 * background-image would be a CSS-injection seam, and a background carries no text alternative
 * for a screen reader. With no poster stored yet it falls back to the dark rectangle §69 always
 * showed.
 */

export type VideoFacadeLabels = {
  /** The play control's accessible name — pass the caption or the event's own title. */
  play: string;
  mute: string;
  unmute: string;
  volume: string;
};

const PLAY_BUTTON_SIZE = 44;

export default function VideoFacade({
  embedSrc,
  posterUrl,
  posterSrcSet,
  posterSizes,
  posterFrame,
  title,
  labels,
}: {
  /** Built server-side (`youtubeEmbedUrl`): the nocookie embed, `enablejsapi=1` and this site's origin. */
  embedSrc: string;
  /** This site's own stored copy of the thumbnail, or `null` for the plain dark facade. */
  posterUrl: string | null;
  /**
   * A club poster's stored widths and how wide the facade is drawn (§414, `media/ladder.ts`),
   * so a phone takes a rung rather than the master; absent for YouTube's own thumbnail, which is
   * one small file. Plain strings, computed by the caller.
   */
  posterSrcSet?: string;
  posterSizes?: string;
  /**
   * The part of the poster the club chose (§NNN), as the window arithmetic the caller computed:
   * the poster drawn `width` wide and pulled to `left` / `top` inside the 16∶9 box. Absent, the
   * poster covers the box, centred, as it always has. Plain strings, never an element.
   */
  posterFrame?: { width: string; left: string; top: string };
  /** The iframe's accessible title, and the poster image's `alt` (found by re-review: an empty
   *  `alt` left the poster with no text alternative at all). */
  title: string;
  labels: VideoFacadeLabels;
}) {
  const frameId = useId();

  return (
    <Box>
      <Box
        component="details"
        sx={{
          "& summary::-webkit-details-marker": { display: "none" },
          // Open, the film takes the poster's place rather than sitting under it: one 16∶9 box,
          // never the poster and the player stacked (`DECISIONS.md` §403).
          "&[open] > summary": { display: "none" },
        }}
      >
        <Box
          component="summary"
          role="button"
          aria-label={labels.play}
          sx={{
            display: "block",
            listStyle: "none",
            cursor: "pointer",
            "&::marker": { content: '""' },
          }}
        >
          <Box
            sx={{
              position: "relative",
              aspectRatio: "16 / 9",
              bgcolor: "common.black",
              borderRadius: 1,
              overflow: "hidden",
            }}
          >
            {posterUrl && (
              <Box
                component="img"
                src={posterUrl}
                srcSet={posterSrcSet}
                sizes={posterSizes}
                alt={title}
                loading="lazy"
                sx={
                  posterFrame
                    ? {
                        position: "absolute",
                        display: "block",
                        width: posterFrame.width,
                        height: "auto",
                        maxWidth: "none",
                        left: posterFrame.left,
                        top: posterFrame.top,
                      }
                    : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }
                }
              />
            )}
            <Box
              aria-hidden
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Box
                sx={{
                  width: PLAY_BUTTON_SIZE,
                  height: PLAY_BUTTON_SIZE,
                  borderRadius: "50%",
                  bgcolor: "rgba(0,0,0,0.65)",
                  color: "common.white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <PlayArrowIcon fontSize="medium" />
              </Box>
            </Box>
          </Box>
        </Box>
        <Box sx={{ position: "relative", aspectRatio: "16 / 9", bgcolor: "common.black", borderRadius: 1, overflow: "hidden" }}>
          <Box
            component="iframe"
            id={frameId}
            src={embedSrc}
            title={title}
            loading="lazy"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        </Box>
      </Box>
      <VideoVolumeBar frameId={frameId} labels={{ mute: labels.mute, unmute: labels.unmute, volume: labels.volume }} />
    </Box>
  );
}
