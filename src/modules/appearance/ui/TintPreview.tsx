import Box from "@mui/material/Box";
import { COLOR } from "@/theme/brand";

export type TintPreviewWords = {
  /** The header strip's word — the site's name, as the header carries it. */
  header: string;
  /** The card's line. */
  card: string;
  /** A line of body text straight on the page colour. */
  text: string;
};

/**
 * A public page in miniature on a chosen page colour (§NNN, «Aspectul site-ului»): the header
 * strip on the header's white, a card on the card's white, and a line of body and muted text on
 * the tint itself — the three things the owner asked to see before the confirm.
 *
 * Drawn in the light scheme's own colours (`COLOR`) whatever scheme the backoffice is in, because
 * the tint applies to the light scheme only. No hooks and no `"use client"`: the Server Component
 * panel draws it for every preset, and the «Personalizat» island draws it live from the typed
 * colour. Strings only in its props (§370). Decorative for a screen reader — the option's name and
 * help say what it is.
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
