import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { youtubeEmbedUrl, youtubeVideoId } from "@/modules/events/domain/video";
import { DENSITY } from "@/theme/density";

/**
 * Last year's film on the event page (BR-REQ-011-01 criterion 9), behind one press.
 *
 * A native `<details>`: closed, it is a line of text and the browser has fetched nothing from
 * YouTube — the iframe inside is `loading="lazy"`, which a closed disclosure keeps out of the
 * viewport, so no request, no cookie, no script until the visitor opens it. Open, it is the
 * player. No client island, no thumbnail from Google's image host either (that would be a
 * request on load, which is the thing being avoided). `DECISIONS.md` §69 has the reasoning
 * against the alternatives; the privacy notice describes YouTube as "loaded when you press".
 */
export default async function EventVideo({ videoUrl }: { videoUrl: string | null }) {
  const id = youtubeVideoId(videoUrl);
  if (!id) return null;
  const t = await getTranslations("Event");

  return (
    <Box
      component="details"
      sx={{
        mt: { xs: DENSITY.sectionGap, sm: 3 },
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        "& > summary": {
          cursor: "pointer",
          listStyle: "none",
          px: 2,
          minHeight: 48,
          display: "flex",
          alignItems: "center",
          gap: 1,
          fontWeight: 500,
          "&::-webkit-details-marker": { display: "none" },
        },
        "&[open] > summary": { borderBottom: 1, borderColor: "divider" },
      }}
    >
      <Typography component="summary" variant="body1">
        <Box component="span" aria-hidden sx={{ fontSize: "1.25rem", lineHeight: 1 }}>
          ▶
        </Box>
        {t("video.open")}
      </Typography>
      <Box sx={{ position: "relative", aspectRatio: "16 / 9", bgcolor: "common.black" }}>
        <Box
          component="iframe"
          src={youtubeEmbedUrl(id)}
          title={t("video.title")}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, py: 1 }}>
        {t("video.notice")}
      </Typography>
    </Box>
  );
}
