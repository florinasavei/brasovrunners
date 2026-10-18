import Box from "@mui/material/Box";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The «N vin» chip on an upcoming turn-up event's card (§812, «Vin!» part 2): the people glyph and the count, a link to the event
 * page's «Vii?» card (`#vin`, `RSVP_BOX_ID`). Drawn only for an event the page offers the answer to and at least one person has
 * confirmed (`readPublicComing`, the same rule the card applies) — a card of an event with nobody yet says nothing, since «0 vin» is
 * not an invitation and the page has the sentence for it.
 *
 * `ResultsChip`'s shape (§809): **the link is the 44-pixel box, the chip is its content.** A `GlyphChip` with an `href` is a 24-pixel
 * anchor, and every link on a card is held to 44 pixels in both directions (BR-REQ-041-01 criterion 6, measured by
 * `listing-cards.spec.ts`), so the anchor is made here and the chip inside it is the plain, roleless one. A strings-only component: the
 * address and the words are made by the caller, and the glyph crosses to the client island by name.
 */
export default function ComingChip({ href, label }: { href: string; label: string }) {
  return (
    <Box
      component="a"
      href={href}
      data-testid="coming-chip"
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
      <GlyphChip glyph="coming" label={label} variant="outlined" />
    </Box>
  );
}
