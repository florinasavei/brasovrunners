"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
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
        <Chip
          key={date.id}
          component="a"
          href={date.href}
          clickable
          // The tap target is the link's box, 44px (BR-REQ-041-01 criterion 6); the pill is drawn small.
          variant={date.id === currentId ? "filled" : "outlined"}
          color={date.id === currentId ? "primary" : "default"}
          aria-current={date.id === currentId ? "page" : undefined}
          icon={date.note ? <EditionMark note={date.note} size={16} /> : undefined}
          label={date.label}
          size="small"
          sx={{
            // Inside a 44px target (§158): the pill is small, the link around it is not.
            ...(date.note?.kind === "cancelled" ? { textDecoration: "line-through", color: "text.secondary" } : {}),
          }}
        />
      ))}
      {more && (
        <Typography variant="body2" color="text.secondary">
          {more}
        </Typography>
      )}
    </Box>
  );
}
