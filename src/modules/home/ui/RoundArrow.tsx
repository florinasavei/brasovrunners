import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import Box from "@mui/material/Box";

/**
 * The round arrow on a home-page card (`docs/REDESIGN.md`, decision 10, by its default: only on the
 * home page's cards, keeping the whole-card tap; the listing keeps its text door, §319). Drawn, not a
 * link: the card's title is the one link and covers the card (`HOME_CARD_TITLE_SX`), so the arrow is
 * a picture of «go on» inside the press, `aria-hidden`, and a screen reader meets the title alone.
 * 44 pixels, the size of what a thumb aims at. The arrow is the one glyph file (§498).
 */
export default function RoundArrow() {
  return (
    <Box
      component="span"
      aria-hidden="true"
      data-testid="round-arrow"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 44,
        height: 44,
        flexShrink: 0,
        borderRadius: "50%",
        border: 1,
        borderColor: "primary.main",
        color: "primary.main",
      }}
    >
      <ArrowForwardIcon sx={{ fontSize: 20 }} />
    </Box>
  );
}
