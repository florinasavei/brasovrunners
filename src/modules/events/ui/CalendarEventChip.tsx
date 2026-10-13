"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import NextLink from "next/link";
import { UNDER_LOOK } from "@/theme/look";
import type { CalendarTone } from "../domain/calendar-kind";
import { PAST_ENTRY_SX, toneDotSx, toneEntrySx } from "./calendar-tone-sx";
import EditionMark, { EditionGlyph, type EditionNote } from "./EditionMark";
import { GLYPHS, type GlyphName } from "./glyphs";
import PartnerMark from "./PartnerMark";

/**
 * What the calendar says about one entry, line by line (§367): the time and the whole title, then
 * the date's note when it has one (§122 — "Nu în locul obișnuit: …"), then "Eveniment de noapte —
 * apusul la 16:36" when that date starts after dusk (§394, where §382 put the headlamp) — after the
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
  tone = "other",
  past = null,
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
  /** "Eveniment de noapte: începe la 19:00, apusul la 16:36" / "Night event: starts at 19:00, sunset at 16:36" (§394, §404), made on the server — or null for a date that is not one. */
  night?: string | null;
  /** The generic "Colaborare" marker (§367, §379), made on the server — or null for an event with no partner. */
  partner: string | null;
  /** Inside a grid cell (small type, one line) rather than an agenda row. */
  dense: boolean;
  /**
   * The date's colour under «Aspectul nou» (phase 4, `calendarTone`): a weekly run, a special event
   * or another date, with a dot before the glyphs — the legend under the grid says each colour's
   * word. Off, nothing reads it. A string, so it crosses from the Server Component as data; the grey when unsaid.
   */
  tone?: CalendarTone;
  /**
   * The word for a date on a day already gone ("a trecut" / "past", §NNN), or null for today and
   * the days ahead. Under «Tema v2» the entry is drawn faded (`PAST_ENTRY_SX`); the word is said
   * after the name to a screen reader under Tema v2 only (it is passed only there), and never drawn.
   */
  past?: string | null;
}) {
  const lines = calendarEntryLines({ time, title, note, night, partner });
  const name = calendarEntryName(lines);
  // A date on a day gone says so after its sentence, for a screen reader (§NNN): one more, ended like the others.
  const label = past ? calendarEntryName([...lines, past]) : name;
  // A past date wears the faded look in place of its kind's colours; a date from today on, its kind's.
  const lookSx = past ? PAST_ENTRY_SX : toneEntrySx(tone);
  const markSize = dense ? 16 : 18;
  const chip = (
    <NextLink
      href={href}
      aria-label={label}
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
          ...lookSx,
          // Under the look, a grid entry from `sm` is two parts (the mock-up's): the dot, the glyphs
          // and the time on the first line, the marks at its end, and the whole title under them on
          // up to two lines — the title used to be cut after a letter or two. A phone's 40-pixel
          // column keeps the stack of glyphs over the time.
          ...(dense ? { [UNDER_LOOK]: { ...lookSx[UNDER_LOOK], ...DENSE_UNDER_LOOK } } : {}),
        }}
        data-tone={tone}
        data-past={past ? "" : undefined}
      >
        {/* The kind's dot, under the new look only; in a phone's 40-pixel column the fill says it alone. */}
        <Box
          component="span"
          aria-hidden="true"
          data-entry-dot
          sx={dense ? { ...toneDotSx(tone), [UNDER_LOOK]: { ...toneDotSx(tone)[UNDER_LOOK], display: { xs: "none", sm: "inline-block" } } } : toneDotSx(tone)}
        />
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, flexShrink: 0 }} aria-hidden="true">
          {glyphs.map((glyphName) => {
            const Glyph = GLYPHS[glyphName];
            return <Glyph key={glyphName} sx={{ fontSize: dense ? 14 : 18 }} />;
          })}
        </Box>
        <Box component="span" data-entry-text sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: dense ? "nowrap" : "normal", minWidth: 0 }}>
          <Box component="span" data-entry-time sx={{ fontWeight: 600, mr: { xs: 0, sm: 0.5 } }}>
            {time}
          </Box>
          <Box component="span" data-entry-title sx={dense ? { display: { xs: "none", sm: "inline" } } : undefined}>{title}</Box>
        </Box>
        {(partner || note) && (
          // The marks at the end, where the ⚠ always was: the partner, then the date's note.
          <Box component="span" data-testid="calendar-entry-marks" data-entry-marks sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, flexShrink: 0 }}>
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
 * A grid entry under the look, from `sm`: the text's span steps aside (`display: contents`) so the
 * time and the title are the row's own items; the row wraps, the title takes a line of its own and
 * keeps two lines of the name before an ellipsis. Every rule starts at `sm` (or names its `xs` value), so a
 * phone's column is drawn exactly as before.
 */
const DENSE_UNDER_LOOK = {
  flexWrap: { xs: "nowrap", sm: "wrap" },
  rowGap: { sm: 0.125 },
  py: { sm: 0.625 },
  px: { sm: 0.875 },
  lineHeight: { sm: 1.25 },
  "& [data-entry-text]": { display: { xs: "block", sm: "contents" } },
  "& [data-entry-time]": { fontSize: { sm: "0.78rem" }, fontWeight: 700 },
  "& [data-entry-marks]": { ml: { sm: "auto" } },
  "& [data-entry-title]": {
    display: { xs: "none", sm: "-webkit-box" },
    flexBasis: { sm: "100%" },
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    whiteSpace: "normal",
    fontWeight: 500,
    fontSize: { sm: "0.75rem" },
    wordBreak: "break-word",
  },
} as const;

/**
 * The handshake with no tooltip of its own, inside the grid chip whose tooltip says "Colaborare" /
 * "Partnership". No colour of its own (§391): `currentColor` carries the chip's own ink in,
 * `primary.contrastText` on a filled (race) entry, `text.primary` otherwise.
 */
function PartnerGlyph({ size }: { size: number }) {
  const Icon = GLYPHS.partner;
  return <Icon aria-hidden="true" sx={{ fontSize: size, flexShrink: 0, verticalAlign: "-4px" }} />;
}
