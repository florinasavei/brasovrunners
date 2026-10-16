"use client";

import Chip from "@mui/material/Chip";
import { STATUS_GLYPHS, type StatusGlyphName } from "./status-glyphs";

/**
 * A backoffice chip with a glyph in front of its word (§112, §707, amending §694), for a Server
 * Component to render. The look is `GlyphChip`'s — small, the palette's colours, the glyph before
 * the words — and nothing else of it: no tooltip, no link, no screen-reader extras.
 *
 * A client island with its own registry, not a server chip: MUI's `Chip` is a client component, so
 * an `icon={<Icon />}` made on the server crosses as a lazy reference and hydration fails (§370,
 * `GlyphChip` records it). The name crosses instead and the element is made here — and the table it
 * is looked up in holds only the names the backoffice draws (`status-glyphs.ts`), which is what
 * keeps them out of the public chip's bundle.
 */
export default function StatusChip({
  glyph,
  label,
  color = "default",
  variant = "filled",
  testId,
  inline = false,
}: {
  glyph: StatusGlyphName;
  label: string;
  color?: "default" | "primary" | "secondary" | "success" | "warning" | "error";
  variant?: "filled" | "outlined";
  testId?: string;
  /** Drawn as a `<span>`, for a chip inside a heading or a summary, where a `<div>` is not phrasing content. */
  inline?: boolean;
}) {
  const Icon = STATUS_GLYPHS[glyph];
  return <Chip size="small" {...(inline ? { component: "span" } : {})} color={color} variant={variant} icon={<Icon />} label={label} {...(testId ? { "data-testid": testId } : {})} />;
}
