import Box from "@mui/material/Box";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import { DURATION_HOURS_CONSTRAINTS, DURATION_MINUTES_CONSTRAINTS } from "../duration";

/**
 * «Ore» and «Minute», the two boxes a length of time is typed in (§433): the race's «Timp limită» in
 * «Când și unde» and each checkpoint's in «Puncte de control» (§770) are this one component, so the two
 * say the same thing in the same words and refuse the same typing — a whole number of hours up to a
 * week's worth, minutes up to 59 (`duration.ts`). A Server Component: both boxes are the house's
 * `RecallField`, which keeps what a refused save typed and — drawn inside a detached form (§763) —
 * names its form itself. The caller names the two boxes (`event.durationHours` posts with the event's
 * save, `cp[3].cutoffHours` with the checkpoints') and draws the legend and the help around them.
 */
export default function DurationBoxes({
  hoursName,
  minutesName,
  hoursLabel,
  minutesLabel,
  defaults,
  size,
  describedBy,
}: {
  hoursName: string;
  minutesName: string;
  hoursLabel: string;
  minutesLabel: string;
  /** What the boxes show before anything is typed: "" and "" for none (`splitDuration`). */
  defaults: { hours: string; minutes: string };
  size?: "small" | "medium";
  /** The id of the caller's help line, so both boxes are read together with it. */
  describedBy?: string;
}) {
  const numeric = { inputMode: "numeric", ...(describedBy ? { "aria-describedby": describedBy } : {}) };
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "flex-start" }}>
      <RecallField
        name={hoursName}
        label={hoursLabel}
        defaultValue={defaults.hours}
        size={size}
        {...textFieldConstraints(DURATION_HOURS_CONSTRAINTS, numeric)}
        sx={{ flex: "0 0 120px" }}
      />
      <RecallField
        name={minutesName}
        label={minutesLabel}
        defaultValue={defaults.minutes}
        size={size}
        {...textFieldConstraints(DURATION_MINUTES_CONSTRAINTS, numeric)}
        sx={{ flex: "0 0 120px" }}
      />
    </Box>
  );
}
