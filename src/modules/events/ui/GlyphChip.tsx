"use client";

import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import { GLYPHS, type GlyphName } from "./glyphs";

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
}: {
  glyph: GlyphName;
  label: string;
  /**
   * Why the pill is there, on hover and on a tap (§NNN: the night pill's "Apusul la 16:36 — ia o
   * frontală"). It describes the chip rather than naming it (`describeChild`), so the chip's words
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
}) {
  const Icon = GLYPHS[glyph];
  const chip = href ? (
    <Chip component="a" href={href} clickable size="small" color={color} variant={variant} icon={<Icon />} label={label} sx={sx} />
  ) : (
    <Chip size="small" color={color} variant={variant} icon={<Icon />} label={label} sx={sx} />
  );
  return tooltip ? (
    <Tooltip title={tooltip} arrow describeChild enterTouchDelay={0}>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}
