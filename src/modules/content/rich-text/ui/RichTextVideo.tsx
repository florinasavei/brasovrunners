import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { youtubeEmbedUrl } from "@/modules/events/domain/video";

/**
 * A YouTube film inside an editorial body (`DECISIONS.md` §110), rendered exactly as the
 * event page's own film is (`EventVideo`, §69): a native `<details>`, closed, so the page has
 * fetched nothing from YouTube until the reader presses — the iframe is `loading="lazy"`
 * inside a closed disclosure. The id was validated by the schema; the address is built here
 * from it, on the no-cookie host, and never read from the document.
 */
export default async function RichTextVideo({ videoId, caption }: { videoId: string; caption: string }) {
  const t = await getTranslations("Event");
  return (
    <Box component="figure" sx={{ m: 0, my: 2 }}>
      <Box
        component="details"
        sx={{
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
          {caption || t("video.open")}
        </Typography>
        <Box sx={{ position: "relative", aspectRatio: "16 / 9", bgcolor: "common.black" }}>
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
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, py: 1 }}>
          {t("video.notice")}
        </Typography>
      </Box>
      {caption !== "" && (
        <Typography component="figcaption" variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: "center" }}>
          {caption}
        </Typography>
      )}
    </Box>
  );
}
