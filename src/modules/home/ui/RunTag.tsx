import Box from "@mui/material/Box";
import type { CoverTag } from "@/modules/events/domain/event-kind";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import { COLOR, COLOR_DARK } from "@/theme/brand";

/** The tag's words and glyph: the kind (`coverTag`, §709) with its word already translated. */
export type RunTagProps = { kind: CoverTag["kind"]; glyph: CoverTag["glyph"]; label: string };

/**
 * The kind's colours (the plan's visual system, phase 1's tokens, §708): a weekly run in the pale pink
 * with the pink that carries words, a special event in its green — both pairs held at AA by
 * `LOOK_PAIRS` and `LOOK_PAIRS_DARK`, light and dark. Tokens from `brand.ts`, never a literal.
 */
const KIND_SX = {
  weekly: { bgcolor: COLOR.accentTint, color: COLOR.accentInk, "[data-dark] &": { bgcolor: COLOR_DARK.accentTint, color: COLOR_DARK.accentInk } },
  special: { bgcolor: COLOR.kindSpecial, color: COLOR.kindSpecialInk, "[data-dark] &": { bgcolor: COLOR_DARK.kindSpecial, color: COLOR_DARK.kindSpecialInk } },
} as const;

/**
 * The photo tag (the plan's «tag pill» on a card's photo; the data is phase 2's `coverTag`, §709): the
 * kind in a word beside its glyph — the repeat arrows for a weekly run, the type's own glyph for a
 * special event — over the picture's top corner. State is never told by colour alone: the word is
 * always there. A Server Component; the glyph is drawn here by its registry name (§370).
 */
export default function RunTag({ kind, glyph, label, overPicture = true }: RunTagProps & { overPicture?: boolean }) {
  const Glyph = GLYPHS[glyph];
  return (
    <Box
      component="span"
      data-testid="run-tag"
      data-kind={kind}
      sx={{
        ...(overPicture ? { position: "absolute", top: 8, left: 8, zIndex: 1 } : {}),
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        height: 26,
        px: 1,
        borderRadius: 999,
        fontSize: "0.8125rem",
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...KIND_SX[kind],
      }}
    >
      <Glyph aria-hidden="true" sx={{ fontSize: 16 }} />
      {label}
    </Box>
  );
}
