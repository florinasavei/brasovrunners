import Box from "@mui/material/Box";
import type { CoverTag } from "@/modules/events/domain/event-kind";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import { COLOR, COLOR_DARK } from "@/theme/brand";
import { LOOK_ACCENT_TINT, LOOK_PREVIEW_DARK, LOOK_ROOT_DARK, UNDER_LOOK } from "@/theme/look";

/** The tag's words and glyph: the kind (`coverTag`, §709) with its word already translated. */
export type RunTagProps = { kind: CoverTag["kind"]; glyph: CoverTag["glyph"]; label: string };

/**
 * The kind's colours (the plan's visual system, phase 1's tokens, §708) belong to «Aspectul nou»: a
 * weekly run in the accent's pale band with the accent that carries words — the club's accent (§NNN),
 * through the layout's variables, so the same rule serves both schemes and every accent, each pair held
 * at AA by `tests/unit/appearance/look-accent.test.ts` — and a special event in its green, held by
 * `LOOK_PAIRS` and `LOOK_PAIRS_DARK`. Tokens from `brand.ts`, never a literal, written under the look's
 * scope (`theme/look.ts`); with the look off the pill is today's neutral, the theme's own selected tint
 * and text, so the page keeps today's palette.
 */
const underLook = (light: { bg: string; ink: string }, dark: { bg: string; ink: string }) => ({
  bgcolor: "action.selected",
  color: "text.primary",
  [UNDER_LOOK]: { bgcolor: light.bg, color: light.ink },
  [`${LOOK_ROOT_DARK} &, ${LOOK_PREVIEW_DARK} &`]: { bgcolor: dark.bg, color: dark.ink },
});

const KIND_SX = {
  weekly: underLook({ bg: LOOK_ACCENT_TINT, ink: "primary.main" }, { bg: LOOK_ACCENT_TINT, ink: "primary.main" }),
  special: underLook({ bg: COLOR.kindSpecial, ink: COLOR.kindSpecialInk }, { bg: COLOR_DARK.kindSpecial, ink: COLOR_DARK.kindSpecialInk }),
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
