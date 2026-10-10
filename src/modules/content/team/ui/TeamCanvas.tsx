import Box from "@mui/material/Box";
import { TEAM_CANVAS } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import type { CanvasRow } from "../domain/canvas";
import type { PublicTeamBox, PublicTeamMember } from "../repository";
import TeamCanvasBox from "./TeamCanvasBox";
import TeamCanvasCard, { type TeamCanvasWords } from "./TeamCanvasCard";

/**
 * «Echipa»'s canvas (§NNN, amending §691; the owner, of §691's chart: «not with lines, some lines
 * are not clearly defined; can we have more like a canvas? And to be able to select levels»). A
 * full-width section in the club's ink blue — to the screen's edges on a phone, inside the page's
 * gutters with the theme's corners from `sm` — holding the rows `buildCanvasRows` made of the
 * cards' levels, then the page's boxes as light cards at the bottom. No connector anywhere: the
 * rows and the shapes say who stands where.
 *
 * - Row 1 with one lead: the wide `.0` card, at least 480 pixels from `md`, and the small `.5`
 *   cards at its right, 280 pixels each; a small card the row cannot hold wraps under it, so the
 *   wide card is never crushed under its own 280-pixel photo. On a phone they stand in a column.
 * - Row 1 with two or more leads, or none (a lone `.5`): the grid below — a second president-sized
 *   card beside the first would leave each a few dozen pixels of words.
 * - Rows 2 and under: the tall `.0` cards in a wrapping grid, three to a row from `md`, two from
 *   `sm`, one at 320 pixels; that row's `.5` cards after them, small.
 * - The boxes: three across from `md`, one at 320 pixels, rich text as every page draws it.
 *
 * Server Components throughout, every prop data (§370); the colours are `TEAM_CANVAS`'s alone, the
 * same after dark — the blue is the brand (`theme/brand.ts`). The phone spacing is the §380 scale's.
 */

/** The wide card's floor from `md`: a 280-pixel photo and a column of words, never less. */
export const WIDE_CARD_MIN_WIDTH = 480;

/** A small card's column beside the wide card, from `md`. */
export const SMALL_CARD_WIDTH = 280;

export default function TeamCanvas({
  rows,
  boxes,
  words,
  label,
  boxesLabel,
}: {
  rows: readonly CanvasRow<PublicTeamMember>[];
  boxes: readonly PublicTeamBox[];
  words: TeamCanvasWords;
  label: string;
  boxesLabel: string;
}) {
  // Each row's first index in one running count across the canvas: the rise-in's stagger and the
  // first four photos' eager load.
  const starts = rows.map((_, index) => rows.slice(0, index).reduce((sum, row) => sum + row.lead.length + row.beside.length, 0));
  return (
    <Box
      component="section"
      aria-label={label}
      data-testid="team-canvas"
      sx={{
        bgcolor: TEAM_CANVAS.canvas,
        color: TEAM_CANVAS.ink,
        // The container's own gutters, taken back on a phone so the canvas runs edge to edge.
        mx: { xs: -2, sm: 0 },
        px: { xs: DENSITY.sectionGap, sm: 3 },
        py: { xs: DENSITY.sectionGap, sm: 3 },
        borderRadius: { xs: 0, sm: 2 },
        display: "grid",
        gap: { xs: DENSITY.sectionGap, sm: 3 },
      }}
    >
      {rows.map((row, rowIndex) => {
        // The wide shape is the single lead of the top row alone; any other row is the grid.
        const wide = rowIndex === 0 && row.lead.length === 1;
        const start = starts[rowIndex] ?? 0;
        return (
          <Box
            key={row.level}
            component="ul"
            data-testid="team-canvas-row"
            data-level={row.level}
            data-layout={wide ? "wide" : "grid"}
            sx={{
              listStyle: "none",
              m: 0,
              p: 0,
              gap: 2,
              ...(wide
                ? {
                    // The top row: the wide card grows from its floor, the small cards keep a column's
                    // width beside it, and what the row cannot hold wraps under.
                    display: "flex",
                    flexDirection: { xs: "column", md: "row" },
                    flexWrap: "wrap",
                    alignItems: "stretch",
                    "& > [data-variant='wide']": {
                      flexGrow: 1,
                      flexBasis: { xs: "auto", md: `${WIDE_CARD_MIN_WIDTH}px` },
                      minWidth: { xs: 0, md: `${WIDE_CARD_MIN_WIDTH}px` },
                    },
                    "& > [data-variant='small']": { flex: { md: `0 0 ${SMALL_CARD_WIDTH}px` }, minWidth: 0 },
                  }
                : {
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
                  }),
            }}
          >
            {row.lead.map((member, index) => (
              <TeamCanvasCard key={member.id} member={member} variant={wide ? "wide" : "tall"} index={start + index} words={words} />
            ))}
            {row.beside.map((member, index) => (
              <TeamCanvasCard key={member.id} member={member} variant="small" index={start + row.lead.length + index} words={words} />
            ))}
          </Box>
        );
      })}
      {boxes.length > 0 && (
        // The page's boxes (§691) at the bottom of the canvas, in the club's order.
        <Box
          component="section"
          aria-label={boxesLabel}
          data-testid="team-boxes"
          sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" }, gap: 2 }}
        >
          {boxes.map((box, index) => (
            <TeamCanvasBox key={box.id} box={box} index={index} />
          ))}
        </Box>
      )}
    </Box>
  );
}
