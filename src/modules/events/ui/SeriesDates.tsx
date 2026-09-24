"use client";

import Box from "@mui/material/Box";
import Chip, { chipClasses } from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import EditionMark, { type EditionNote } from "./EditionMark";

export type SeriesDate = {
  id: string;
  href: string;
  /** The chip's words: the short date, capitalised (§349). */
  label: string;
  /** The same date inside a sentence ("Deschide data de mie., 30 sept. 2026"), when one is built. */
  labelInline?: string;
  note: EditionNote | null;
};

/**
 * The link around one date's pill: 44 pixels tall and at least 44 wide (BR-REQ-041-01 criterion
 * 6), the pill inside it MUI's small one, 24 — the shape `ChipLink` gives every other small pill
 * that is a link (§158). Until §NNN the link *was* the pill, a 24-pixel target under a comment
 * that said 44.
 *
 * The ten pixels above and below the pill stay in the layout. The card's tight links give theirs
 * back as a negative margin (§356, §NNN), but only ever as much as the gap on that side, because
 * whatever comes later in the page paints over the link and takes a press there — and these have
 * no gap to give into: a date that wraps sits right under the row before it, the first row four
 * pixels under the fold's own 44-pixel summary, the last four above the door. So the rows stand
 * 44 pixels apart, twenty between the pills, and every pixel of each target is its own;
 * `listing-cards.spec.ts` presses their edges to prove it.
 */
const DATE_LINK_SX = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  minWidth: 44,
  color: "inherit",
  textDecoration: "none",
  borderRadius: 1,
  // The pill answers the pointer as MUI's clickable chip did; a filled (current) date keeps its fill.
  [`&:hover > .${chipClasses.outlined}`]: { bgcolor: "action.hover" },
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
} as const;

/**
 * The coming dates of a series as chips (§113), each its own page; a date that is not like the
 * others is struck through and carries its mark (§122). A client island so the mark's icon
 * can sit inside the chip — an icon element handed to `Chip` from a Server Component is
 * dropped during server rendering (§112).
 */
export default function SeriesDates({
  dates,
  more,
  currentId,
}: {
  dates: readonly SeriesDate[];
  more?: string;
  /** The date the page is about, filled and marked current — the editor's header (§131). */
  currentId?: string;
}) {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 0.5, alignItems: "center" }}>
      {dates.map((date) => (
        <Box
          key={date.id}
          component="a"
          href={date.href}
          aria-current={date.id === currentId ? "page" : undefined}
          sx={DATE_LINK_SX}
        >
          {/* The pill is a picture of the link, not a control of its own: a `<span>`, so the
              anchor holds phrasing content only. */}
          <Chip
            component="span"
            variant={date.id === currentId ? "filled" : "outlined"}
            color={date.id === currentId ? "primary" : "default"}
            icon={date.note ? <EditionMark note={date.note} size={16} /> : undefined}
            label={date.label}
            size="small"
            sx={date.note?.kind === "cancelled" ? { textDecoration: "line-through", color: "text.secondary" } : undefined}
          />
        </Box>
      ))}
      {more && (
        <Typography variant="body2" color="text.secondary">
          {more}
        </Typography>
      )}
    </Box>
  );
}
