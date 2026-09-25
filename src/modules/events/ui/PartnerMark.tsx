"use client";

import Tooltip from "@mui/material/Tooltip";
import { GLYPHS } from "./glyphs";

/**
 * The handshake beside a calendar entry held with a partner (§367; the owner: "show like a
 * handshake icon on the card and in the calendar"), for the agenda, where the entry has no
 * tooltip of its own (§261): the generic "Colaborare" marker (§367, §379, §391) in a tooltip
 * and as the glyph's accessible name, the way `EditionMark` says a date's note.
 *
 * In the month grid the entry's own tooltip already carries that line, so the grid draws the bare
 * glyph instead (`CalendarEventChip`): one tooltip per entry, never one inside another. A client
 * island because `Tooltip` needs a ref on its child, and the glyph is made here from its name.
 *
 * `aria-hidden={false}`: MUI's `SvgIcon` hides every glyph from assistive technology unless it is
 * given `titleAccess` — which draws an SVG `<title>`, the browser's own tooltip on top of this one
 * — so without it the `role` and the name below were never read (§367).
 *
 * No `sx` override for a filled (race) entry any more (§391): the `Handshake` glyph draws with no
 * colour of its own, so `currentColor` carries `primary.contrastText` in from the filled chip's
 * own `color`, the same way it carries `text.secondary` in everywhere else — nothing left to tune.
 */
export default function PartnerMark({ text, size = 18 }: { text: string; size?: number }) {
  const Icon = GLYPHS.partner;
  return (
    <Tooltip title={text} arrow enterTouchDelay={0}>
      <Icon role="img" aria-label={text} aria-hidden={false} sx={{ fontSize: size, flexShrink: 0, verticalAlign: "-4px" }} />
    </Tooltip>
  );
}
