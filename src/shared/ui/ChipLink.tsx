"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import type { GlyphName } from "@/modules/events/ui/glyphs";

/**
 * A small chip that is a link, inside a 44-pixel target (`DECISIONS.md` §133, §158; the
 * owner: "pretty much all the pills must be smaller"). The link is what a thumb hits and what
 * the e2e suite measures (BR-REQ-041-01 criterion 6); the pill is MUI's small size. Rendered
 * from Server Components: a string href, a string label, a glyph by name — nothing that
 * cannot cross into MUI's client components (`AGENTS.md` §14.1).
 *
 * A client island since §166, for the flicker: these pills — "Lună", "An", "Calendar",
 * "Listă", every kind on the filter — were a plain `<a>`, which throws the document away and
 * repaints it white before the new one arrives. Over `next/link` the press replaces only what
 * changed, and the calendar's body streams into a skeleton while it does. `component={Link}`
 * has to be written on this side of the boundary, which is why the whole component moved
 * rather than gaining a wrapper (`ButtonLink`, `CardLink`, same reason).
 *
 * `next/link` and not the locale-aware one: every caller builds the href with `getPathname`,
 * so it already carries its locale prefix, and prefixing it again would give `/ro/ro/…`. What
 * is rendered is still an ordinary `<a href="…">` with the whole query in it.
 */
export default function ChipLink({
  href,
  label,
  active = false,
  glyph,
  current,
  strike = false,
  title,
  ariaLabel,
  closeMark = false,
  keepScroll = false,
}: {
  href: string;
  label: string;
  /** Filled in the brand colour, like a pressed filter. */
  active?: boolean;
  glyph?: GlyphName;
  /** `aria-current` on the link — "page" for the filter in force, "date" for today's. */
  current?: "page" | "date";
  /** Struck through: a cancelled date. */
  strike?: boolean;
  title?: string;
  /** The link's own name when the chip's word alone would not say what a press does — "Scoate filtrul: Cursă" (§NNN). */
  ariaLabel?: string;
  /** A drawn ✕ after the word: pressing this chip takes something away (the listing's active filters, §NNN). */
  closeMark?: boolean;
  /** Stay where the reader is on the page rather than scroll to the top — a filter changed under their thumb. */
  keepScroll?: boolean;
}) {
  const look = { color: active ? ("primary" as const) : ("default" as const), variant: active ? ("filled" as const) : ("outlined" as const) };
  const sx = strike ? { textDecoration: "line-through", color: "text.secondary" } : undefined;
  return (
    <Box
      component={Link}
      href={href}
      scroll={keepScroll ? false : undefined}
      aria-current={current}
      aria-label={ariaLabel}
      title={title}
      sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, textDecoration: "none", color: "inherit" }}
    >
      {glyph ? (
        <GlyphChip glyph={glyph} label={label} {...look} sx={sx} closeMark={closeMark} />
      ) : (
        <Chip size="small" label={label} {...look} sx={sx} />
      )}
    </Box>
  );
}
