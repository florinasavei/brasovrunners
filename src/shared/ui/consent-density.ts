/**
 * The registration form's «Acorduri» block, compacted (§NNN; the owner, 2026-09-29 19:03, of a
 * screenshot of the block: "Also these need to be more compacted!").
 *
 * The block was a full-width blue bar for the race's conditions, a helper line under it, then the
 * boxes as `body1` labels beside 24-pixel boxes, sixteen pixels apart (the form's `Stack spacing={2}`).
 * The words stay exactly as the legal reviews fixed them (§425, §556); only the geometry changes:
 *
 * - **The box**: MUI's small box (a 20-pixel glyph) with `CHECKBOX_TAP_TARGET`'s 12 pixels around it
 *   — 44 by 44, still the thumb's target (BR-REQ-041-01 criterion 6), where the medium box was 48.
 * - **The label**: `body2` (14 px on a 20-pixel line) beside the box, top-aligned, with 12 pixels
 *   above and below — a one-line row is exactly the box, 44 px (was 48 + 16 of gap = 64).
 * - **No margin between rows**: the block is its own `Stack` with no spacing (`gap` 0), so each row
 *   is `max(44, 24 + 20 × lines)` pixels; it was `max(48, 24 × lines) + 16`.
 * - **A helper line** is a caption directly under its label — pulled up 8 of the label's 12 pixels
 *   below, indented to the label's own left edge (the box's 44 minus `FormControlLabel`'s −11).
 *
 * - **A glyph leads every box's words** (round 2; the owner, 2026-09-29 19:33: «pentru fiecare bifă
 *   ne trebuie și o iconiță la început», «e destul de importantă partea asta cu acordurile!»): a
 *   20-pixel glyph in `text.secondary`, the size of the site's row glyphs, in its own column at the
 *   label's left edge and on its first line, 6 pixels before the words; a line that wraps starts
 *   under the words, never under the glyph. The caption under a box starts under the words too:
 *   33 + 20 + 6 = 59 pixels. The words — the terms' version and clauses, the link, « — opțional»,
 *   the required mark — stay one inline flow, so the mark follows the last word.
 *
 * One constant, read by `CheckboxField`'s `dense`, by `ReadAndAgree` and by the density test
 * (`tests/unit/registrations/consents-density.test.ts`), so the numbers above cannot drift from the
 * page. The backoffice's boxes keep their own density; only the public form's consents read this.
 */
export const CONSENT_DENSITY = {
  /** The box's MUI size: a 20-pixel glyph, 44 with the tap target's padding. */
  checkboxSize: "small",
  /** Every row's height at one line: the box, and the label's 20-pixel line with 12 above and below. */
  rowMinHeightPx: 44,
  /** The label's typography. */
  labelVariant: "body2",
  /** The space between two rows of the block, in pixels. */
  rowGapPx: 0,
  /** `FormControlLabel`: the label top-aligned beside the box, padded to the box's height at one line, no margin of its own. */
  rowSx: {
    alignItems: "flex-start",
    mr: 0,
    my: 0,
    "& .MuiFormControlLabel-label": { py: "12px" },
  },
  /** A helper line: a caption under its label, 4 pixels below the words, at the words' left edge (after the glyph). */
  helpSx: { display: "block", mt: "-8px", pl: "59px" },
  /** The glyph's size and the gap after it, in pixels. */
  glyphPx: 20,
  glyphGapPx: 6,
  /**
   * The words beside the glyph: a block indented by the glyph's column, so every line starts under
   * the words; the glyph (the label's first child, an `MuiSvgIcon`) sits in that column on the first
   * line. One inline flow for the words, the link, « — opțional» and the required mark.
   */
  labelSx: {
    display: "block",
    position: "relative",
    pl: "26px",
    "& > .MuiSvgIcon-root:first-child": { position: "absolute", left: 0, top: 0, fontSize: 20, color: "text.secondary" },
  },
} as const;
