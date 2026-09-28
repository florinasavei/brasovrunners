"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import { type ReactNode, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * "Repetă evenimentul", and the recurrence fields only once ticked (§170). The children are
 * hidden, not unmounted (as `OnlyForType`), so untick/retick keeps what was typed; the actions do
 * nothing without the tick. After a refused submit the tick and fields come back (§315).
 */
export default function RepeatToggle(props: { name: string; label: string; children: ReactNode }) {
  const recall = useRecall();
  return (
    <RepeatToggleIsland
      key={recall.generation}
      {...props}
      on={recall.has ? recall.value(props.name) === "on" : false}
      // The id the refusal summary links to, when the refusal named the tick ("tick 'repeat' first").
      id={recall.named(props.name) ? recall.idOf(props.name) : undefined}
    />
  );
}

function RepeatToggleIsland({
  name,
  label,
  on: initialOn,
  id,
  children,
}: {
  /** The flag the action reads: `repeat.on` on the creation form, `repeatOn` on an event. */
  name: string;
  label: string;
  on: boolean;
  id?: string;
  children: ReactNode;
}) {
  const [on, setOn] = useState(initialOn);

  return (
    <Box>
      <FormControlLabel
        control={
          <Checkbox
            id={id}
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
