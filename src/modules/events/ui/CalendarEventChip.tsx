"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import NextLink from "next/link";
import EditionMark, { type EditionNote } from "./EditionMark";
import { GLYPHS, type GlyphName } from "./glyphs";

/**
 * One event in the month grid (`DECISIONS.md` §137): the type's glyph and the surface's
 * (§112; the owner: "the icons in the calendar should also contain the type of terrain"),
 * the time, the title where there is room, and the whole sentence in a tooltip. A client
 * island so `Tooltip` can hold a ref to its child and the glyphs are made on this side of
 * the boundary, by name (§112).
 *
 * The grid is the month on every width now (§137); at 320px a column is some 40px, so on a
 * phone the chip is a column of glyphs over the time and the title is the tooltip's and the
 * link's accessible name — the page it opens is the rest. 44px tall wherever it is
 * (BR-REQ-041-01 criterion 6).
 */
export default function CalendarEventChip({
  href,
  time,
  title,
  glyphs,
  filled,
  cancelled,
  note,
  dense,
}: {
  href: string;
  time: string;
  title: string;
  /** The type's glyph first, the surface's after it when the event has one. */
  glyphs: readonly GlyphName[];
  /** A race, in the brand colour; everything else quiet. */
  filled: boolean;
  cancelled: boolean;
  note: EditionNote | null;
  /** Inside a grid cell (small type, one line) rather than an agenda row. */
  dense: boolean;
}) {
  const sentence = `${time} ${title}`;
  return (
    <Tooltip title={sentence} arrow enterTouchDelay={0}>
      <NextLink href={href} aria-label={sentence} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
        <Box
          sx={{
            minHeight: 44,
            display: "flex",
            flexDirection: dense ? { xs: "column", sm: "row" } : "row",
            alignItems: "center",
            justifyContent: dense ? { xs: "center", sm: "flex-start" } : "flex-start",
            gap: dense ? { xs: 0.25, sm: 0.5 } : 0.5,
            px: dense ? { xs: 0.25, sm: 0.75 } : 0.75,
            py: 0.25,
            borderRadius: 1,
            fontSize: dense ? { xs: "0.6875rem", sm: "0.75rem" } : "0.9375rem",
            lineHeight: 1.3,
            overflow: "hidden",
            bgcolor: filled ? "primary.main" : "action.selected",
            color: filled ? "primary.contrastText" : "text.primary",
            textDecoration: cancelled ? "line-through" : "none",
            "&:hover": { filter: "brightness(0.95)" },
          }}
        >
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, flexShrink: 0 }} aria-hidden="true">
            {glyphs.map((name) => {
              const Glyph = GLYPHS[name];
              return <Glyph key={name} sx={{ fontSize: dense ? 14 : 18 }} />;
            })}
          </Box>
          <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: dense ? "nowrap" : "normal", minWidth: 0 }}>
            <Box component="span" sx={{ fontWeight: 600, mr: { xs: 0, sm: 0.5 } }}>
              {time}
            </Box>
            <Box component="span" sx={dense ? { display: { xs: "none", sm: "inline" } } : undefined}>{title}</Box>
          </Box>
          {note && <EditionMark note={note} size={dense ? 16 : 18} />}
        </Box>
      </NextLink>
    </Tooltip>
  );
}
