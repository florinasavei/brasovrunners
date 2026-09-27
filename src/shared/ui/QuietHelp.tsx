"use client";

import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Tooltip from "@mui/material/Tooltip";

/**
 * A discreet «?» that says a sentence on hover, on focus, or under a thumb — the quiet sibling of
 * `InfoTip`'s "i": no button chrome, a small muted glyph, the words in the tooltip and in the
 * accessible name. Born as the weather line's «?» (§473) and shared since the calendar page's
 * intro moved behind one on a phone (§NNN). A client island because `Tooltip` needs a ref on its
 * child; the caller hands it a string, never an element.
 *
 * The glyph is small, the hit area 44 pixels through an invisible overlay span (BR-REQ-041-01
 * criterion 6), so the line it sits on keeps its height.
 */
export default function QuietHelp({ text, testId, glyphSize = 14 }: { text: string; testId?: string; glyphSize?: number }) {
  const reach = Math.max(0, Math.ceil((44 - glyphSize) / 2));
  return (
    <Tooltip title={text} arrow enterTouchDelay={0} leaveTouchDelay={4000}>
      <button
        type="button"
        aria-label={text}
        data-testid={testId}
        style={{
          position: "relative",
          display: "inline-flex",
          verticalAlign: "-2px",
          marginLeft: 6,
          padding: 0,
          border: 0,
          background: "none",
          color: "inherit",
          cursor: "help",
          opacity: 0.55,
        }}
      >
        <HelpOutlineIcon aria-hidden="true" sx={{ fontSize: glyphSize }} />
        <span aria-hidden="true" style={{ position: "absolute", inset: -reach }} />
      </button>
    </Tooltip>
  );
}
