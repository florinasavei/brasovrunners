import {
  TABLE_BORDERS,
  TABLE_BORDER_COLOURS,
  TABLE_HEADER_FILLS,
  type TableBorderColour,
  type TableHeaderFill,
  type TableStyle,
  tableStyleOf,
} from "../domain/schema";

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
/**
 * The four line colours and the four header fills (§271), as palette names.
 *
 * Palette names rather than values, so each is one colour in the light scheme and the right
 * other colour after dark — `theme.ts` holds both, and `brand.ts` is the only file allowed a
 * hex value at all. A filled header carries its own ink with it: `primary` and `secondary` both
 * define a `contrastText`, and a blue header with the body's near-black text on it is the pair
 * `tests/unit/theme/brand.test.ts` exists to prevent.
 */
const BORDER_COLOUR: Record<TableBorderColour, string> = {
  default: "divider",
  strong: "text.primary",
  blue: "primary.main",
  orange: "secondary.main",
};

const HEADER_FILL: Record<TableHeaderFill, { backgroundColor?: string; color?: string }> = {
  default: { backgroundColor: "action.hover" },
  none: {},
  blue: { backgroundColor: "primary.main", color: "primary.contrastText" },
  orange: { backgroundColor: "secondary.main", color: "secondary.contrastText" },
};

export const TABLE_PADDING = { px: 1.5, py: 1 } as const;

/** The `sx` for the `<table>` itself: the cell rules that the chosen borders imply. */
export function tableSx(attrs: Parameters<typeof tableStyleOf>[0]) {
  const { borders, valign, borderColour, headerFill } = tableStyleOf(attrs);
  return {
    borderCollapse: "collapse",
    // Never narrower than it needs to be, never forced wider than the column. A table whose
    // columns were sized (§271) is laid out from its `<colgroup>` instead, which `fixed` is
    // what makes the browser honour.
    minWidth: "min(100%, 28rem)",
    "& td, & th": {
      ...TABLE_PADDING,
      ...cellBorderSx(borders, borderColour),
      textAlign: "left",
      verticalAlign: valign,
    },
    "& th": {
      fontWeight: 700,
      /*
        A borderless table is a layout, and a layout wants a bold first row without a table's
        chrome — so `none` borders keep the weight and drop the shading, as they have since
        §263. An explicit fill overrides that: somebody who chose blue for a layout's header row
        meant it.
      */
      ...(headerFill === "default" && borders === "none" ? {} : HEADER_FILL[headerFill]),
    },
    "& p:last-of-type": { mb: 0 },
  } as const;
}

/** Every combination, as the editor's stylesheet needs them keyed by `data-` attribute. */
export const TABLE_BORDER_COLOUR_VALUES = TABLE_BORDER_COLOURS;
export const TABLE_HEADER_FILL_VALUES = TABLE_HEADER_FILLS;

/**
 * The lines themselves, which is all that separates the three variants.
 *
 * `rows` is a bottom border per cell rather than a border on the row: `border-collapse` merges
 * adjacent cell borders, so this draws exactly one rule between two rows and one under the last
 * — the shape a timetable has — without a rule down either side.
 */
function cellBorderSx(borders: TableStyle["borders"], colour: TableBorderColour) {
  const borderColor = BORDER_COLOUR[colour];
  if (borders === "none") return { border: 0 };
  if (borders === "rows") return { border: 0, borderBottom: 1, borderColor };
  return { border: 1, borderColor };
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
/**
 * Every table rule, keyed under one ancestor selector (§271).
 *
 * Written once and asked for twice: the writing area keys them under `.tiptap`, and the preview
 * dialog under itself. The two must agree by construction rather than by somebody remembering to
 * change both — which is the whole of §263's reasoning, applied a second time now that there is
 * a third place a table is drawn.
 */
function tableRulesUnder(scope: string): Record<string, object> {
  return {
    [`& ${scope} table`]: {
      ...tableSx(undefined),
      width: "100%",
      tableLayout: "auto",
      my: 2,
      // The resize handle is positioned against the table.
      position: "relative",
    },
    [`& ${scope} table[data-borders='rows']`]: tableSx({ borders: "rows" }),
    [`& ${scope} table[data-borders='none']`]: tableSx({ borders: "none" }),
    [`& ${scope} table[data-valign='middle']`]: tableSx({ valign: "middle" }),
    [`& ${scope} table[data-borders='rows'][data-valign='middle']`]: tableSx({ borders: "rows", valign: "middle" }),
    [`& ${scope} table[data-borders='none'][data-valign='middle']`]: tableSx({ borders: "none", valign: "middle" }),
    ...Object.fromEntries(
      TABLE_BORDER_COLOURS.filter((colour) => colour !== "default").flatMap((colour) =>
        TABLE_BORDERS.filter((borders) => borders !== "none").map((borders) => [
          `& ${scope} table[data-border-colour='${colour}']${borders === "all" ? ":not([data-borders])" : `[data-borders='${borders}']`}`,
          tableSx({ borders, borderColour: colour }),
        ]),
      ),
    ),
    ...Object.fromEntries(
      TABLE_HEADER_FILLS.filter((fill) => fill !== "default").map((fill) => [
        `& ${scope} table[data-header-fill='${fill}'] th`,
        { fontWeight: 700, ...HEADER_FILL[fill] },
      ]),
    ),
  };
}

/**
 * What the preview dialog draws (§271; the owner: "I also want a preview in a pop-up").
 *
 * The same rules as the writing area with the editing aids left out: no dashed cell guides, no
 * resize handle, no selection shading. That difference *is* the preview — the question it
 * answers is "which of these lines will the reader see", and a preview that kept the guides
 * could not answer it.
 */
export const PREVIEW_CONTENT_SX = {
  ...tableRulesUnder(""),
  "& img": { maxWidth: "100%", height: "auto" },
  "& h2": { fontSize: "1.5rem", mt: 3, mb: 1 },
  "& h3": { fontSize: "1.25rem", mt: 2, mb: 1 },
  "& blockquote": { borderLeft: 3, borderColor: "divider", pl: 2, ml: 0, color: "text.secondary" },
  "& a": { color: "primary.main" },
} as const;

export const EDITOR_TABLE_SX = {
  ...tableRulesUnder(".tiptap"),
  "& .tiptap table": {
    ...tableSx(undefined),
    width: "100%",
    tableLayout: "auto",
    my: 2,
    // The resize handle below is positioned against the table.
    position: "relative",
  },
  /*
    **The writing area always shows where the cells are** (§271; the owner: "in the editor I
    want lines visible for layout"). A table used as a layout draws nothing on the page, and a
    table of rows draws no verticals — in both cases the writer was typing into an invisible
    grid. A dashed hairline says "a cell edge is here, and it will not print".

    `outline` rather than `border`, so the guide costs no layout and the cells do not move when
    the lines are switched; the colour is read from the theme because `sx` maps palette names
    for `borderColor` and not for an outline.
  */
  "& .tiptap table[data-borders='none'] td, & .tiptap table[data-borders='none'] th, & .tiptap table[data-borders='rows'] td, & .tiptap table[data-borders='rows'] th": {
    outline: (theme: { palette: { divider: string } }) => `1px dashed ${theme.palette.divider}`,
    outlineOffset: -1,
  },
  /*
    The column-resize handle ProseMirror draws while a table is being sized (§271). It renders
    nothing of its own, so without these two rules dragging a column edge is an invisible
    gesture nobody discovers.
  */
  "& .tiptap .column-resize-handle": {
    position: "absolute",
    right: "-2px",
    top: 0,
    bottom: 0,
    width: "4px",
    backgroundColor: "primary.main",
    pointerEvents: "none",
  },
  "& .tiptap.resize-cursor": { cursor: "col-resize" },
  "& .tiptap .selectedCell": { backgroundColor: "action.selected" },
} as const;
