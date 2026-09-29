import Box from "@mui/material/Box";
import type { DifficultyTooltipBlock as Block } from "../domain/difficulty";

/**
 * The difficulty pill's tooltip, set as a small block rather than two runs of text (§NNN — the
 * owner, 2026-09-29 19:48: «vreau ca acest tooltip să fie formatat mai frumos», of «foarte / greu
 * 13–15» split wherever the bubble ended): the level in bold on the first line, «Mediu — nivelul 5
 * din 15», then the ladder, one band per row, the band's word on the left and its levels on the
 * right in one aligned column; the level's own band is bold, tinted and marked by a dot drawn in
 * CSS (no glyph of its own, §112). Nothing in it wraps: every line is `nowrap`, and the rows share
 * the width of the longest one, so «foarte greu» and «13–15» never part.
 *
 * The same words and facts as the string form (`difficultyWords(...).tooltip`), which the chip
 * still times its tap by; a screen reader hears neither, only the chip's `srLabel` (§528).
 * Rendered inside the client chip (`GlyphChip`), from plain data that crossed the boundary.
 */
export default function DifficultyTooltipBlock({ block }: { block: Block }) {
  return (
    <Box component="span" data-testid="difficulty-tooltip" sx={{ display: "grid", rowGap: 0.75, py: 0.25 }}>
      <Box component="span" data-part="head" sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
        {block.head}
      </Box>
      <Box component="span" data-part="ladder" sx={{ display: "grid", width: "max-content", rowGap: 0.25 }}>
        {block.rows.map((row) => (
          <Box
            component="span"
            key={row.word}
            data-part="row"
            {...(row.current ? { "data-current": "true" } : {})}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              columnGap: 2,
              px: 0.75,
              borderRadius: 0.5,
              whiteSpace: "nowrap",
              fontWeight: row.current ? 700 : 400,
              // The tooltip's own text colour, faint: no colour written here, in either theme.
              bgcolor: row.current ? "color-mix(in srgb, currentColor 18%, transparent)" : "transparent",
            }}
          >
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", columnGap: 0.75 }}>
              <Box
                component="span"
                aria-hidden="true"
                sx={{ width: "6px", height: "6px", borderRadius: "50%", bgcolor: row.current ? "currentColor" : "transparent", flexShrink: 0 }}
              />
              {row.word}
            </Box>
            <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {row.range}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
