import { describe, expect, it } from "vitest";
import {
  alignmentOf,
  BLOCK_ALIGNMENTS,
  parseRichText,
  richTextToPlainText,
} from "@/modules/content/rich-text/domain/schema";
import { blockAlignSx } from "@/modules/content/rich-text/ui/text-align";

/**
 * BR-REQ-050-03, `AGENTS.md` §11.3, `DECISIONS.md` §213 — a paragraph or a heading can be
 * centred or set against the right edge.
 *
 * The interesting assertions here are the two refusals and the two silences: the allowlist takes
 * three words and nothing else, and both the stored document and the rendered page are
 * byte-for-byte what they were for every body written before this existed.
 */
describe("DECISIONS.md §213 — aligning a paragraph or a heading", () => {
  const doc = (...content: unknown[]) => ({ type: "doc", content });
  const text = (value: string) => ({ type: "text", text: value });

  it("accepts the three words on a paragraph and on a heading", () => {
    for (const align of BLOCK_ALIGNMENTS) {
      const body = doc(
        { type: "paragraph", attrs: { align }, content: [text("centred")] },
        { type: "heading", attrs: { level: 2, align }, content: [text("a title")] },
      );
      expect(() => parseRichText(body), align).not.toThrow();
    }
  });

  it("refuses a value the renderer has no rule for", () => {
    // The threat is not a typo. `justify` is what a paste from Word carries, and a CSS value
    // somebody typed is the thing the closed set exists to keep out of a stored document.
    for (const align of ["justify", "start", "end", "inherit", "center; color: red", 2, true]) {
      expect(() => parseRichText(doc({ type: "paragraph", attrs: { align }, content: [text("x")] })), String(align)).toThrow();
      expect(() => parseRichText(doc({ type: "heading", attrs: { level: 2, align }, content: [text("x")] })), String(align)).toThrow();
    }
  });

  it("leaves every body written before alignment existed exactly as it was", () => {
    // `attrs` is optional on a paragraph, so parsing adds nothing — not even `align: "left"`.
    // A document that round-trips differently is a document the next save would rewrite.
    const before = doc(
      { type: "paragraph", content: [text("Salut")] },
      { type: "heading", attrs: { level: 2 }, content: [text("Program")] },
    );
    expect(parseRichText(before)).toStrictEqual(before);
  });

  it("reads absent, null and left as the same thing", () => {
    expect(alignmentOf(undefined)).toBe("left");
    expect(alignmentOf({})).toBe("left");
    expect(alignmentOf({ align: null })).toBe("left");
    expect(alignmentOf({ align: "left" })).toBe("left");
    expect(alignmentOf({ align: "center" })).toBe("center");
  });

  it("emits no rule at all for the default, and one for the other two", () => {
    // Left is what the theme already does, so declaring it would put a `text-align` on every
    // paragraph the club has ever written and change no pixel — §193's discipline, kept.
    expect(blockAlignSx(undefined)).toStrictEqual({});
    expect(blockAlignSx({ align: null })).toStrictEqual({});
    expect(blockAlignSx({ align: "left" })).toStrictEqual({});
    expect(blockAlignSx({ align: "center" })).toStrictEqual({ textAlign: "center" });
    expect(blockAlignSx({ align: "right" })).toStrictEqual({ textAlign: "right" });
  });

  it("changes no word, so the excerpt, the calendar entry and the search index are untouched", () => {
    // Alignment is a rendering, not content. The plain-text projection is what the `.ics`, the
    // card and the Open Graph description read, and it must not learn that a line was centred.
    const body = doc(
      { type: "heading", attrs: { level: 2, align: "center" }, content: [text("Program")] },
      { type: "paragraph", attrs: { align: "right" }, content: [text("Start la 10:00")] },
    );
    expect(richTextToPlainText(parseRichText(body))).toBe("Program\nStart la 10:00");
  });

  it("aligns a paragraph inside a list item, a quote and a table cell, because it is one node", () => {
    // Not a separate feature: those three hold paragraphs, and a paragraph carries `align`.
    // The assertion is that the allowlist does not refuse it where the editor can produce it.
    const inner = { type: "paragraph", attrs: { align: "center" }, content: [text("10:00")] };
    expect(() => parseRichText(doc({ type: "blockquote", content: [inner] }))).not.toThrow();
    expect(() =>
      parseRichText(doc({ type: "bulletList", content: [{ type: "listItem", content: [inner] }] })),
    ).not.toThrow();
    expect(() =>
      parseRichText(
        doc({
          type: "table",
          content: [{ type: "tableRow", content: [{ type: "tableCell", content: [inner] }] }],
        }),
      ),
    ).not.toThrow();
  });
});
