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
 * How a table is drawn, on the page, in the editor and in the preview, from one description so
 * they agree (§263, §271). Borders: `all` (a grid; the default for older tables), `rows`
 * (horizontal rules only), `none` (a layout table). `scope` on `<th>` is semantics, never style
 * (`AGENTS.md` §18.2).
 */
/**
 * Palette names, not values, so dark mode follows (`brand.ts` alone holds hex values). A filled
 * header carries its own `contrastText` ink (`tests/unit/theme/brand.test.ts`).
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

export function tableSx(attrs: Parameters<typeof tableStyleOf>[0]) {
  const { borders, valign, borderColour, headerFill } = tableStyleOf(attrs);
  return {
    borderCollapse: "collapse",
    // A table with sized columns (§271) is laid out from its `<colgroup>` instead, under `fixed`.
    minWidth: "min(100%, 28rem)",
    "& td, & th": {
      ...TABLE_PADDING,
      ...cellBorderSx(borders, borderColour),
      textAlign: "left",
      verticalAlign: valign,
    },
    "& th": {
      fontWeight: 700,
      // `none` borders keep the weight but drop the default shading (§263); an explicit fill wins.
      ...(headerFill === "default" && borders === "none" ? {} : HEADER_FILL[headerFill]),
    },
    "& p:last-of-type": { mb: 0 },
  } as const;
}

/** `rows` is a bottom border per cell: under `border-collapse` that is one rule between rows, none at the sides. */
function cellBorderSx(borders: TableStyle["borders"], colour: TableBorderColour) {
  const borderColor = BORDER_COLOUR[colour];
  if (borders === "none") return { border: 0 };
  if (borders === "rows") return { border: 0, borderBottom: 1, borderColor };
  return { border: 1, borderColor };
}

/**
 * Every table rule under one ancestor selector, keyed on the `data-*` attributes the node writes
 * (ProseMirror owns the DOM, so no per-node `sx`). Used by the writing area and the preview (§271).
 */
function tableRulesUnder(scope: string): Record<string, object> {
  return {
    [`& ${scope} table`]: {
      ...tableSx(undefined),
      width: "100%",
      tableLayout: "auto",
      my: 2,
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

/** The preview dialog (§271): the writing area's rules without its editing aids. */
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
    Dashed guides where the page draws no line (§271). `outline`, not `border`, so the guides cost
    no layout; the colour comes from the theme because `sx` maps palette names for no outline.
  */
  "& .tiptap table[data-borders='none'] td, & .tiptap table[data-borders='none'] th, & .tiptap table[data-borders='rows'] td, & .tiptap table[data-borders='rows'] th": {
    outline: (theme: { palette: { divider: string } }) => `1px dashed ${theme.palette.divider}`,
    outlineOffset: -1,
  },
  // ProseMirror's column-resize handle has no look of its own (§271).
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
