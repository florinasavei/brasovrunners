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
 * back as an equal negative margin, so the line is as tall as its words (the §366 "tight" shape).
 * The reach is all **above** the words: a line of the paragraph painted later would take any
 * press on pixels the link shared with it (§366), and the line after is painted later, the line
 * before is not.
 *
 * The reach is `44px - 1.4em`, not `44px - 1lh`: `lh` is unknown to Safari before 16.4 and Firefox
 * before 120, where both declarations would be dropped and the link fall to its words' height,
 * under criterion 6. `em` is known everywhere, and 1.4 is under every line height it is used at —
 * `body2`'s 1.43 (the link 44.4 tall, 24.4 of reach) and `body1`'s 1.5 (45.6, 21.6 of reach) — so
 * the link is never under 44. The padding and the margin are the same length whatever it is, so
 * the line is never stretched. A paragraph holding such a link needs that reach free above its
 * first line (the contact page's address has 24 pixels over it, §NNN), and a second such link must not sit on
 * the line under the first — the contact page gives a second address `TAP_TARGET`'s own shape.
 */
export const INLINE_TAP_TARGET = {
  display: "inline-flex",
  alignItems: "center",
  paddingTop: "calc(44px - 1.4em)",
  marginTop: "calc(1.4em - 44px)",
} as const;

/**
 * For a `Checkbox`, whose size comes from its padding around a 24-pixel icon.
 *
 * `p: 1.5` is 12 pixels each side: 24 + 24 = 48. MUI's own default of 9 pixels gives 42,
 * which is under the rule by two pixels and looks fine in review, which is exactly how it
 * survived this long.
 */
export const CHECKBOX_TAP_TARGET = { p: 1.5 } as const;
