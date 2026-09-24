import Typography from "@mui/material/Typography";
import { CLUB_NAME, FONT, WORDMARK, WORDMARK_SIZE } from "@/theme/brand";

/**
 * `BRASOV RUNNERS` in the kit face, as it is printed on the shirt. It heads three public pages
 * and nothing else: the listing (the homepage, `BR-V1.32`), and since 2026-09-22 the calendar
 * and the contact page — the owner: "trebuie sa vad acest scris frumos cu Brasov Runners si pe
 * pagina de contact si pe cea de calendar" (`DECISIONS.md` §292). The header still carries the artwork lockup, which has its own lettering
 * (§58), and an event page or a legal text is the event's or the text's, not the club's — so a
 * fourth page is a decision, and `tests/unit/theme/wordmark.test.ts` pins the three.
 *
 * A page heading, not navigation: a paragraph that is an image to assistive technology, never
 * an `<h1>`, so each page keeps its own.
 *
 * The visible text is unaccented — a logotype, not the club's name, and safe only because it is
 * pure ASCII: Facón has no Romanian characters. So the element is an image to assistive
 * technology, named from the club's one constant (`CLUB_NAME`, §NNN), and announces the name
 * spelled properly rather than the kit's spelling.
 *
 * A Server Component: it renders one span and needs nothing from the client.
 */
export default function Wordmark() {
  return (
    <Typography
      component="p"
      role="img"
      aria-label={CLUB_NAME}
      sx={{
        // Facón is one style: black, italic. Both are stated so the fallback, Roboto, lands in
        // the same weight and slant if the font has not arrived yet.
        fontFamily: `${FONT.wordmark}, ${FONT.fallback}`,
        fontWeight: 900,
        fontStyle: "italic",
        fontSize: WORDMARK_SIZE,
        lineHeight: 1,
        // The face is wide and tightly fitted; a little tracking stops the letters touching.
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        color: "primary.main",
        m: 0,
      }}
    >
      {WORDMARK}
    </Typography>
  );
}
