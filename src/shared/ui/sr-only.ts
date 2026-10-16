/**
 * Text a screen reader reads and a sighted visitor never sees: clipped to a single pixel and kept out of
 * the flow — unlike an `aria-label`, this works on any element, including the plain, roleless `<div>` MUI's
 * `Chip` renders when it is not `clickable` (ARIA 1.2 does not allow naming a generic element, and
 * browse-mode screen readers read such a chip's own text and ignore the attribute). Never `display: none`,
 * which removes the words from the screen reader too.
 *
 * `'1px'`/`'-1px'` as strings, never the bare numbers `1`/`-1`: MUI's `sx` runs every `width`, `height` and
 * `margin` value through its spacing transform, which turns a number in `(0, 1]` into a *percentage* — `width: 1`
 * becomes `100%`, not `1px` — so the "single pixel" box was as wide and as tall as the chip itself.
 *
 * The one copy: the chips (`GlyphChip`), the checkpoints' table, a card's weather and the lead card's title.
 */
export const SR_ONLY_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;
