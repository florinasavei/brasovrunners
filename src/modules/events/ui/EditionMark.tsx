"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Tooltip from "@mui/material/Tooltip";

export type EditionNote = { kind: "cancelled" | "special" | "moved" | "retimed"; text: string };

/**
 * The mark on a date of a series that is not like the others (`DECISIONS.md` §122; the
 * owner: "a strikethrough for that status and a warning sign with tooltip"): a crossed
 * calendar for a cancelled date, the sparkle in the club's orange for a special edition
 * (§168, §169 — the same glyph the badge wears), an amber warning for one at another place
 * or time, the sentence in a tooltip and as the accessible name. A client island because
 * `Tooltip` needs a ref on its child and the element is made here, never handed across the
 * boundary.
 */
const MARK = {
  cancelled: { Icon: EventBusyIcon, color: "error.main" },
  special: { Icon: AutoAwesomeIcon, color: "secondary.main" },
  moved: { Icon: WarningAmberIcon, color: "warning.main" },
  retimed: { Icon: WarningAmberIcon, color: "warning.main" },
} as const;

export default function EditionMark({ note, size = 18 }: { note: EditionNote; size?: number }) {
  const { Icon, color } = MARK[note.kind];
  // `aria-hidden={false}` (§367): MUI's `SvgIcon` writes `aria-hidden="true"` on a glyph without
  // `titleAccess`, so the mark's `role` and name were hidden from a screen reader — in a series
  // card's date chip, the backoffice list and the agenda — until this said otherwise.
  // `titleAccess` is not the way: it draws an SVG `<title>`, the browser's own tooltip on top of
  // this one.
  return (
    <Tooltip title={note.text} arrow enterTouchDelay={0}>
      <Icon role="img" aria-label={note.text} aria-hidden={false} sx={{ fontSize: size, color, flexShrink: 0, verticalAlign: "-4px" }} />
    </Tooltip>
  );
}

/**
 * The same glyph with no tooltip of its own, for a place that already has one: the month grid's
 * event chip (§367). A tooltip inside a tooltip opened both at once — the chip's and the mark's
 * — so there the note is a line of the chip's own tooltip, and this is only its picture.
 * Decorative: the chip's link carries the note in its accessible name.
 */
export function EditionGlyph({ note, size = 18 }: { note: EditionNote; size?: number }) {
  const { Icon, color } = MARK[note.kind];
  return <Icon aria-hidden="true" sx={{ fontSize: size, color, flexShrink: 0, verticalAlign: "-4px" }} />;
}
