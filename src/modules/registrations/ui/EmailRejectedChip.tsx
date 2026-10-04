"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "@/shared/ui/tooltip-text";

/**
 * «Email respins» with its explanation (§NNN): which email was rejected, when, why, whether the address
 * had been confirmed before it, and what to do — in an MUI `Tooltip` that opens on hover, on keyboard
 * focus and on a tap, never a `title` attribute (which a touch screen never shows). The provider's own
 * reason comes last, in small print.
 *
 * The chip sits in a 44-pixel target that takes the focus (BR-REQ-041-01 criterion 6); `describeChild`
 * makes the open tooltip the target's description, and the sentences are also its accessible name, so a
 * screen reader hears them without opening anything. Strings only across the boundary: the words are
 * made on the server (`rejected-email-words.ts`).
 */
export default function EmailRejectedChip({
  label,
  sentences,
  reason,
  testId = "email-rejected",
}: {
  label: string;
  sentences: string[];
  reason: string | null;
  testId?: string;
}) {
  // Controlled, as `GlyphChip`'s: MUI opens on a touch only after a long press, so a tap opens it too.
  const [open, setOpen] = useState(false);
  const text = sentences.join(" ");
  const spoken = [label, text, reason].filter(Boolean).join(". ");
  return (
    <Tooltip
      title={
        <>
          {sentences.join("\n")}
          {reason && (
            <Box component="small" sx={{ display: "block", mt: 0.75, opacity: 0.85, fontSize: "0.75rem", wordBreak: "break-word" }}>
              {reason}
            </Box>
          )}
        </>
      }
      arrow
      describeChild
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      enterTouchDelay={0}
      leaveTouchDelay={readingTimeMs(`${text} ${reason ?? ""}`)}
      slotProps={{ tooltip: { sx: TOOLTIP_TEXT_SX } }}
    >
      <Box
        component="span"
        tabIndex={0}
        role="note"
        aria-label={spoken}
        onClick={() => setOpen(true)}
        data-testid={testId}
        sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, cursor: "help" }}
      >
        <Chip size="small" color="error" variant="outlined" label={label} />
      </Box>
    </Tooltip>
  );
}
