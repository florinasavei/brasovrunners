/**
 * The one place the 44-pixel rule is written down (BR-REQ-041-01 criterion 6, AGENTS.md §18.5).
 *
 * MUI's defaults are below it: a medium `Button` is about 37 pixels tall and a `Checkbox` is
 * 42 by 42, because the library targets a mouse. Every participant journey here targets a
 * thumb, so each control on those pages carries one of these.
 *
 * A constant rather than a theme override on purpose. A `MuiButton` default would silently
 * enlarge every control in the backoffice too — where density is worth more than reach — and
 * the rule would then live in a file nobody reads while looking at the registration form.
 */

/** For anything with a height: a button, a link rendered as one, a `<summary>`. */
export const TAP_TARGET = { minHeight: 44 } as const;

/**
 * For a link inside a sentence — "scrie-ne" in the photographs notice, the privacy notice under
 * the contact form, the club's address after "Sau scrie-ne direct la" (§NNN, the 360-px density
 * pass).
 *
 * `TAP_TARGET` on an `inline-flex` link made it 44 tall *in the line*: the line holding it grew
 * by the twenty-odd pixels the words did not need, so one line of every such paragraph stood
 * apart from the others (measured at 360 px: a four-line notice 124 pixels tall instead of 96).
 *
 * Here the link is still 44 tall — its words' line plus padding above — and gives the padding
 * back as an equal negative margin, so the line is as tall as its words (the §366 "tight" shape,
 * in `lh` units so it fits `body1` and `body2` alike). The reach is all **above** the words: a
 * line of the paragraph painted later would take any press on pixels the link shared with it
 * (§366), and the line after is painted later, the line before is not. Where `lh` is unknown the
 * two declarations are dropped together and the link is its words' height.
 */
export const INLINE_TAP_TARGET = {
  display: "inline-flex",
  alignItems: "center",
  paddingTop: "calc(44px - 1lh)",
  marginTop: "calc(1lh - 44px)",
} as const;

/**
 * For a `Checkbox`, whose size comes from its padding around a 24-pixel icon.
 *
 * `p: 1.5` is 12 pixels each side: 24 + 24 = 48. MUI's own default of 9 pixels gives 42,
 * which is under the rule by two pixels and looks fine in review, which is exactly how it
 * survived this long.
 */
export const CHECKBOX_TAP_TARGET = { p: 1.5 } as const;
