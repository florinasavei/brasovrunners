import StickyNote2Icon from "@mui/icons-material/StickyNote2";
import Box from "@mui/material/Box";

/**
 * The marker on a registrations-list row that has internal notes (§NNN): the sticky-note glyph and the count,
 * in the row's own words («2 note»), so a registration somebody left a note on says so before it is opened.
 * A link to the registration's «Note interne» card (`#note-interne`, which opens the fold), at least 44 pixels
 * high like every control in a row.
 *
 * Drawn from plain elements with the glyph as a child, never MUI's `Chip` with an `icon` element, so the list's
 * Server Component may render it (§370: no element prop across the boundary) — `FamilyChip`'s way. Nothing
 * when there is no note: the list draws it only for a role that may keep them, and never into the export.
 */
export default function NotesMark({ label, href, testId = "notes-mark" }: { label: string; href: string; testId?: string }) {
  return (
    <Box
      component="a"
      href={href}
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
