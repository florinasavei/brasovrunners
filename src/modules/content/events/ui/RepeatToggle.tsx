"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import { type ReactNode, useState } from "react";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * "Repetă evenimentul", and the recurrence fields only once it is ticked (§170; the owner:
 * "repetă evenimentul trebuie să fie o bifă și abia apoi pot să setez frecvența").
 *
 * The cadence, the weekdays, the end date and the button that makes the series were open on
 * every event, which reads as a question being asked of an event that is not a series and
 * never will be — and on the creation form it meant a select whose first option was "does not
 * repeat", a value that exists only because the control was always shown.
 *
 * The children are **hidden, not unmounted**, exactly as `OnlyForType` does: a date typed
 * before the box was unticked is still in the form, so unticking and reticking does not lose
 * it. What decides is the checkbox itself — the actions read `<name>` and do nothing at all
 * without it, so a hidden cadence posts nothing anybody acts on.
 */
export default function RepeatToggle({
  name,
  label,
  children,
}: {
  /** The flag the action reads: `repeat.on` on the creation form, `repeatOn` on an event. */
  name: string;
  label: string;
  children: ReactNode;
}) {
  const [on, setOn] = useState(false);

  return (
    <Box>
      <FormControlLabel
        control={
          <Checkbox
            name={name}
            checked={on}
            onChange={(event) => setOn(event.target.checked)}
            sx={CHECKBOX_TAP_TARGET}
          />
        }
        label={label}
      />
      <Box sx={{ display: on ? "block" : "none", mt: 1 }}>{children}</Box>
    </Box>
  );
}
