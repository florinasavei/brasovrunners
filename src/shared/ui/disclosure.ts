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
export const DISCLOSURE_SUMMARY_SX = {
  cursor: "pointer",
  listStyle: "revert",
  py: 1.25,
  ...TAP_TARGET,
  "&:hover": { textDecoration: "underline" },
  "&:focus-visible": { textDecoration: "underline" },
} as const;

/** The same, addressed from the `<details>`: spread into a `Box component="details"`'s `sx`. */
export const DISCLOSURE_SX = { "& > summary": DISCLOSURE_SUMMARY_SX } as const;

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
    // The marker inside the summary's own box, so it sits in the padding and not outside the
    // border the negative margin just reached. It is what the HTML rendering section says a
    // summary's marker is anyway (`disclosure-closed inside`); written out so the reset cannot
    // take it back.
    listStylePosition: "inside",
    bgcolor: "action.hover",
    borderRadius: "inherit",
  },
  "&[open] > summary": {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottom: 1,
    borderColor: "divider",
    mb: 1.5,
  },
  "&[open]": { pb: 1.5 },
  /*
    A refusal is never folded away (§NNN). Backoffice folds start closed, and a kept form's
    refusal (§315) comes back as the form's state, which the server rendering the fold around it
    cannot see. With JavaScript on nothing re-renders the fold the person opened to press, and
    `ActionForm` opens the folds around its summary anyway; with JavaScript off the refused POST
    renders the page afresh, the fold arrives shut, and the summary with the boxes as typed would
    be behind a line that says nothing happened. So while a refusal summary (`ActionForm`'s
    `form-refusal…` id) is inside a closed fold, the fold's body is shown regardless — the
    `::details-content` part is where the browser hides it. A browser without that pseudo-element
    drops this one rule and the fold opens by hand, as before.
  */
  "&:not([open]):has([id^='form-refusal'])::details-content": { contentVisibility: "visible", display: "block" },
} as const;
