"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import { GLYPHS, type GlyphName } from "./glyphs";

/**
 * Clipped to a single pixel and kept out of the flow, the standard technique for text a screen
 * reader must read and a sighted visitor never sees — unlike an `aria-label`, this works on any
 * element, including the plain, roleless `<div>` MUI's `Chip` renders when it is not `clickable`
 * (ARIA 1.2 does not allow naming a generic element, and browse-mode screen readers read such a
 * chip's own text and ignore the attribute).
 */
const srOnlySx: SxProps<Theme> = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
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
  sx,
  srSuffix,
}: {
  glyph: GlyphName;
  label: string;
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
}) {
  const Icon = GLYPHS[glyph];
  const content = srSuffix ? (
    <>
      {label}
      <Box component="span" sx={srOnlySx}>{` — ${srSuffix}`}</Box>
    </>
  ) : (
    label
  );
  return href ? (
    <Chip component="a" href={href} clickable size="small" color={color} variant={variant} icon={<Icon />} label={content} sx={sx} />
  ) : (
    <Chip size="small" color={color} variant={variant} icon={<Icon />} label={content} sx={sx} />
  );
}
