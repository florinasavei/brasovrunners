"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "@/shared/ui/tooltip-text";

/**
 * The desk's one email chip (§NNN, §67): «Fără QR pe email — caută după nume», only while somebody must act
 * and the refused email is the QR confirmation — and in its tooltip that it does not stop the number being
 * handed out, and what to tell the person in front of the desk. Never an address, never the provider's words:
 * the words are made on the server from the desk's own projection (`rejected-email-words.ts`).
 *
 * In an MUI `Tooltip` that opens on hover, on keyboard focus and on a tap — a `title` attribute never shows on
 * a touch screen — inside a 44-pixel target that takes the focus (BR-REQ-041-01 criterion 6). Its accessible
 * name carries the label and the hint once: no `describeChild`, which would read the open tooltip a second
 * time, and an explicit `aria-labelledby` of undefined, so MUI's open tooltip never replaces the name.
 */
export default function DeskEmailChip({ label, hint }: { label: string; hint: string }) {
  // Controlled: MUI opens on a touch only after a long press, so a tap opens it too.
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      title={<>{hint}</>}
      arrow
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      enterTouchDelay={0}
      leaveTouchDelay={readingTimeMs(hint)}
      slotProps={{ tooltip: { sx: TOOLTIP_TEXT_SX } }}
    >
      <Box
        component="span"
        tabIndex={0}
        role="note"
        aria-label={`${label}. ${hint}`}
        aria-labelledby={undefined}
        onClick={() => setOpen(true)}
        data-testid="desk-email-chip"
        sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, cursor: "help" }}
      >
        <Chip size="small" color="warning" variant="outlined" label={label} />
      </Box>
    </Tooltip>
  );
}
