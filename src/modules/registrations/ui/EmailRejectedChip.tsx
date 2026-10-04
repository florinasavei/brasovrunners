"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "@/shared/ui/tooltip-text";

/**
 * «Email respins» with its explanation (§663): which email was rejected, when, why, whether the address
 * had been confirmed before it, and what to do — in an MUI `Tooltip` that opens on hover, on keyboard
 * focus and on a tap, never a `title` attribute (which a touch screen never shows). The provider's own
 * reason comes last, in small print.
 *
 * The chip sits in a 44-pixel target that takes the focus (BR-REQ-041-01 criterion 6). Its accessible
 * name carries the label, the sentences and the reason, so a screen reader hears them once, without
 * opening anything. One channel only, as `GlyphChip`'s: no `describeChild`, which would add the open
 * tooltip (opened by that very focus) as the target's description and read it all a second time; and
 * the title stays a React node, so MUI's other branch, which sets `aria-label` to a string title,
 * never replaces the name. Strings only across the boundary: the words are made on the server
 * (`rejected-email-words.ts`).
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
  // Each part ends a sentence of its own: a period only where it has none («…nouă. Motivul…», never «..»).
  const spoken = [label, text, reason]
    .filter((part): part is string => Boolean(part))
    .map((part) => (/[.!?]$/.test(part.trim()) ? part.trim() : `${part.trim()}.`))
    .join(" ");
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
        // MUI's Tooltip names its open child by the tooltip (`aria-labelledby`) unless the child sets the key
        // itself: an explicit undefined keeps the name on `aria-label`, so the sentences are heard once.
        aria-labelledby={undefined}
        onClick={() => setOpen(true)}
        data-testid={testId}
        sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, cursor: "help" }}
      >
        <Chip size="small" color="error" variant="outlined" label={label} />
      </Box>
    </Tooltip>
  );
}
