import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRichText, tableStyleOf, TABLE_BORDERS } from "@/modules/content/rich-text/domain/schema";
import { EDITOR_TABLE_SX, tableSx } from "@/modules/content/rich-text/ui/table-layout";

/**
 * BR-REQ-050-03, `DECISIONS.md` §263 — a table is drawn the way the organizer chose, and the
 * editor and the page agree on the drawing.
 *
 * The owner asked for two things in one sentence: "la tabele ar trebui să pot alege border and
 * stuff, ca să pot folosi tabelele și ca și layout, și să pot centra info în ele". The first is
 * these three border choices; the second is vertical centring here, since horizontal centring
 * was already the paragraph's own alignment (§213) — a cell holds paragraphs.
 *
 * And a third thing, not asked for in words but the cause of "tabelele arată strange": the
 * editor had no table rules at all, so the page's grid was an unstyled table in the form.
 */
const tableDoc = (attrs?: Record<string, unknown>) => ({
  type: "doc",
  content: [
    {
      type: "table",
      ...(attrs ? { attrs } : {}),
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Ora" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "10:00" }] }] },
          ],
        },
      ],
    },
  ],
});

describe("§263 what a table may say about itself", () => {
  it("keeps the two choices through the allowlist", () => {
    const doc = readRichText(tableDoc({ borders: "rows", valign: "middle" }));
    const table = doc.content?.[0] as { type: string; attrs?: { borders?: string; valign?: string } };
    expect(table.type).toBe("table");
    expect(table.attrs).toEqual({ borders: "rows", valign: "middle" });
  });

  it("leaves a table written before today byte-identical", () => {
    // The reason `attrs` is optional on the node: no migration, and every golden-string test
    // of a stored body keeps passing.
    const stored = tableDoc();
    expect(readRichText(stored)).toEqual(stored);
  });

  it("refuses a value it does not know, rather than passing it to the renderer", () => {
    // An unknown border word would reach `tableSx` and become a CSS rule nobody wrote. The
    // whole document is refused, which is what `readRichText` does with anything malformed.
    expect(readRichText(tableDoc({ borders: "dotted" })).content).toEqual([]);
  });

  it("reads absent, null and the default as the same thing", () => {
    // Four choices since §271: the lines, where the text sits, and the two colours.
    const DEFAULTS = { borders: "all", valign: "top", borderColour: "default", headerFill: "default" };
    expect(tableStyleOf(undefined)).toEqual(DEFAULTS);
    expect(tableStyleOf({ borders: null, valign: null })).toEqual(DEFAULTS);
    expect(tableStyleOf({ borders: "none" })).toEqual({ ...DEFAULTS, borders: "none" });
    expect(tableStyleOf({ borderColour: "blue", headerFill: "orange" })).toEqual({
      ...DEFAULTS,
      borderColour: "blue",
      headerFill: "orange",
    });
  });

  it("paints the lines and the header in the palette's own names, never a value (§271)", () => {
    const blue = tableSx({ borderColour: "blue", headerFill: "blue" });
    expect(blue["& td, & th"].borderColor).toBe("primary.main");
    expect(blue["& th"].backgroundColor).toBe("primary.main");
    // A filled header carries its own ink: blue under the body's near-black would not clear AA.
    expect(blue["& th"].color).toBe("primary.contrastText");
    // Nothing anywhere is a hex value — `brand.ts` is the only file allowed one.
    expect(JSON.stringify(tableSx({ borderColour: "orange", headerFill: "orange" }))).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("lets a layout table keep a coloured header row it asked for", () => {
    // Borderless keeps the bold first row and drops the shading (§263) — unless somebody chose
    // a fill, which is a decision rather than a table's default chrome.
    expect(tableSx({ borders: "none" })["& th"].backgroundColor).toBeUndefined();
    expect(tableSx({ borders: "none", headerFill: "blue" })["& th"].backgroundColor).toBe("primary.main");
  });
});

describe("§263 how each choice is drawn", () => {
  it("draws the grid every table had, by default", () => {
    const cells = tableSx(undefined)["& td, & th"];
    expect(cells.border).toBe(1);
    expect(cells.borderColor).toBe("divider");
    expect(cells.verticalAlign).toBe("top");
    expect(tableSx(undefined)["& th"].backgroundColor).toBe("action.hover");
  });

  it("draws one rule between rows and none down the sides for `rows`", () => {
    // `border-collapse` merges adjacent cell borders, so a bottom border per cell is exactly
    // one rule between two rows — the shape a printed timetable has.
    const cells = tableSx({ borders: "rows" })["& td, & th"];
    expect(cells.border).toBe(0);
    expect(cells.borderBottom).toBe(1);
  });

  it("draws nothing at all for `none`, and takes the header's shading with it", () => {
    // This is the one that makes a table usable as a layout: no lines, and a first row that is
    // bold (a heading) rather than shaded (a table's chrome).
    const style = tableSx({ borders: "none" });
    expect(style["& td, & th"].border).toBe(0);
    expect(style["& td, & th"]).not.toHaveProperty("borderBottom");
    expect(style["& th"]).not.toHaveProperty("backgroundColor");
    expect(style["& th"].fontWeight).toBe(700);
  });

  it("puts the text in the middle of the cell when asked", () => {
    expect(tableSx({ valign: "middle" })["& td, & th"].verticalAlign).toBe("middle");
  });

  it("keeps the padding and the width rule whatever the borders are", () => {
    for (const borders of TABLE_BORDERS) {
      const style = tableSx({ borders });
      expect(style.minWidth).toBe("min(100%, 28rem)");
      expect(style["& td, & th"].px).toBe(1.5);
      expect(style.borderCollapse).toBe("collapse");
    }
  });
});

describe("§263 the editor draws what the page draws", () => {
  const SOURCE = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("has a rule per variant, keyed on the attribute the node writes", () => {
    expect(EDITOR_TABLE_SX).toHaveProperty("& .tiptap table[data-borders='rows']");
    expect(EDITOR_TABLE_SX).toHaveProperty("& .tiptap table[data-borders='none']");
    expect(EDITOR_TABLE_SX).toHaveProperty("& .tiptap table[data-valign='middle']");
    // Both together, or a borderless middle-aligned table would take the default's borders back.
    expect(EDITOR_TABLE_SX).toHaveProperty("& .tiptap table[data-borders='none'][data-valign='middle']");
  });

  it("marks the cells of a table that draws no lines, for the writer only (§271)", () => {
    // An outline, so switching the borders moves nothing, and dashed, so it reads as an
    // editing aid rather than as a line that will be published. Both variants that leave the
    // writer typing into an invisible grid are covered: a layout table draws nothing at all,
    // and a table of rows draws no verticals.
    const selector =
      "& .tiptap table[data-borders='none'] td, & .tiptap table[data-borders='none'] th, & .tiptap table[data-borders='rows'] td, & .tiptap table[data-borders='rows'] th";
    const rule = EDITOR_TABLE_SX[selector];
    expect(String(rule.outline)).toContain("dashed");
    expect(rule.outlineOffset).toBe(-1);
  });

  it("is the only description of a table's look — the page has no rules of its own", () => {
    const renderer = SOURCE("src/modules/content/rich-text/ui/RichText.tsx");
    // The page's table still takes its whole look from `tableSx`; what it adds on top is the
    // column proportions (§271), which are a property of the document rather than a style.
    expect(renderer).toContain("...tableSx(block.attrs),");
    expect(renderer).toContain("tableColumnFractions(block.content)");
    // The block of border rules that used to live here is what the editor had no copy of.
    expect(renderer).not.toMatch(/verticalAlign: "top"/);
    const editor = SOURCE("src/modules/content/rich-text/ui/RichTextEditor.tsx");
    expect(editor).toContain("...EDITOR_TABLE_SX");
  });

  it("writes no attribute for a table nobody restyled", () => {
    // The editor's own extension: only `rows`/`none` and `middle` reach the DOM, so a default
    // table's stored JSON stays exactly as it was.
    const editor = SOURCE("src/modules/content/rich-text/ui/RichTextEditor.tsx");
    expect(editor).toContain(`attrs.borders === "rows" || attrs.borders === "none"`);
    expect(editor).toContain(`attrs.valign === "middle" ? { "data-valign": "middle" } : {}`);
  });
});
