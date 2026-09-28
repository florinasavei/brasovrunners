import Box from "@mui/material/Box";
import type { ReactNode } from "react";

/**
 * The difficulty row of «Ce fel de eveniment» (§526, §537): the band select and «Treapta» on one
 * axis. The cells align to the top, not the centre: both outlines sit 56 px below the cell's top
 * (the toggle's through `STEP_FRAME`), so a helper text under the select after a refusal grows
 * downwards without moving the toggle. The help line wraps within the step column
 * (`width: 0; min-width: 100%`). Below `sm` the three stack. `DifficultyStepField` places its
 * parts in the `step` and `help` areas (`display: contents`).
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
