import Box from "@mui/material/Box";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The «Clasament» chip on a finished race's card (§809, race results part 2): the leaderboard glyph and the word, a link to the
 * event page's `#clasament`. Drawn only for an event whose results are on show (`eventsWithResultsChip`, the same rule the section applies).
 *
 * **The link is the 44-pixel box, the chip is its content.** A `GlyphChip` with an `href` is a 24-pixel anchor, and every link on a
 * card is held to 44 pixels in both directions (BR-REQ-041-01 criterion 6, measured by `listing-cards.spec.ts`), so the anchor is
 * made here and the chip inside it is the plain, roleless one. A strings-only component: the address and the word are made by the caller.
 */
export default function ResultsChip({ href, label }: { href: string; label: string }) {
  return (
    <Box
      component="a"
      href={href}
      data-testid="results-chip"
      sx={{
        ...TAP_TARGET,
        minWidth: 44,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "inherit",
        textDecoration: "none",
        borderRadius: 1,
        "&:hover .MuiChip-root": { bgcolor: "action.hover" },
        "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
      }}
    >
      <GlyphChip glyph="results" label={label} variant="outlined" />
    </Box>
  );
}
