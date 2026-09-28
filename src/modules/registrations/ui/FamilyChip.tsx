import FamilyRestroomIcon from "@mui/icons-material/FamilyRestroom";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";

/**
 * The family marker (§543; the owner, 2026-09-28: «trebuie un marker pentru familie»): a small pill
 * with the family glyph, the word («Familie» / "Family") and the other people on the same address —
 * each a link when the surface has a page for them (the backoffice registration's siblings).
 *
 * Drawn from plain elements with the glyph as a child, never MUI's `Chip` with an `icon` element, so
 * any Server Component may render it (§370: no element prop across the boundary). One icon file,
 * imported directly, like every glyph on a public page (§521). Nothing when there is nobody else.
 */
export default function FamilyChip({
  label,
  members,
  testId = "family-chip",
}: {
  /** «Familie» / "Family", already translated by the caller. */
  label: string;
  /** The other people on the address, in the order they registered; `href` makes a name a link. */
  members: ReadonlyArray<{ name: string; href?: string }>;
  testId?: string;
}) {
  if (members.length === 0) return null;
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 0.5,
        px: 1,
        py: 0.25,
        border: 1,
        borderColor: "divider",
        borderRadius: 999,
        fontSize: "0.8125rem",
        lineHeight: 1.4,
        color: "text.secondary",
        verticalAlign: "middle",
      }}
    >
      <FamilyRestroomIcon aria-hidden="true" sx={{ fontSize: "1rem" }} />
      <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>
        {label}
      </Box>
      <Box component="span">
        {members.map((member, index) => (
          <Box component="span" key={`${index}-${member.name}`}>
            {index > 0 ? ", " : ""}
            {member.href ? <MuiLink href={member.href}>{member.name}</MuiLink> : member.name}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
