"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "@/shared/ui/tooltip-text";

/**
 * A signed declaration's fingerprint in the backoffice (§NNN): the first twelve characters of the
 * SHA-256 of the exact text signed, the whole one in a tooltip — on hover, on focus and on a tap, as
 * `Hint` opens (a `title` attribute never shows on a touch screen). The same whole hash is the
 * element's accessible name, so a screen reader hears it without the tooltip.
 *
 * Strings only across the boundary: the label and the hash, both from the server.
 */
export default function TextHashTip({ label, hash, short }: { label: string; hash: string; short: string }) {
  return (
    <Tooltip title={hash} enterTouchDelay={0} leaveTouchDelay={readingTimeMs(hash)} arrow slotProps={{ tooltip: { sx: { ...TOOLTIP_TEXT_SX, wordBreak: "break-all" } } }}>
      <Box
        component="span"
        tabIndex={0}
        aria-label={`${label}: ${hash}`}
        data-testid="declaration-text-hash"
        sx={{ fontFamily: "monospace", whiteSpace: "nowrap", cursor: "help", textDecoration: "underline dotted" }}
      >
        {label}: {short}…
      </Box>
    </Tooltip>
  );
}
