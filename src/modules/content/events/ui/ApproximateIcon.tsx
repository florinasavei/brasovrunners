"use client";

import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

/**
 * «≈», for the «Estimativ» tick beside «Diferență de nivel (m)» (§585): the sign the site writes in
 * front of an estimated climb («≈ 350 m D+»), so the tick and what it does look alike. Material's
 * set has no "approximately" glyph, so this is drawn here like `RoadIcon`: two waves as strokes of
 * the current colour, on the same 24-unit grid as every other glyph, and `aria-hidden` by its
 * caller — the word beside it is what a screen reader hears.
 */
export default function ApproximateIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path
        d="M4 9.5c2.5-3 5.5-3 8 0s5.5 3 8 0M4 16.5c2.5-3 5.5-3 8 0s5.5 3 8 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}
