import { TAP_TARGET } from "./tap-target";

/**
 * What a fold looks like, in one place (`DECISIONS.md` §164; the owner, of the calendar feed's
 * address: "it's not clear that this is expandable").
 *
 * Three things make a `<summary>` read as a control, and each one had been dropped somewhere:
 *
 * 1. **The marker.** MUI's reset removes the disclosure triangle, so it is asked back with
 *    `listStyle: "revert"` — and `display` is left alone. `display: flex` on a `<summary>`
 *    removes the marker in Chrome and Safari, which is how a fold ends up as grey text; the
 *    height comes from padding here, never from a flex box.
 * 2. **The pointer**, so the cursor says "press me".
 * 3. **An underline on hover and on keyboard focus**, the affordance a link has, because a
 *    marker alone is four pixels of grey on a phone.
 *
 * It carries the 44-pixel rule with it (BR-REQ-041-01 criterion 6), so a fold on a public
 * page is already a thumb's target, and the native element keeps the keyboard behaviour.
 *
 * The one deliberate exception is the events listing's "other events" heading, which hides
 * its marker from `sm` up because on a wide screen it is always open and is not a control.
 */
/**
 * The arrow on the heading's own line (§325; the owner, of the editor's "Rezumat" fold: "I would
 * like this arrow to be aligned with the text", then "same for all accordions").
 *
 * The browser's marker is a list-item marker, and a summary whose child is a block — a
 * Typography heading, a Stack — puts that block on the line *under* the marker, which is how
 * every section title of the event editor came to sit below its triangle. So the summary is a
 * flex row now and draws its own arrow: the native marker is hidden (`list-style: none`, the
 * WebKit pseudo-element, `::marker`), and a CSS triangle in `currentColor` stands before the
 * text, centred on it, turning a quarter when the fold is open. The warning above about
 * `display: flex` removing the triangle is answered, not ignored: the triangle is ours now.
 *
 * The open turn is written twice because this object is used two ways — directly on a
 * `component="summary"` (then `details[open] > &` is the summary), and spread under
 * `"& > summary"` from the `<details>` (then `DISCLOSURE_OPEN_ARROW` at the details level does
 * it, and the nested rule simply never matches).
 */
const ARROW = {
  content: '""',
  flex: "none",
  width: 0,
  height: 0,
  borderStyle: "solid",
  borderWidth: "0.32em 0 0.32em 0.5em",
  borderColor: "transparent transparent transparent currentColor",
} as const;

/** Spread into a `<details>`'s `sx`: the arrow turns when the fold is open. */
export const DISCLOSURE_OPEN_ARROW = { "&[open] > summary::before": { transform: "rotate(90deg)" } } as const;

export const DISCLOSURE_SUMMARY_SX = {
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 1,
  listStyle: "none",
  "&::-webkit-details-marker": { display: "none" },
  "&::marker": { content: '""' },
  "&::before": ARROW,
  "details[open] > &::before": { transform: "rotate(90deg)" },
  py: 1.25,
  ...TAP_TARGET,
  "&:hover": { textDecoration: "underline" },
  "&:focus-visible": { textDecoration: "underline" },
} as const;

/** The same, addressed from the `<details>`: spread into a `Box component="details"`'s `sx`. */
export const DISCLOSURE_SX = { "& > summary": DISCLOSURE_SUMMARY_SX, ...DISCLOSURE_OPEN_ARROW } as const;

/**
 * The backoffice fold, as a box (`DECISIONS.md` §269 and its follow-up; the owner, looking at
 * the bib-design panel and the event editor: "toate aceste acordeoane din zona de backoffice
 * trebuie sa fie mai 'boxed'").
 *
 * The same summary as above — marker, pointer, underline, 44 pixels — drawn as the header row
 * of a bordered box: a hairline in `divider`, the corner radius every other box in the
 * backoffice has, the surface colour behind the body, and a wash of `action.hover` behind the
 * summary so it reads as a bar and not as a line of text with a triangle in front of it. Open,
 * the box stays: the summary keeps its wash, squares its bottom corners and gets a rule under
 * it, and the body is padded so text never touches the border. Theme tokens throughout, so the
 * dark scheme follows without a second rule (`AGENTS.md` §3.2: no colour outside `brand.ts`).
 *
 * **The box pads; the summary un-pads itself.** The fold's children are whatever the screen
 * puts there — a form, an ordered list, a `Stack` — so the horizontal padding is on the
 * `<details>` and the summary reaches the border with a negative margin of the same size. A
 * padding rule on `> :not(summary)` would have beaten every `pl` an ordered list sets, and a
 * wrapper element would have had to be added at twenty call sites. The vertical padding under
 * the body is on `[open]` only, so a closed fold is exactly its summary.
 *
 * Public pages keep `DISCLOSURE_SX`: a fold on the registration form or in the footer is a
 * line in a column of prose, and a box there would be a card in the middle of a sentence.
 *
 * A fold that is deliberately a different colour — the erase panel's red, the batch cancel's
 * amber — spreads this and overrides `borderColor`, so it keeps the shape and the row and says
 * only what is different about it.
 */
export const BOXED_DISCLOSURE_SX = {
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  px: 2,
  bgcolor: "background.paper",
  "& > summary": {
    ...DISCLOSURE_SUMMARY_SX,
    mx: -2,
    px: 2,
    bgcolor: "action.hover",
    borderRadius: "inherit",
  },
  ...DISCLOSURE_OPEN_ARROW,
  "&[open] > summary": {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottom: 1,
    borderColor: "divider",
    mb: 1.5,
  },
  "&[open]": { pb: 1.5 },
} as const;
