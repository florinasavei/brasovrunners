/**
 * The listing card's shape, shared by the single-date card (`events/page.tsx`) and the series card
 * (`SeriesCard`), so the two read alike and cannot drift apart (§NNN).
 *
 * The owner, 2026-09-24, with a screenshot of the listing's two-column grid: "There is too much
 * whitespace on these cards, it needs to be better spaced". What the screenshot showed was four
 * separate things, and each has its answer here or next to it:
 *
 * 1. **Holes inside the cards.** A row of cards is as tall as its tallest (§275), and the door to
 *    the page was pushed to the foot of every card, so a short card beside a series card had a
 *    hundred and fifty pixels of nothing between its facts and its own link. Now the door follows
 *    the content and what a row leaves over is below it — see `CARD_BODY_SX`.
 * 2. **An uneven rhythm.** Each piece of a card carried its own margin: a label on a line of its
 *    own, a line of facts, 12 pixels here and 20 there. Now there are two gaps and nothing else:
 *    `LINE_GAP` between the lines of one group (the date and the place; the pills among
 *    themselves), `GROUP_GAP` between groups (the chips, the title, the summary, the facts, the
 *    pills, the doors). The facts' own lines use `LINE_GAP` in `EventFacts`.
 * 3. **Two title styles.** The series card's title was a bare link — underlined, the browser's
 *    blue and, once visited, its purple — and the single card's was plain black text a size too
 *    big. One style now: `CARD_TITLE_SX`.
 * 4. **The facts' shapes** — the pin alone on a line, the tiny glyphs, the middle dots — are
 *    `EventFacts`'s compact form, which now draws the event page's row glyphs and pills (§356).
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
 * *between* cards made the listing look broken), and the body keeps its natural height inside the
 * card, so a short card's door sits right under its facts, where it belongs to them, and the room
 * the taller neighbour needs is at the card's foot — the one place empty space reads as a margin
 * rather than as a gap in the content. Choosing `align-items: start` instead was measured and not
 * taken (§NNN): it gives every card its own height and moves the same hole outside the border,
 * where the row's ragged bottom edge is what the eye reads first.
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
 * The title, on every card: the link to the event, in the text's colour whether visited or not,
 * no underline until a pointer or the keyboard is on it, one size and weight on both cards.
 *
 * The link is 44 pixels tall (BR-REQ-041-01 criterion 6) and gives back the twenty its words do
 * not need as a negative margin, above and below — the event page's `tight` link (§356): the box
 * a thumb hits is the full height, the line it sits on is as tall as its words, so the chips and
 * the summary keep their gaps. Neither neighbour is a link, so the two boxes never overlap a
 * control. A flex item's margin does not collapse, so the heading's own `mt` stays what it says.
 */
export const CARD_TITLE_SX = {
  mt: GROUP_GAP,
  mb: 0,
  fontSize: "1.125rem",
  fontWeight: 600,
  lineHeight: 1.3,
  overflowWrap: "anywhere",
  "& a": {
    display: "flex",
    alignItems: "center",
    minHeight: 44,
    my: "-10px",
    color: "text.primary",
    textDecoration: "none",
    borderRadius: 1,
    "&:hover": { textDecoration: "underline" },
    "&:focus-visible": { textDecoration: "underline", outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
  },
} as const;

/**
 * The single-date card is one press wherever it is pressed, as it was — and one link, as it was
 * not: the whole card used to be one `<a>` whose accessible name was every word on the card. Now
 * the title is the link, and its `::after` is stretched over the card (the card is the containing
 * block), so a press anywhere on the card is a press on the title, a screen reader hears the
 * title, and nothing is a link inside a link. The door stands above the stretched box
 * (`CARD_DOOR_SX`) so it takes its own presses. Only the single card: a series card holds a fold
 * and a link per date, and a card-sized target under those would take every near miss.
 */
export const CARD_STRETCHED_TITLE_SX = {
  ...CARD_TITLE_SX,
  "& a": {
    ...CARD_TITLE_SX["& a"],
    "&::after": { content: '""', position: "absolute", inset: 0 },
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
 * Where the door to the page sits: right after the content, above a stretched title's box. Four
 * pixels of margin, because its 44-pixel box already holds about thirteen invisible pixels above
 * its line on a wide card — `GROUP_GAP` and a little, as the eye measures it — and only four once
 * its words wrap onto two lines on a 320-pixel phone, where the four keep it off the pills.
 */
export const CARD_DOOR_SX = { position: "relative", zIndex: 1, mt: 0.5 } as const;
