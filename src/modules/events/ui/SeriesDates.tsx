"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import EditionMark, { type EditionNote } from "./EditionMark";

export type SeriesDate = { id: string; href: string; label: string; note: EditionNote | null };

/**
 * The coming dates of a series as chips (§113), each its own page; a date that is not like the
 * others is struck through and carries its mark (§122). A client island so the mark's icon
 * can sit inside the chip — an icon element handed to `Chip` from a Server Component is
 * dropped during server rendering (§112).
 */
export default function SeriesDates({ dates, more }: { dates: readonly SeriesDate[]; more?: string }) {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
      {dates.map((date) => (
        <Chip
          key={date.id}
          component="a"
          href={date.href}
          clickable
          variant="outlined"
          icon={date.note ? <EditionMark note={date.note} size={16} /> : undefined}
          label={date.label}
          sx={{
            height: 44,
            borderRadius: 22,
            px: 0.5,
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
