/**
 * The listing card's shape, shared by the single-date card (`EventCard`) and the series card
 * (`SeriesCard`), so the two are one structure and cannot drift apart (§366).
 *
 * The owner, 2026-09-24, with a screenshot of the listing's two-column grid: "There is too much
 * whitespace on these cards, it needs to be better spaced" — then, of the one-off "Trail to Road cu
 * Brașov Running Festival" beside two series cards: "I am missing the blue link for this event,
 * why?", "I do not see the google maps link for this event, although I've put the maps URL". What
 * the screenshot showed, and where each answer is:
 *
 * 1. **Two card structures.** The single-date card was one `<a>` wrapping the whole card, its title
 *    a black heading; the series card's title was a blue link. A link cannot hold another link, so
 *    the single card's place could not be its map link. Now neither card is a link: on both the
 *    title is the link, in one blue style (`CARD_TITLE_SX`), and the place is free to be the map.
 * 2. **Holes inside the cards.** A row of cards is as tall as its tallest (§275), and the door to
 *    the page was pushed to the foot of every card, so a short card beside a series card had a
 *    hundred and fifty pixels of nothing between its facts and its own link. Now the door follows
 *    the content and what a row leaves over is below it — see `CARD_BODY_SX`.
 * 3. **An uneven rhythm.** Each piece of a card carried its own margin: a label on a line of its
 *    own, a line of facts, 12 pixels here and 20 there. Now there are two gaps and nothing else:
 *    `LINE_GAP` between the lines of one group (the title, a series' rhythm and the summary under
 *    it; the date and the place; the pills among themselves), `GROUP_GAP` between groups (the
 *    chips, the title's group, the facts, the pills, the doors). The facts' own lines use them in
 *    `EventFacts`. The one exception is the door's four pixels (`CARD_DOOR_SX`), which its own
 *    invisible 44-pixel box makes up to a group's gap.
 * 4. **The facts' shapes** — the pin alone on a line, the tiny glyphs, the middle dots, the
 *    partner's sentence among the numbers — are `EventFacts`'s compact form, which now draws the
 *    event page's row glyphs, its clock and its pills (§356).
 *
 * Plain objects, never functions: they are handed as `sx` from Server Components to MUI's client
 * components, and a function cannot cross that boundary (`theme/surfaces.ts` has the story).
 */
import { DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX } from "@/shared/ui/disclosure";

/** Between two lines of one group: the date and the place, the pills among themselves. */
export const LINE_GAP = 1;

/** Between two groups: the chips, the title, the summary, the facts, the pills, the doors. */
export const GROUP_GAP = 1.5;

/**
 * The card's body: a column, so every gap is the margin written on the child and none collapses
 * into another (a flex item never shares its margin with its neighbour or its parent).
 *
 * **The leftover is below the door, not above it.** Cards in a row keep one height (§275: a hole
 * *between* cards made the listing look broken, and the owner decided rows of equal cards), and
 * the body keeps its natural height inside the card, so a short card's door sits right under its
 * facts, where it belongs to them, and the room the taller neighbour needs is at the card's foot —
 * the one place empty space reads as a margin rather than as a gap in the content. Choosing
 * `align-items: start` instead was weighed and not taken (§366): it gives every card its own
 * height and moves the same room outside the border, where the row's ragged bottom edge is what
 * the eye reads first — the very thing §275 was decided against.
 *
 * The padding is `CardContent`'s sixteen pixels on three sides. At the foot it is four, because
 * the last thing in every card is the door — a 44-pixel box (BR-REQ-041-01 criterion 6) around an
 * 18-pixel line — whose own invisible margin makes the rest of a visible sixteen.
 */
export const CARD_BODY_SX = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  px: 2,
  pt: 2,
  pb: 0.5,
  minWidth: 0,
} as const;

/** The chips at the top of a card: one wrapping row, six pixels apart. */
export const CARD_CHIPS_SX = { display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" } as const;

/**
 * The title, on every card: the link to the event (the owner: "I am missing the blue link for this
 * event, why?"), in the club's blue — the theme's primary, the same blue visited or not, never the
 * browser's purple — with no underline until a pointer or the keyboard is on it, one size and
 * weight on both cards. The size and weight are the ones both cards' titles already had (1.25rem,
 * the `h2` variant's 500, a weight the site's Roboto is loaded in): the colour and the structure
 * were what differed, and they are what changed.
 *
 * The link is a block at least 44 pixels tall (BR-REQ-041-01 criterion 6), and the room it adds
 * around its words is padding given back as an equal negative margin, so the line the title takes
 * in the card is as tall as its words. Padding rather than the page's `minHeight` alone, because a
 * title that wraps onto two lines is already taller than 44 — a fixed negative margin on it would
 * pull the summary up into its second line; the padding grows with the words and the margin only
 * ever cancels the padding. A flex item's margin does not collapse, and a flex item holds its
 * child's margins inside itself, so the heading's `mt` stays what it says.
 *
 * **The reach is uneven, and never more than the gap on its side** (§366). Whatever comes after
 * the title in the page paints over it, and so takes a press on any pixel the two share: the
 * series card's rhythm line sat four pixels under the words when the link reached ten, and the
 * part of the 44 a finger could still hit was about 40 (42 above a summary) — while a measure of
 * the link's own box said 44. So the link reaches below its words by exactly `LINE_GAP`, the
 * nearest anything is ever put under a title (the rhythm and the summary; the facts are a group's
 * gap away), and takes the rest of its 44 above them: 10 = 44 − 26 (one line of 1.25rem at 1.3)
 * − 8, less than the chips' `GROUP_GAP` above. Nothing overlaps it on either side, whichever
 * neighbour follows, and `listing-cards.spec.ts` presses its edges to prove it. Neither neighbour
 * is a link, so the reach never covers another control.
 *
 * **`border-box`, said here, or none of the arithmetic above holds** (§366). The cards usually
 * stand inside a `<details>` — the "other events" fold under a lead event (§78) — and the browser
 * slots a fold's content into the fold's own shadow tree, where MUI's `box-sizing: inherit` does
 * not reach: everything in it is `content-box`. There the 44 was the words' box and the eighteen
 * were added around it: a 62-pixel link, a heading 44 tall rather than its words' 26, and eighteen
 * more pixels between the title and the line under it than the gap says — on a listing the owner
 * had asked to be tighter. Nothing overlapped, so the edge presses passed; the browser measure of
 * the heading against its words is what found it.
 */
export const CARD_TITLE_SX = {
  mt: GROUP_GAP,
  mb: 0,
  fontSize: "1.25rem",
  fontWeight: 500,
  lineHeight: 1.3,
  overflowWrap: "anywhere",
  "& a": {
    display: "block",
    boxSizing: "border-box",
    minHeight: 44,
    pt: "10px",
    mt: "-10px",
    pb: LINE_GAP,
    mb: -LINE_GAP,
    color: "primary.main",
    textDecoration: "none",
    borderRadius: 1,
    "&:visited": { color: "primary.main" },
    "&:hover": { textDecoration: "underline" },
    "&:focus-visible": { textDecoration: "underline", outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
  },
} as const;

/**
 * The series card's "Următoarele date (8)" fold: the site's fold (`DISCLOSURE_SX` — the arrow, the
 * pointer, the underline, the 44 pixels) without the ten pixels of padding it adds above and below
 * them. A `<summary>` sizes its content box, so those twenty made the fold 64 pixels tall, and two
 * 44-pixel controls one under the other — the fold and the door — already hold twenty-five
 * invisible pixels between their words; the extra twenty were one of the gaps the owner saw.
 */
export const CARD_FOLD_SX = {
  ...DISCLOSURE_SX,
  "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 0 },
} as const;

/**
 * Where the door to the page sits: right after the content. Four pixels of margin, because its
 * 44-pixel box already holds about thirteen invisible pixels above its line on a wide card —
 * `GROUP_GAP` and a little, as the eye measures it — and only four once its words wrap onto two
 * lines on a 320-pixel phone, where the four keep it off the facts.
 */
export const CARD_DOOR_SX = { mt: 0.5 } as const;
