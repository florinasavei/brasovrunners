"use client";

import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Tooltip from "@mui/material/Tooltip";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "./tooltip-text";

/**
 * The backoffice's discreet «?» (§NNN; the owner: the backoffice's words cut to one plain sentence
 * per field, the details behind a «?»). The sentence a field needs stays on the screen; what
 * explains it — the why, the exceptions, where a figure comes from — is this glyph's tooltip and
 * its accessible name, so a screen reader hears it without the hover and a thumb gets it with a
 * tap (`enterTouchDelay={0}`), staying up as long as the text takes to read.
 *
 * The weather line's «?» (§473) made general: a 16 px muted glyph that keeps the line's height,
 * inside a 44 px hit area drawn by an invisible overlay (BR-REQ-041-01 criterion 6), and
 * `type="button"`, so inside a form it never submits it. A client island because `Tooltip` needs a
 * ref on its child; a Server Component hands it a string, never an element (§370).
 *
 * The one «?» of the platform: the event page's weather line draws this too, at its own 14 px and
 * under its own test id (`event-weather-help`, §473), rather than a second copy of the button.
 */
export default function QuietHelp({ text, size = 16, testId = "quiet-help" }: { text: string; size?: 14 | 16; testId?: string }) {
  // The overlay reaches 44 px whatever the glyph: 14 px + 2 × 15, or 16 px + 2 × 14.
  const reach = (44 - size) / 2;
  return (
    <Tooltip title={text} arrow enterTouchDelay={0} leaveTouchDelay={readingTimeMs(text)} slotProps={{ tooltip: { sx: TOOLTIP_TEXT_SX } }}>
      <button
        type="button"
        aria-label={text}
        data-testid={testId}
        style={{
          position: "relative",
          display: "inline-flex",
          verticalAlign: size === 14 ? "-2px" : "-3px",
          marginLeft: 4,
          padding: 0,
          border: 0,
          background: "none",
          color: "inherit",
          cursor: "help",
          opacity: 0.6,
        }}
      >
        <HelpOutlineIcon aria-hidden="true" sx={{ fontSize: size }} />
        <span aria-hidden="true" style={{ position: "absolute", inset: -reach }} />
      </button>
    </Tooltip>
  );
}
