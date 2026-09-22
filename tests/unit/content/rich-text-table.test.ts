import { describe, expect, it } from "vitest";
import {
  isRichTextEmpty,
  parseRichText,
  richTextToPlainText,
  tableColumnFractions,
} from "@/modules/content/rich-text/domain/schema";

/**
 * `AGENTS.md` §11.3 and `DECISIONS.md` §196 — a table in the editor, and the allowlist that
 * decides what a table may be.
 *
 * The allowlist is the security boundary: every stored document is validated against it on the
 * server, so a node or an attribute that is not here cannot reach a page whatever is in the
 * database. These assertions are as much about what is refused as about what renders.
 */
const cell = (text: string) => ({
  type: "tableCell",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const header = (text: string) => ({
  type: "tableHeader",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });
const table = (...rows: unknown[]) => ({ type: "doc", content: [{ type: "table", content: rows }] });

const SCHEDULE = table(
  row(header("Val"), header("Start")),
  row(cell("Valul 1"), cell("10:00")),
  row(cell("Valul 2"), cell("10:20")),
);

describe("§196 a table in a body", () => {
  it("accepts a header row and cells", () => {
    const parsed = parseRichText(SCHEDULE);
    expect(parsed.content?.[0]).toMatchObject({ type: "table" });
  });

  it("keeps a merged cell's spans, so a table is not silently rearranged", () => {
    const merged = table(row({ ...header("Programul"), attrs: { colspan: 2 } }), row(cell("a"), cell("b")));
    const parsed = parseRichText(merged);
    const first = (parsed.content?.[0] as { content: { content: { attrs?: { colspan?: number } }[] }[] })
      .content[0].content[0];
    expect(first.attrs?.colspan).toBe(2);
  });

  it("keeps a dragged column width, and reads it as a proportion (§271)", () => {
    /*
      This used to assert the opposite — a pixel width was dropped, because it is measured on
      somebody's laptop and the hard target is a 320-pixel column. That reasoning still holds
      for *pixels*, which is why nothing renders them: what survives is the ratio between the
      columns, which is what dragging an edge actually says and what a `<colgroup>` of
      percentages honours at any width.
    */
    const withWidth = table(
      row({ ...cell("10:00"), attrs: { colspan: 1, colwidth: [480] } }, { ...cell("Start"), attrs: { colspan: 1, colwidth: [240] } }),
    );
    const parsed = parseRichText(withWidth);
    const first = parsed.content?.[0] as {
      content: { content: { attrs?: { colwidth?: number[]; colspan?: number } }[] }[];
    };
    expect(first.content[0].content[0].attrs?.colwidth).toEqual([480]);
    // Two thirds and one third, whatever the screen is.
    expect(tableColumnFractions(first.content)).toEqual([2 / 3, 1 / 3]);
  });

  it("has no proportions to honour when a column was never sized", () => {
    const plain = parseRichText(table(row(cell("10:00"), cell("Start")))).content?.[0] as {
      content: { content: { attrs?: { colwidth?: number[] } }[] }[];
    };
    expect(tableColumnFractions(plain.content)).toBeNull();
  });

  it("refuses a table inside a table", () => {
    // Nesting is where a text editor becomes a spreadsheet, and where a phone runs out of width.
    const nested = table(row({ type: "tableCell", content: [{ type: "table", content: [row(cell("x"))] }] }));
    expect(() => parseRichText(nested)).toThrow();
  });

  it("refuses a row with no cells and a table with no rows", () => {
    expect(() => parseRichText(table(row()))).toThrow();
    expect(() => parseRichText({ type: "doc", content: [{ type: "table", content: [] }] })).toThrow();
  });

  it("refuses a span that is not a small positive number", () => {
    for (const colspan of [0, -1, 1000, 2.5, "2"]) {
      const bad = table(row({ ...cell("x"), attrs: { colspan } }));
      expect(() => parseRichText(bad), `colspan ${colspan}`).toThrow();
    }
  });

  it("reads as words, one line per row, cells apart", () => {
    // What the excerpt, the calendar entry and the search index see: single-column plain text,
    // so a grid has to become lines. A tab, because a spreadsheet takes one if the line is pasted.
    expect(richTextToPlainText(parseRichText(SCHEDULE))).toBe(
      "Val\tStart\nValul 1\t10:00\nValul 2\t10:20",
    );
  });

  it("counts as content, so a body that is only a table is not treated as empty", () => {
    expect(isRichTextEmpty(parseRichText(SCHEDULE))).toBe(false);
  });

  it("leaves every body written before tables existed exactly as it was", () => {
    const before = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Salut" }] }] };
    expect(parseRichText(before)).toEqual(before);
  });
});
