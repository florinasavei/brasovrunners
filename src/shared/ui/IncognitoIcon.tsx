"use client";

import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

/**
 * «Lista ascunsă» (§NNN; the owner, 2026-10-02: «o iconiță specială cu un bandit (incognito)»): a hat
 * over a pair of round glasses — somebody at the start whom the count does not see. Material's set has
 * no incognito glyph, so it is drawn here, as `RoadIcon` is: one path on the same 24-unit grid as every
 * other glyph, filled with the current colour — the crown with its dip, the brim, two rings (each a
 * circle with its inside wound the other way, so it stays open) and the bridge between them.
 */
export default function IncognitoIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M6.3 10 8.1 4.3c.17-.52.73-.8 1.24-.6L12 4.7l2.66-1c.51-.2 1.07.08 1.24.6L17.7 10zM3 10.2h18a1 1 0 0 1 0 2H3a1 1 0 0 1 0-2zM7 13.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7zm0 1.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM17 13.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7zm0 1.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM10.4 16.1c1-.6 2.2-.6 3.2 0v1.3c-1-.55-2.2-.55-3.2 0z" />
    </SvgIcon>
  );
}
