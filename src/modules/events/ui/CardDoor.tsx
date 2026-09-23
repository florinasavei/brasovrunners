import ReadMoreIcon from "@mui/icons-material/ReadMore";
import Box from "@mui/material/Box";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * "Descrierea completă a evenimentului" on a listing card (`DECISIONS.md` §305), shared by the
 * series card and the single-date card so the two read alike.
 *
 * A link that looks like a link, with a glyph, not a button (§319; the owner, twice: "should be
 * smaller and not in caps", then "sunt încă prea mari și nu au iconițe!"). The outlined MUI
 * button of §305 and §308 was a 44-pixel box with a border — however small its type, it read as
 * the card's main control, which is the registration button's job on the event page, not this
 * one's. Now: the "read more" glyph, sentence case, a small bold type in the primary colour, no
 * border, an underline on hover and a visible focus ring. The height stays at the 44 pixels
 * BR-REQ-041-01 criterion 6 asks of anything a thumb must hit — an invisible box around the text,
 * not a drawn one.
 *
 * A Server Component: the glyph is rendered here, never passed as a prop to a client component
 * (the hydration defect `shared/ui/action-icons.ts` documents), and the anchor needs no island.
 */
export default function CardDoor({ href, label }: { href: string; label: string }) {
  return (
    <Box
      component="a"
      href={href}
      sx={{
        ...TAP_TARGET,
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        px: 0.5,
        mx: -0.5,
        borderRadius: 1,
        fontSize: "0.875rem",
        fontWeight: 600,
        lineHeight: 1.3,
        color: "primary.main",
        textDecoration: "none",
        "&:hover": { textDecoration: "underline" },
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
      }}
    >
      <ReadMoreIcon aria-hidden="true" sx={{ fontSize: 20 }} />
      {label}
    </Box>
  );
}
