"use client";

import Tooltip from "@mui/material/Tooltip";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { GLYPHS } from "./glyphs";

/**
 * The handshake beside a calendar entry held with a partner (§367; the owner: "show like a
 * handshake icon on the card and in the calendar"), for the agenda, where the entry has no
 * tooltip of its own (§261): the generic "Colaborare" marker (§367, §379) in a tooltip
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
 * `sx`, when given, follows the emoji's own default filter (§379 amended, 2026-09-25): the caller
 * — `CalendarEventChip`, on a filled (race) entry — overrides the grayscale brightness so the
 * handshake still reads against `primary.main` rather than the quiet `text.secondary` tone this
 * glyph is tuned to everywhere else.
 */
export default function PartnerMark({ text, size = 18, sx }: { text: string; size?: number; sx?: SvgIconProps["sx"] }) {
  const Icon = GLYPHS.partner;
  return (
    <Tooltip title={text} arrow enterTouchDelay={0}>
      <Icon
        role="img"
        aria-label={text}
        aria-hidden={false}
        sx={[{ fontSize: size, flexShrink: 0, verticalAlign: "-4px" }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      />
    </Tooltip>
  );
}
