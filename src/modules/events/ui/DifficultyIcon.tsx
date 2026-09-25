"use client";

import Box from "@mui/material/Box";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

/** The closed set's own size (`EASY` | `MODERATE` | `HARD`, migration `0018`) — three levels, so three dumbbells. */
const LEVELS = 3;

/** One dumbbell — two plates and a bar, on the 24-unit grid every glyph here shares (`RoadIcon`) — at
 * the slot `index` of `LEVELS`, so three sit edge to edge across the square with no gap either side. */
function Dumbbell({ index }: { index: number }) {
  const cx = 4 + index * 8;
  return (
    <>
      <rect x={cx - 4} y={8} width={2} height={8} rx={1} fill="currentColor" />
      <rect x={cx - 2} y={10.5} width={4} height={3} rx={1} fill="currentColor" />
      <rect x={cx + 2} y={8} width={2} height={8} rx={1} fill="currentColor" />
    </>
  );
}

/**
 * The difficulty as a scale of dumbbells (§NNN; the owner, 2026-09-25, of the phone-signal bars
 * §112 first chose: "I want also for the difficulty to have a better icon system, like weights or
 * something"). One glyph, one `<svg>` — like every other file here (`RoadIcon`), and what
 * `GlyphChip`'s own `.MuiChip-icon` styling and its test both expect of the element MUI clones —
 * drawing all `LEVELS` dumbbells on the closed set's own 24-unit grid: the first `level` in the
 * chip's own ink (`currentColor`, inherited — no colour written here), the rest at the theme's own
 * "present but not the answer" fraction, `theme.palette.action.disabledOpacity` (the same 0.38 MUI
 * already gives a disabled control), reached through `sx` on each faint dumbbell's `<g>` rather
 * than a number written here, so neither scheme needs a value of its own. `Material`'s own
 * `FitnessCenterIcon` is registered bare, as `GLYPHS.difficulty`, for a caller that wants the
 * concept rather than one value's own level; this file draws its own dumbbell rather than
 * repeating that icon three times, because MUI's `Chip` clones its `icon` prop expecting one
 * `<svg>`, and `.MuiChip-icon`'s own sizing and margin are written for exactly one.
 *
 * `aria-hidden` throughout, like every glyph in the registry (§112) — the word beside it, not the
 * count of dumbbells, is what a screen reader hears; `GlyphChip`'s accessible name stays the
 * pill's word regardless of how many dumbbells are drawn.
 *
 * A factory, not one component reading a `level` prop: the registry's `Glyph` type
 * (`ComponentType<SvgIconProps>`) is what `GlyphChip`, `GlyphSelect` and `CalendarEventChip`
 * already call — with no prop of their own beyond `sx` and `aria-hidden`, the same shape `RoadIcon`
 * satisfies — so `EASY_DIFFICULTY_ICON` / `MODERATE_DIFFICULTY_ICON` / `HARD_DIFFICULTY_ICON`
 * (below) sit in `DIFFICULTY_GLYPH` (`glyphs.ts`) exactly where the three bar icons stood, and
 * every surface that already reads a glyph by name — the event page's pill, the listing card's,
 * the backoffice's (§388), the hero's `withGlyph`, `GlyphSelect`'s option — draws the scale with
 * no change of its own.
 */
function difficultyScale(level: 1 | 2 | 3) {
  function DifficultyScale(props: SvgIconProps) {
    return (
      <SvgIcon {...props} viewBox="0 0 24 24">
        {Array.from({ length: LEVELS }, (_, index) => {
          const on = index < level;
          return (
            <Box
              key={index}
              component="g"
              data-testid={on ? "difficulty-dumbbell-on" : "difficulty-dumbbell-off"}
              sx={on ? undefined : { opacity: (theme) => theme.palette.action.disabledOpacity }}
            >
              <Dumbbell index={index} />
            </Box>
          );
        })}
      </SvgIcon>
    );
  }
  return DifficultyScale;
}

export const EASY_DIFFICULTY_ICON = difficultyScale(1);
export const MODERATE_DIFFICULTY_ICON = difficultyScale(2);
export const HARD_DIFFICULTY_ICON = difficultyScale(3);
