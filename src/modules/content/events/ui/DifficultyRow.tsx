import Box from "@mui/material/Box";
import type { ReactNode } from "react";

/**
 * The difficulty row of «Ce fel de eveniment» (§526, centred §NNN): the band select with its «?»
 * and «Treapta» with its «?», on one axis — the owner, 2026-09-28: «partea asta nu e centrată!».
 *
 * One grid, `align-items: center`: from `sm` the band and the step share the first row, so the two
 * outlines sit on the same line whatever their heights, and the step's help line has a row of its
 * own under the step (the `help` area) — it never lifts the toggle. Below `sm` the three stack, full
 * width, in the same order. `DifficultyStepField` places its own parts in the `step` and `help`
 * areas (its root is `display: contents`). No directive: the create page and the editor render it
 * from the same `KindBox` (§406, one layout), a Server Component.
 */
export const DIFFICULTY_ROW_SX = {
  display: "grid",
  alignItems: "center",
  columnGap: 2,
  rowGap: 0.5,
  gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" },
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
