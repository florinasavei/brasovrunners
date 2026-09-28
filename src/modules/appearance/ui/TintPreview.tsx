import Box from "@mui/material/Box";
import { COLOR } from "@/theme/brand";

export type TintPreviewWords = {
  /** The header strip's word — the site's name, as the header carries it. */
  header: string;
  card: string;
  /** A line of body text straight on the page colour. */
  text: string;
};

/**
 * A public page in miniature on a page colour (§488): header, card, body and muted text. Always in
 * the light scheme's `COLOR`s, since the tint is light-only. No hooks, so both the server panel and
 * the client island draw it; string props only (§370). `aria-hidden`: the option's words name it.
 */
export default function TintPreview({ page, words }: { page: string; words: TintPreviewWords }) {
  return (
    <Box
      aria-hidden
      data-testid="tint-preview"
      sx={{
        width: 148,
        flexShrink: 0,
        borderRadius: 1,
        border: 1,
        borderColor: COLOR.line,
        bgcolor: page,
        overflow: "hidden",
        fontSize: 10,
        lineHeight: 1.3,
        color: COLOR.ink,
      }}
    >
      <Box sx={{ bgcolor: COLOR.surface, borderBottom: 1, borderColor: COLOR.line, px: 0.75, py: 0.4, display: "flex", alignItems: "center", gap: 0.5 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "2px", bgcolor: COLOR.blue, flexShrink: 0 }} />
        <Box component="span" sx={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {words.header}
        </Box>
      </Box>
      <Box sx={{ p: 0.75 }}>
        <Box sx={{ bgcolor: COLOR.surface, border: 1, borderColor: COLOR.line, borderRadius: "4px", px: 0.75, py: 0.5, mb: 0.5 }}>
          <Box component="span" sx={{ display: "block", fontWeight: 600, color: COLOR.blue }}>
            {words.card}
          </Box>
        </Box>
        <Box component="span" sx={{ display: "block" }}>
          {words.text}
        </Box>
        <Box component="span" sx={{ display: "block", color: COLOR.inkMuted }}>
          {words.text}
        </Box>
      </Box>
    </Box>
  );
}
