import StickyNote2Icon from "@mui/icons-material/StickyNote2";
import Box from "@mui/material/Box";

/**
 * The marker on a registrations-list row that has internal notes (§777): the sticky-note glyph and the count,
 * in the row's own words («2 note»), so a registration somebody left a note on says so before it is opened.
 * A link to the registration's «Note interne» card (`#note-interne`, which opens the fold), at least 44 pixels
 * high like every control in a row. `ariaLabel` names the person too («Note interne la Ana Pop: 2 note»), so a
 * screen-reader user tabbing the list does not hear the same «2 note» on every marked row.
 *
 * Drawn from plain elements with the glyph as a child, never MUI's `Chip` with an `icon` element, so the list's
 * Server Component may render it (§370: no element prop across the boundary) — `FamilyChip`'s way. Nothing
 * when there is no note: the list draws it only for a role that may keep them, the marker itself is never in the export; the notes are its last column (§785).
 */
export default function NotesMark({ label, ariaLabel, href, testId = "notes-mark" }: { label: string; ariaLabel?: string; href: string; testId?: string }) {
  return (
    <Box
      component="a"
      href={href}
      aria-label={ariaLabel}
      data-testid={testId}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 44,
        color: "text.secondary",
        textDecoration: "none",
        "&:hover, &:focus-visible": { color: "text.primary" },
      }}
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.25,
          border: 1,
          borderColor: "divider",
          borderRadius: 999,
          fontSize: "0.8125rem",
          lineHeight: 1.4,
        }}
      >
        <StickyNote2Icon aria-hidden="true" sx={{ fontSize: "1rem" }} />
        {label}
      </Box>
    </Box>
  );
}
