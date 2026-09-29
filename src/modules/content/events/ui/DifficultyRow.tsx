import Box from "@mui/material/Box";
import type { ReactNode } from "react";

/**
 * The difficulty row of «Ce fel de eveniment» (§526, centred §537): the band select with its «?»
 * and «Nivelul» (§NNN, «Treapta» before) with its «?», on one axis — the owner, 2026-09-28: «partea asta nu e centrată!».
 *
 * One grid: from `sm` the band and the step share the first row and the step's help line has a row
 * of its own under the step (the `help` area) — it never lifts the toggle. The cells align to the
 * row's top, not its centre: both visible outlines are 56 px from the cell's top edge (the select's
 * own, the toggle's through `STEP_FRAME`), so their centres meet, and the select's helper text after
 * a refused save grows the band cell downwards without moving the toggle off the select's axis. The
 * step column is as wide as the toggle (`max-content`); the help line takes that width and wraps
 * inside it (`width: 0; min-width: 100%`), so the band select keeps the rest. Below `sm` the three
 * stack, full width, in the same order. `DifficultyStepField` places its own parts in the `step` and
 * `help` areas (its root is `display: contents`). No directive: the create page and the editor
 * render it from the same `KindBox` (§406, one layout), a Server Component.
 */
export const DIFFICULTY_ROW_SX = {
  display: "grid",
  alignItems: "start",
  columnGap: 2,
  rowGap: 0.5,
  gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) max-content" },
  gridTemplateAreas: { xs: '"band" "step" "help"', sm: '"band step" ". help"' },
} as const;

export default function DifficultyRow({ band, step }: { band: ReactNode; step: ReactNode }) {
  return (
    <Box data-testid="difficulty-row" sx={DIFFICULTY_ROW_SX}>
      <Box sx={{ gridArea: "band", display: "flex", alignItems: "center", minWidth: 0 }}>{band}</Box>
      {step}
    </Box>
  );
}
