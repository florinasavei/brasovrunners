"use client";

import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

/**
 * A road, for the asphalt surface (§121; the owner: "I hate the asphalt icon, I need something
 * like a road"). Material's set has no plain road — only one with a plus, a pencil or a minus
 * on it — so this is drawn here: two edges narrowing to the horizon and a dashed centre line,
 * as strokes of the current colour, on the same 24-unit grid as every other glyph.
 */
export default function RoadIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path
        d="M3.5 21 9 3.5M20.5 21 15 3.5M12 4.5v3M12 10.5v3M12 16.5v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}
