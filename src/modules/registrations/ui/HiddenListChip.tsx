"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import IncognitoIcon from "@/shared/ui/IncognitoIcon";

/**
 * «Lista ascunsă» as a chip (§647, amending §643): the incognito glyph beside the words, on a
 * registration's row and page, and — given an `href` — the registrations list's pill, a filter link
 * inside a 44-pixel target like every other pill (`ChipLink`, BR-REQ-041-01 criterion 6).
 *
 * Its own small island because the glyph is an element MUI's `Chip` takes as a prop: made here, on the
 * client side of the boundary, never passed from the Server Component that draws the row (§370). It
 * imports the one glyph file, never the backoffice's registry, and only the backoffice renders it.
 * `ChipLink` itself is not reused: it takes a glyph by name from the public pages' registry
 * (`modules/events/ui/glyphs`), which has no drawn glyph and should not gain a backoffice one; the
 * link wrapper here is ChipLink's, line for line (a soft `next/link`, never prefetched, 44 pixels).
 */
export default function HiddenListChip({
  label,
  href,
  active = false,
  testId,
}: {
  label: string;
  /** The list's pill: where a press leads (`outside=1`, or without it while pressed). Absent, a plain chip. */
  href?: string;
  /** Pressed: filled in the brand colour, like the state pills. */
  active?: boolean;
  testId?: string;
}) {
  const chip = (
    <Chip
      size="small"
      icon={<IncognitoIcon fontSize="small" />}
      label={label}
      // The pill looks like every other summary pill (`ChipLink`): default, outlined; filled in the brand
      // colour while pressed. The row's plain chip keeps the secondary colour that marks the row.
      color={href ? (active ? "primary" : "default") : "secondary"}
      variant={href && active ? "filled" : "outlined"}
      data-testid={href ? undefined : testId}
    />
  );
  if (!href) return chip;
  return (
    <Box
      component={Link}
      href={href}
      prefetch={false}
      scroll={false}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, textDecoration: "none", color: "inherit" }}
    >
      {chip}
    </Box>
  );
}
