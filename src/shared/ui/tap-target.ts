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
 * For a `Checkbox`, whose size comes from its padding around a 24-pixel icon.
 *
 * `p: 1.5` is 12 pixels each side: 24 + 24 = 48. MUI's own default of 9 pixels gives 42,
 * which is under the rule by two pixels and looks fine in review, which is exactly how it
 * survived this long.
 */
export const CHECKBOX_TAP_TARGET = { p: 1.5 } as const;
