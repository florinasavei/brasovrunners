"use client";

import Box from "@mui/material/Box";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import { DIFFICULTY_LEVELS } from "./difficulty-levels";

/** Material's own `FitnessCenterIcon` path (`@mui/icons-material/FitnessCenter`, on its own
 * 24-unit grid) — drawn `DIFFICULTY_LEVELS.length` times rather than the three hand-drawn bars
 * the fix round found running together (finding 1): the brief asked for Material's glyph, one
 * per level, not a bespoke dumbbell squeezed into a single 24-unit square. */
const FITNESS_CENTER_PATH =
  "M20.57 14.86 22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z";

/**
 * The difficulty as a scale of dumbbells (§399; the owner, 2026-09-25, of the phone-signal bars
 * §112 first chose: "I want also for the difficulty to have a better icon system, like weights or
 * something"). One glyph, one `<svg>` — like every other file here (`RoadIcon`), and what
 * `GlyphChip`'s own `.MuiChip-icon` styling and its test both expect of the element MUI clones —
 * but a *wide* one: `DIFFICULTY_LEVELS.length` full 24-unit copies of Material's own
 * `FitnessCenterIcon` path side by side in one `viewBox="0 0 72 24"`, each on its own untouched
 * 24-unit slot (the path itself only occupies roughly x=2..22 of its slot, so neighbouring
 * dumbbells sit with daylight between them rather than the three-bars-in-one-square the fix
 * round found reading as a single bar). `sx={{ width: "3em" }}` widens the chip's clone to three
 * icon-widths (≈16 px each at an 18 px chip icon) while `.MuiChip-icon`'s own height and margin,
 * written for one glyph, are untouched.
 *
 * The first `level` dumbbells are in the chip's own ink (`currentColor`, inherited — no colour
 * written here); the rest are at the theme's own "present but not the answer" fraction,
 * `theme.palette.action.disabledOpacity` (the same 0.38 MUI already gives a disabled control),
 * reached through `sx` on each faint dumbbell's `<g>` rather than a number written here, so
 * neither scheme needs a value of its own.
 *
 * The chip's clone width (`sx={{ width: … }}`) and `level`'s own type are both derived from
 * `DIFFICULTY_LEVELS.length` rather than written as `'3em'` and `1 | 2 | 3` — a fourth level
 * added to the closed set (`difficulty-levels.ts`) widens the icon and the type on its own, instead of the
 * viewBox growing while the width and the accepted levels stayed at three (fix round, finding 3).
 *
 * `aria-hidden` throughout, like every glyph in the registry (§112) — the pill's word and its
 * visually-hidden `srSuffix` (`route-pills.ts`, `GlyphChip`) are what a screen reader hears, never
 * the count of dumbbells.
 *
 * One component reading a `level` prop, not a factory per level: the registry's three
 * `difficulty:*` entries are mapped over `DIFFICULTY_LEVELS` in `difficulty-glyphs.ts`, a module
 * with no `"use client"` of its own, so a Server Component (`EventFacts`) can read one by name —
 * a record or a per-level export from *this* client module would reach the server as a client
 * reference it cannot dot into.
 */

/** One icon-width (`1em`) per level in the closed set, so the chip's clone widens automatically
 * when `DIFFICULTY_LEVELS` grows (fix round, finding 3). */
const SCALE_WIDTH = `${DIFFICULTY_LEVELS.length}em`;

/** The closed set's own level, 1-based — `number`, not a hand-written `1 | 2 | 3`, so a fourth
 * level added to `DIFFICULTY_LEVELS` needs no matching edit here; the runtime check is what keeps
 * a caller inside the set. */
export default function DifficultyScaleIcon({ level, ...props }: SvgIconProps & { level: number }) {
  if (level < 1 || level > DIFFICULTY_LEVELS.length) throw new RangeError(`DifficultyScaleIcon: level ${level} is outside 1..${DIFFICULTY_LEVELS.length}`);
  return (
    <SvgIcon
      {...props}
      viewBox={`0 0 ${DIFFICULTY_LEVELS.length * 24} 24`}
      sx={[{ width: SCALE_WIDTH }, ...(Array.isArray(props.sx) ? props.sx : [props.sx])]}
    >
      {DIFFICULTY_LEVELS.map((name, index) => {
        const on = index < level;
        return (
          <Box
            key={name}
            component="g"
            transform={`translate(${index * 24} 0)`}
            data-testid={on ? "difficulty-dumbbell-on" : "difficulty-dumbbell-off"}
            sx={on ? undefined : { opacity: (theme) => theme.palette.action.disabledOpacity }}
          >
            <path d={FITNESS_CENTER_PATH} fill="currentColor" />
          </Box>
        );
      })}
    </SvgIcon>
  );
}
