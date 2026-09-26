"use client";

import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import { GLYPHS, type GlyphName } from "./glyphs";

/**
 * Clipped to a single pixel and kept out of the flow, the standard technique for text a screen
 * reader must read and a sighted visitor never sees — unlike an `aria-label`, this works on any
 * element, including the plain, roleless `<div>` MUI's `Chip` renders when it is not `clickable`
 * (ARIA 1.2 does not allow naming a generic element, and browse-mode screen readers read such a
 * chip's own text and ignore the attribute).
 *
 * `'1px'`/`'-1px'` as strings, never the bare numbers `1`/`-1`: MUI's `sx` runs every `width`,
 * `height` and `margin` value through its spacing transform, which turns a number in `(0, 1]`
 * into a *percentage* of the theme's spacing unit read as a fraction — `width: 1` becomes
 * `100%`, not `1px` — so the "single pixel" box was in fact as wide and as tall as the chip
 * itself, sized like ordinary content rather than clipped out of the way.
 */
const srOnlySx: SxProps<Theme> = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * A chip with a glyph in front of its word (§112), for a Server Component to render.
 *
 * The glyph arrives as a *name* and the element is made here, on the client side of the
 * boundary. Passing `icon={<StarIcon />}` from a Server Component looked right and typechecked,
 * and hydration failed on every chip: during server rendering the element reaches MUI's `Chip`
 * as a lazy Flight reference, `React.isValidElement` says no and the icon is dropped, then the
 * browser renders it — the HTML and the client tree differ. A string crosses the boundary
 * safely; the same reason the filter chips take a string `href` and never a `Link`.
 */
export default function GlyphChip({
  glyph,
  label,
  color = "default",
  variant = "filled",
  href,
  tooltip,
  sx,
  srSuffix,
  closeMark = false,
}: {
  glyph: GlyphName;
  label: string;
  /**
   * Why the pill is there, on hover and on a tap (§394: the night pill's "Soarele apune la
   * 16:36", §415). It describes the chip rather than naming it (`describeChild`), so the chip's words
   * stay what a screen reader announces first.
   */
  tooltip?: string;
  /**
   * The club's blue for the one event the site leads with, the club's orange for a special
   * edition (§168) — two claims side by side on the same hero, each with its own colour and
   * its own word. Both are palette entries with a stated `contrastText` (`theme/theme.ts`),
   * never a colour written here.
   */
  color?: "default" | "primary" | "secondary";
  variant?: "filled" | "outlined";
  /** Set, the chip is a link — the listing's type filter. */
  href?: string;
  sx?: SxProps<Theme>;
  /**
   * Extra words a screen reader reads right after `label`, never shown (`Pill.srSuffix`) — for
   * example the fee going to the organizer rather than the club, on a chip whose visible word
   * stays the closed set's own ("Cu taxă").
   */
  srSuffix?: string;
  /**
   * A small ✕ after the word, drawn only (`aria-hidden`): the listing's active-filter chip, whose
   * whole link removes that filter (§413) and says so in its own accessible name. Not MUI's
   * `onDelete`, whose icon stops the click from reaching the link around the chip.
   */
  closeMark?: boolean;
}) {
  const Icon = GLYPHS[glyph];
  const content =
    srSuffix || closeMark ? (
      <>
        {label}
        {srSuffix && <Box component="span" sx={srOnlySx}>{` — ${srSuffix}`}</Box>}
        {closeMark && <CloseIcon aria-hidden="true" sx={{ fontSize: 14, ml: 0.5, verticalAlign: "-2px" }} />}
      </>
    ) : (
      label
    );
  const chip = href ? (
    <Chip component="a" href={href} clickable size="small" color={color} variant={variant} icon={<Icon />} label={content} sx={sx} />
  ) : (
    <Chip size="small" color={color} variant={variant} icon={<Icon />} label={content} sx={sx} />
  );
  // `describeChild` sets `aria-describedby` on the chip while the tooltip is open, so a screen
  // reader that already read the sentence out of `srSuffix` — part of the chip's own accessible
  // name — would read it again as the tooltip's description. Left off here so hover and focus
  // still open the tooltip for a sighted visitor, only the redundant description goes.
  //
  // MUI's `describeChild={false}` branch instead sets `aria-label` to `title` whenever `title` is
  // a plain string — which would replace the chip's whole accessible name (the glyph's word, e.g.
  // "Noapte", and the suffix both) with the tooltip alone, permanently, not only while open. A
  // `title` that is a React node rather than a string skips that branch (MUI's own
  // `titleIsString` guard), which is why the tooltip is wrapped in a fragment only on this path —
  // the string form stays on every other chip, whose native, pre-hydration `title` attribute
  // `describeChild={true}` sets depends on it.
  const describeChild = srSuffix !== tooltip;
  const tooltipTitle = describeChild ? tooltip : tooltip != null ? <>{tooltip}</> : tooltip;
  return tooltip ? (
    <Tooltip title={tooltipTitle} arrow describeChild={describeChild} enterTouchDelay={0}>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}
