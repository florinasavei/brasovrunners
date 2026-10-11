"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import type { ReactNode } from "react";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "./tooltip-text";

/**
 * A tooltip around a control that may be disabled (§710): MUI's `Tooltip` needs a node that takes a
 * ref and hears the pointer, and a disabled button hears nothing, so the span carries it. The title
 * is a string, never an element. Backoffice only: the tooltip is the backoffice's cost, not a
 * visitor's. `describeChild` keeps the control's own name as its name; the sentence describes the
 * span, which a screen reader does not announce on the button, so the words on the button, not
 * this, carry what matters.
 */
export default function TipSpan({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Tooltip title={title} describeChild enterTouchDelay={700} leaveTouchDelay={readingTimeMs(title)} slotProps={{ tooltip: { sx: TOOLTIP_TEXT_SX } }}>
      <Box component="span" sx={{ display: "inline-flex" }}>
        {children}
      </Box>
    </Tooltip>
  );
}
