/**
 * An option that wears a mark before its words (`DECISIONS.md` §171) — laid out in **both**
 * places MUI renders it.
 *
 * The owner, of the sex and citizenship fields: "acest inputuri sunt super descentrate". The
 * cause is MUI's own mechanism rather than a stray margin. A `Select` shows the chosen option
 * by reusing the matching `MenuItem`'s *children* — `SelectInput.js` computes
 * `displaySingle = child.props.children` and renders it inside its own `.MuiSelect-select`
 * box — and the item's `sx` is not among them: it stays on the item, which lives in the popup.
 * So a row laid out only on the `MenuItem` is laid out nowhere in the closed field. There the
 * glyph falls back to an inline box sitting on the text's baseline, which is ~5 pixels below
 * the line box's middle, and the whole value reads low against the 56-pixel outlined field.
 * A flag was worse: `Flag` renders `display: block`, so it took a line of its own and pushed
 * the country name onto a second one.
 *
 * Hence the same row twice — once on the item, once on the closed field through the Select's
 * slot class:
 *
 * - `OPTION_ROW_SX` is the row itself, and it keeps the input's own `1.4375em` line box, so a
 *   select with glyphs is exactly as tall as one of plain words and the label's notch sits
 *   where it always did.
 * - `OPTION_GLYPH_SX` is a fixed 20×20 box for the mark, so every label starts at the same x
 *   whatever the mark's own size is — a flag is 20×15, a `fontSize="small"` icon 20×20 — and
 *   a column of two hundred countries does not wobble.
 * - `OPTION_LABEL_SX` puts the ellipsis back on the words. `.MuiSelect-select` truncates with
 *   `text-overflow`, which a flex container cannot do for its items, so the item carries it.
 *
 * Styles, not a component: a client island to compute `renderValue` would be JavaScript on a
 * public form for a five-pixel offset, and `renderValue` is a function — a Server Component
 * cannot hand one to a client component anyway.
 */

/** The row: mark, gap, words. On the `MenuItem`, and on the closed field via the slot below. */
export const OPTION_ROW_SX = {
  display: "flex",
  alignItems: "center",
  gap: 1,
  // The line box `.MuiSelect-select`'s `min-height` and the outlined input's padding assume.
  lineHeight: "1.4375em",
} as const;

/** The mark's box: fixed, so the words line up under each other. */
export const OPTION_GLYPH_SX = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
  width: 20,
  height: 20,
  // Harmless in the flex row, and correct if a mark is ever rendered in a line of text.
  verticalAlign: "middle",
} as const;

/** The words: they shrink and truncate, the mark never does. */
export const OPTION_LABEL_SX = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/**
 * The closed field, addressed from the `TextField`: spread into the select's own `sx`.
 *
 * `& .MuiSelect-select` is one class plus one class, beating MUI's `&.MuiSelect-select` on the
 * element itself only by the descendant relationship — which is enough, and is the selector
 * MUI's own documentation uses for this slot.
 */
export const SELECT_WITH_GLYPHS_SX = { "& .MuiSelect-select": OPTION_ROW_SX } as const;
