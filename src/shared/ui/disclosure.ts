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
