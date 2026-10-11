import Box from "@mui/material/Box";
import type { AccentShades } from "@/modules/appearance/domain/accent-shades";
import { COLOR, COLOR_DARK } from "@/theme/brand";

export type AccentPreviewWords = {
  /** The pill's word: the hero's «Vino cu noi». */
  button: string;
  /** The pale chip's word: a weekly run's tag. */
  tag: string;
};

/**
 * An accent in miniature (§723, «Culoarea de accent»): by day on the left and after dark on the right,
 * each on its own page colour — the pill «Vino cu noi» on `accentInk` with the words on its fill, the
 * weekly runs' chip on `accentTint` in `accentInk`, and a short rule in `accent` — the three places the
 * club will see the colour first. Every value is a shade of the accent or a `brand.ts` token.
 *
 * No hooks and no `"use client"`: the Server Component panel draws it for every preset, the design page
 * for the same presets, and the «Personalizat» island draws it live from the typed colour. Strings only
 * in its props (§370). Decorative for a screen reader — the option's name and help say what it is.
 */
export default function AccentPreview({ shades, words }: { shades: AccentShades; words: AccentPreviewWords }) {
  const schemes = [
    { key: "light", shade: shades.light, page: COLOR.paper, onFill: COLOR.surface },
    { key: "dark", shade: shades.dark, page: COLOR_DARK.paper, onFill: COLOR_DARK.paper },
  ] as const;
  return (
    <Box
      aria-hidden
      data-testid="accent-preview"
      sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", width: 168, flexShrink: 0, borderRadius: 1, border: 1, borderColor: COLOR.line, overflow: "hidden", fontSize: 10, lineHeight: 1.2 }}
    >
      {schemes.map(({ key, shade, page, onFill }) => (
        <Box key={key} data-scheme={key} sx={{ bgcolor: page, p: 0.75, display: "grid", gap: 0.5, justifyItems: "start", minWidth: 0 }}>
          <Box component="span" sx={{ display: "block", width: 24, height: 3, borderRadius: 2, bgcolor: shade.accent }} />
          <Box
            component="span"
            sx={{ display: "block", maxWidth: "100%", bgcolor: shade.accentInk, color: onFill, borderRadius: 999, px: 0.75, py: 0.25, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {words.button}
          </Box>
          <Box
            component="span"
            sx={{ display: "block", maxWidth: "100%", bgcolor: shade.accentTint, color: shade.accentInk, borderRadius: 999, px: 0.75, py: 0.25, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {words.tag}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
