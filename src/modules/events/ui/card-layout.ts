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
 *    Since §486 that title link is stretched over the card (`CARD_TAP_SX`), so the whole card is one
 *    tap to the page while the map, the dates and the doors stay links of their own.
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
import { DENSITY } from "@/theme/density";

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
 * The padding is `CardContent`'s sixteen pixels on three sides — twelve on a phone at the top
 * (`DENSITY.cardPadTop`, §380), the owner's "too much whitespace" on the listing. Only the top
 * shrinks: the sides stay the sixteen pixels `EventFacts.tsx`'s width budget was measured
 * against (§366, §375), and the density scale says so explicitly rather than leaving it a
 * silent exception. At the foot it is four, because the last thing in every card is the door —
 * a 44-pixel box (BR-REQ-041-01 criterion 6) around an 18-pixel line — whose own invisible
 * margin makes the rest of a visible sixteen.
 */
export const CARD_BODY_SX = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  px: 2,
  pt: { xs: DENSITY.cardPadTop, sm: 2 },
  pb: 0.5,
  minWidth: 0,
} as const;

/**
 * The leading glyph of every row on the event page's facts (§356): one size, one colour, one
 * alignment, whichever question the row answers. The owner, 2026-09-24: "address with address
 * icons not consistent". One object, so a row cannot drift from the others; the unit test reads
 * the class Emotion gives it and finds the same one on every row. Here rather than in
 * `EventFacts` since the card's registration line (`CardRegistration`, §409) draws it too.
 */
export const ROW_ICON_SX = { fontSize: 20, color: "text.secondary", verticalAlign: "middle", mr: 1, flexShrink: 0 } as const;

/**
 * **The whole card is one tap to the event's page, its own links kept** (§486, reversing what §366
 * refused and §113 rejected). The owner wanted a press anywhere on a card — its summary, its
 * pills, the room below the door — to open the page, as every other listing on a phone does; §366
 * had made only the title the link, so a thumb on the card's words did nothing. The rhythm is not
 * one of them: its repeat chip says the series' rule in a tooltip (§486), so it is lifted like
 * every pill with a tooltip and a tap on «Săptămânal» shows the rule rather than opening the page.
 *
 * Still no card is an `<a>`: a link cannot hold the map link, the dates or the registration button
 * (§366's reason stands). The title's link is *stretched* instead — its `::after` covers the card
 * (`CARD_TITLE_SX`) — and every control of the card's own is lifted above that cover here, so a
 * press on the map, a date, the fold, the door, the registration button or a pill with a tooltip
 * (the night pill's sunset, §415 — `GlyphChip` marks it `data-has-tooltip`) still reaches it. A
 * screen reader and the keyboard meet exactly the links they met before: the cover is the title's
 * link, not a new one.
 *
 * - `position: relative` makes the card the cover's box; MUI's `Card` already clips to its border.
 * - `isolation: isolate` keeps the cover's `z-index` inside the card, never above the header.
 * - The lift is `.card :where(…)`: the `:where` adds nothing, but the card's class still counts
 *   (0,1,0), so it is *not* weightless. The title's own rule (`.title a`, 0,1,1) outranks it, so the
 *   title's link stays `static` and its cover measures the card rather than the title. A child whose
 *   own single-class rule sets `position: absolute` (a film's play overlay, were one ever in the
 *   excerpt) ties with the lift and wins only by coming later in Emotion's sheet — which a child's
 *   rule does, being inserted after the card's; mind that before lifting anything else here.
 * - **A film is lifted whole** (§486): a card's summary may hold a YouTube film (§417), and the
 *   lift of its `summary` alone let the play press through, then left the player, its own controls
 *   and the volume glyph (§478) under the cover. `VideoFacade` marks its root `data-lifted`, which
 *   this rule lifts like a control, so every press on the film is the film's; a press beside it
 *   still opens the page. Anything else that must keep its presses on a card wears the same mark.
 * - **The focus ring is the card's** (§486): the title's link now targets the whole card, so while
 *   the keyboard is on that link the card wears the ring (`:has(h2 a:focus-visible)`) and the title
 *   keeps only its underline. A focused map link, date or door keeps its own ring. A browser without
 *   `:has` keeps the title's own ring (`CARD_TITLE_SX` removes it only under `@supports selector(:has(a))`).
 * - Anything else positioned on the card (the weather pill, a picture's frame) stays under the
 *   cover: the cover's `z-index` is 1, not `auto`, so a positioned element later in the card does
 *   not take the press by painting over it.
 *
 * Paid for: the words on a card can no longer be selected with a drag (the event page has them
 * all). Plain objects, as everything here (see the head of this file).
 */
export const CARD_TAP_SX = {
  position: "relative",
  isolation: "isolate",
  "& :where(a, button, summary, [data-has-tooltip], [data-lifted])": { position: "relative", zIndex: 2 },
  "&:has(h2 a:focus-visible)": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
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
 *
 * **The link's cover** (§486): its `::after` is laid over the whole card (`CARD_TAP_SX` makes the
 * card its box), so a press anywhere on the card that is not one of its own controls is a press on
 * this link. The link itself stays `static`, or the cover would measure the title alone.
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
    // The ring is the card's (`CARD_TAP_SX`, §486): the link's target is the whole card now. Only
    // where the card can draw it — a browser without `:has` keeps the link's own ring.
    "&:focus-visible": {
      textDecoration: "underline",
      outline: "2px solid",
      outlineColor: "primary.main",
      outlineOffset: 2,
      "@supports selector(:has(a))": { outline: "none" },
    },
    position: "static",
    "&::after": { content: '""', position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 },
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

/**
 * The listing's one grid of cards (§470): one column on a phone, two from `md`, three from `xl` —
 * every card the same width, the featured one included (the owner, 2026-09-26: "nu neaparat mai lat
 * pe desktop, e ok sa afisam 2 sau 3 carduri, dar toate cardurile trebuie sa aiba aceeasi latime").
 * The upcoming list and the past fold (§267) share it, so the two cannot drift apart — and since
 * §579 the editor's preview before saving draws its card in it, at the listing's own widths.
 *
 * Every card in a row is as tall as the tallest (§275): `start` left a short card beside a tall one
 * and a hole under it, which is what made the listing look broken. The room a short card is given
 * is at its foot, under its door (§366, `CARD_BODY_SX`).
 */
export const CARD_GRID_SX = {
  listStyle: "none",
  p: 0,
  m: 0,
  display: "grid",
  gap: { xs: DENSITY.cardGridGap, sm: 1.5 },
  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
  alignItems: "stretch",
} as const;
