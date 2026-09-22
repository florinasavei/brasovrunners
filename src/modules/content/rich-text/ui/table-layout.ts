import { type TableStyle, tableStyleOf } from "../domain/schema";

/**
 * How a table is drawn — on the page and in the editor, from one description (`DECISIONS.md`
 * §263).
 *
 * Separated from `RichText` for the reason `image-layout.ts` is: the interesting part is that
 * the editor and the page must agree. Until now they did not agree at all — the page drew every
 * table with a full grid and a shaded header, and the editor drew whatever the browser does with
 * an unstyled `<table>`, which is no lines anywhere. That is the whole of the owner's "tabelele
 * arată strange": an organizer set up a table against one drawing and published another.
 *
 * The three border choices are the club's three real cases:
 *
 * - `all` — a grid, which is what a table of cut-offs or waves wants, and what every table
 *   written before §263 keeps.
 * - `rows` — horizontal rules only. A price list reads better without vertical lines, and this
 *   is what most printed timetables do.
 * - `none` — nothing at all, which is what makes a table usable as a layout: two columns of text
 *   side by side on a standing page, with no lines announcing a table that isn't one.
 *
 * `valign` is `top` (as before) or `middle`, because a layout of two short paragraphs beside a
 * picture reads wrongly pinned to the top of a tall row.
 *
 * The header cell keeps its weight in every variant and loses its shading in `none`: a bold
 * first row is a heading, a shaded one is a table's chrome, and a layout wants the first without
 * the second. `scope` on the `<th>` is unaffected by any of this — the semantics of the table
 * are not a style choice (`AGENTS.md` §18.2).
 */
export const TABLE_PADDING = { px: 1.5, py: 1 } as const;

/** The `sx` for the `<table>` itself: the cell rules that the chosen borders imply. */
export function tableSx(attrs: Parameters<typeof tableStyleOf>[0]) {
  const { borders, valign } = tableStyleOf(attrs);
  return {
    borderCollapse: "collapse",
    // Never narrower than it needs to be, never forced wider than the column.
    minWidth: "min(100%, 28rem)",
    "& td, & th": {
      ...TABLE_PADDING,
      ...cellBorderSx(borders),
      textAlign: "left",
      verticalAlign: valign,
    },
    "& th": {
      fontWeight: 700,
      ...(borders === "none" ? {} : { backgroundColor: "action.hover" }),
    },
    "& p:last-of-type": { mb: 0 },
  } as const;
}

/**
 * The lines themselves, which is all that separates the three variants.
 *
 * `rows` is a bottom border per cell rather than a border on the row: `border-collapse` merges
 * adjacent cell borders, so this draws exactly one rule between two rows and one under the last
 * — the shape a timetable has — without a rule down either side.
 */
function cellBorderSx(borders: TableStyle["borders"]) {
  if (borders === "none") return { border: 0 };
  if (borders === "rows") return { border: 0, borderBottom: 1, borderColor: "divider" };
  return { border: 1, borderColor: "divider" };
}

/**
 * The same three drawings, for the editor's writing area.
 *
 * The editor cannot take an `sx` per node — ProseMirror owns that DOM — so the table's choice
 * rides on a `data-borders` attribute the node writes, and these are the rules keyed on it. The
 * default is written as its own selector rather than as a bare `& .tiptap table` rule so that a
 * table with `data-borders="none"` needs no `!important` to undo it.
 *
 * `.selectedCell` is ProseMirror's own class for a cell inside a selection; without a rule a
 * borderless table gives no feedback at all about what a "delete column" is about to take.
 */
export const EDITOR_TABLE_SX = {
  "& .tiptap table": {
    ...tableSx(undefined),
    width: "100%",
    tableLayout: "auto",
    my: 2,
  },
  "& .tiptap table[data-borders='rows']": tableSx({ borders: "rows" }),
  "& .tiptap table[data-borders='none']": tableSx({ borders: "none" }),
  "& .tiptap table[data-valign='middle']": tableSx({ valign: "middle" }),
  "& .tiptap table[data-borders='rows'][data-valign='middle']": tableSx({ borders: "rows", valign: "middle" }),
  "& .tiptap table[data-borders='none'][data-valign='middle']": tableSx({ borders: "none", valign: "middle" }),
  // A borderless table still needs an editing affordance: a hairline nobody will see on the
  // page, so the writer can tell where the cells are while filling them.
  "& .tiptap table[data-borders='none'] td, & .tiptap table[data-borders='none'] th": {
    // `outline` rather than `border`, so the hairline costs no layout and the cells do not
    // move when the borders are switched; the colour is read from the theme because `sx` maps
    // palette names for `borderColor` and not for an outline.
    outline: (theme: { palette: { divider: string } }) => `1px dashed ${theme.palette.divider}`,
    outlineOffset: -1,
  },
  "& .tiptap .selectedCell": { backgroundColor: "action.selected" },
} as const;
