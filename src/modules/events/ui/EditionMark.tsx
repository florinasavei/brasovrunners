"use client";

import EventBusyIcon from "@mui/icons-material/EventBusy";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Tooltip from "@mui/material/Tooltip";

export type EditionNote = { kind: "cancelled" | "moved" | "retimed"; text: string };

/**
 * The mark on a date of a series that is not like the others (`DECISIONS.md` §122; the
 * owner: "a strikethrough for that status and a warning sign with tooltip"): a crossed
 * calendar for a cancelled date, an amber warning for one at another place or time, the
 * sentence in a tooltip and as the accessible name. A client island because `Tooltip` needs
 * a ref on its child and the element is made here, never handed across the boundary.
 */
export default function EditionMark({ note, size = 18 }: { note: EditionNote; size?: number }) {
  const Icon = note.kind === "cancelled" ? EventBusyIcon : WarningAmberIcon;
  return (
    <Tooltip title={note.text} arrow enterTouchDelay={0}>
      <Icon
        role="img"
        aria-label={note.text}
        sx={{ fontSize: size, color: note.kind === "cancelled" ? "error.main" : "warning.main", flexShrink: 0, verticalAlign: "-4px" }}
      />
    </Tooltip>
  );
}
