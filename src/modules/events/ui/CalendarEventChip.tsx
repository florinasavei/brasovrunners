"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import NextLink from "next/link";
import EditionMark, { EditionGlyph, type EditionNote } from "./EditionMark";
import { GLYPHS, type GlyphName } from "./glyphs";
import PartnerMark from "./PartnerMark";

/**
 * What the calendar says about one entry, line by line (§367): the time and the whole title, then
 * the date's note when it has one (§122 — "Nu în locul obișnuit: …"), then "Eveniment de noapte —
 * apusul la 16:36" when that date starts after dusk (§NNN, where §382 put the headlamp) — after the
 * place, since both say how the evening will be — then the generic "Colaborare" marker when it is
 * held with one. The grid's tooltip shows them as lines; the link's accessible name reads them as
 * sentences, each ended so a screen reader pauses between them.
 */
function calendarEntryLines({
  time,
  title,
  note,
  night = null,
  partner,
}: {
  time: string;
  title: string;
  note: EditionNote | null;
  night?: string | null;
  partner: string | null;
}): string[] {
  return [`${time} ${title}`, ...(note ? [note.text] : []), ...(night ? [night] : []), ...(partner ? [partner] : [])];
}

function calendarEntryName(lines: readonly string[]): string {
  return lines.map((line, index) => (index < lines.length - 1 && !/[.!?…:]$/.test(line) ? `${line}.` : line)).join(" ");
}

/**
 * One event in the calendar (`DECISIONS.md` §137): the type's glyph and the surface's
 * (§112; the owner: "the icons in the calendar should also contain the type of terrain"),
 * the time and the title, and at the end its marks — the handshake of a partnered event (§367)
 * and the date's note (§122). A client island so `Tooltip` can hold a ref to its child and the
 * glyphs are made on this side of the boundary, by name (§112).
 *
 * **The tooltip belongs to the grid alone** (§261). In a month box a column is some 40 pixels
 * wide, so the chip is a stack of glyphs over the time and the title is cut or not drawn at
 * all — there the tooltip is the only way to read it. The agenda row carries the whole sentence
 * already, and a tooltip there repeats the line it covers; with `enterTouchDelay={0}` it did
 * that on a tap, over the next two rows. The owner: "sunt destul de enervante". There the marks
 * keep a tooltip each (`PartnerMark`, `EditionMark`), side by side, never nested.
 *
 * **One tooltip per grid entry** (§367). The ⚠ used to be an `EditionMark` — a tooltip of its own
 * — inside the chip's tooltip, so a pointer on the mark opened both at once, one over the other.
 * In the grid the marks are bare glyphs now (`EditionGlyph`, the handshake) and the chip's one
 * tooltip carries every line: the time and the title, the note, the partner. The same tooltip
 * opens on keyboard focus, and the link carries no `title` attribute, so the browser adds none.
 *
 * The link's `aria-label` is every line either way (`calendarEntryName`), so nothing is lost for a
 * screen reader when the tooltip is not there — and it stays the name while the tooltip is open:
 * `aria-labelledby` is left unset rather than pointed at the tooltip, as MUI would for a tooltip
 * whose title is not a string. 44px tall wherever it is (BR-REQ-041-01 criterion 6).
 */
export default function CalendarEventChip({
  href,
  time,
  title,
  glyphs,
  filled,
  cancelled,
  note,
  night = null,
  partner,
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
  /** "Eveniment de noapte — apusul la 16:36" / "Night event — sunset at 16:36" (§NNN), made on the server — or null for a date that is not one. */
  night?: string | null;
  /** The generic "Colaborare" marker (§367, §379), made on the server — or null for an event with no partner. */
  partner: string | null;
  /** Inside a grid cell (small type, one line) rather than an agenda row. */
  dense: boolean;
}) {
  const lines = calendarEntryLines({ time, title, note, night, partner });
  const name = calendarEntryName(lines);
  const markSize = dense ? 16 : 18;
  const chip = (
    <NextLink
      href={href}
      aria-label={name}
      // The link's own name, never the tooltip's (see above).
      aria-labelledby={undefined}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
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
          {glyphs.map((glyphName) => {
            const Glyph = GLYPHS[glyphName];
            return <Glyph key={glyphName} sx={{ fontSize: dense ? 14 : 18 }} />;
          })}
        </Box>
        <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: dense ? "nowrap" : "normal", minWidth: 0 }}>
          <Box component="span" sx={{ fontWeight: 600, mr: { xs: 0, sm: 0.5 } }}>
            {time}
          </Box>
          <Box component="span" sx={dense ? { display: { xs: "none", sm: "inline" } } : undefined}>{title}</Box>
        </Box>
        {(partner || note) && (
          // The marks at the end, where the ⚠ always was: the partner, then the date's note.
          <Box component="span" data-testid="calendar-entry-marks" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, flexShrink: 0 }}>
            {partner && (dense ? <PartnerGlyph size={markSize} /> : <PartnerMark text={partner} size={markSize} />)}
            {note && (dense ? <EditionGlyph note={note} size={markSize} /> : <EditionMark note={note} size={markSize} />)}
          </Box>
        )}
      </Box>
    </NextLink>
  );

  // Only where the row cannot show the sentence itself.
  if (!dense) return chip;
  return (
    <Tooltip
      title={
        <Box component="span" sx={{ display: "block" }}>
          {lines.map((line, index) => (
            <Box key={index} component="span" sx={{ display: "block", fontWeight: index === 0 ? 600 : 400 }}>
              {line}
            </Box>
          ))}
        </Box>
      }
      arrow
      enterTouchDelay={0}
    >
      {chip}
    </Tooltip>
  );
}

/**
 * The handshake with no tooltip of its own, inside the grid chip whose tooltip says "Colaborare" /
 * "Partnership". No colour of its own (§391): `currentColor` carries the chip's own ink in,
 * `primary.contrastText` on a filled (race) entry, `text.primary` otherwise.
 */
function PartnerGlyph({ size }: { size: number }) {
  const Icon = GLYPHS.partner;
  return <Icon aria-hidden="true" sx={{ fontSize: size, flexShrink: 0, verticalAlign: "-4px" }} />;
}
