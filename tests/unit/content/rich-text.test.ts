import { describe, expect, it } from "vitest";
import {
  countImagesWithoutAlt,
  EMPTY_DOC,
  isRichTextEmpty,
  hasRichTextContent,
  parseRichText,
  readRichText,
  richTextToPlainText,
} from "@/modules/content/rich-text/domain/schema";

/**
 * BR-REQ-050-03, AGENTS.md §11.3 — the editorial body is validated on the server against an
 * allowlist, and nothing else may be stored. These are the rules the editor cannot enforce,
 * because the editor runs in somebody else's browser.
 */
describe("AGENTS.md §11.3 the rich-text allowlist", () => {
  const doc = (...content: unknown[]) => ({ type: "doc", content });
  const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
  const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });

  it("accepts the nodes and marks §11.3 lists", () => {
    const body = doc(
      { type: "heading", attrs: { level: 2 }, content: [text("A heading")] },
      paragraph(text("plain "), text("bold", [{ type: "bold" }]), text("italic", [{ type: "italic" }])),
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("one"))] }] },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [{ type: "listItem", content: [paragraph(text("first"))] }],
      },
      { type: "blockquote", content: [paragraph(text("quoted"))] },
    );

    expect(() => parseRichText(body)).not.toThrow();
  });

  it("refuses a node type nobody allowed", () => {
    // The threat is not a typo: it is a body posted by something other than this application's
    // editor. An unknown node is refused rather than dropped, because dropping one would delete
    // what the club wrote without saying so.
    expect(() => parseRichText(doc({ type: "iframe", attrs: { src: "https://example.test/x" } }))).toThrow();
    expect(() => parseRichText(doc({ type: "codeBlock", content: [text("rm -rf /")] }))).toThrow();
    expect(() => parseRichText(doc(paragraph(text("hi", [{ type: "strike" }]))))).toThrow();
  });

  /**
   * Pictures (`DECISIONS.md` §72): a block of its own, and only an address this site's upload
   * route answers — one of its own WebP variants. Anything else is a way to put a third
   * party's image, a tracking pixel or a data URI on the club's page.
   */
  /**
   * A YouTube film (`DECISIONS.md` §110): the id and a caption, nothing else — never an
   * address the renderer would have to trust, and never any other host's embed.
   */
  describe("films", () => {
    it("accepts a video id with a caption, defaults the caption, and counts the caption as its words", () => {
      const parsed = parseRichText(doc({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", caption: "Startul din 2025" } }));
      expect(parsed.content?.[0]).toEqual({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", caption: "Startul din 2025" } });
      expect(parseRichText(doc({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } })).content?.[0]).toMatchObject({ attrs: { caption: "" } });
      expect(richTextToPlainText(parsed)).toBe("Startul din 2025");
      expect(hasRichTextContent(parseRichText(doc({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ" } })))).toBe(true);
    });

    it("refuses anything but an eleven-character id", () => {
      for (const videoId of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "short", "dQw4w9WgXcQ/../x", "<script>", ""]) {
        expect(() => parseRichText(doc({ type: "youtube", attrs: { videoId } })), videoId).toThrow();
      }
      expect(() => parseRichText(doc({ type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", src: "https://x" } }))).toThrow();
    });
  });

  describe("pictures", () => {
    const ours = "https://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp";
    const local = "/api/media/local/3f2a1b4c-0000-4000-8000-000000000000/web.webp";

    it("accepts one of this site's stored pictures, as a block, with its size, alt, caption and width share", () => {
      const parsed = parseRichText(
        doc({ type: "image", attrs: { src: ours, alt: "Startul", caption: "Startul, 2025", width: 1600, height: 1067, widthPercent: 50 } }),
      );
      expect(parsed.content?.[0]).toEqual({
        type: "image",
        attrs: { src: ours, alt: "Startul", caption: "Startul, 2025", width: 1600, height: 1067, widthPercent: 50 },
      });
      // Defaults (§73): no alt, no caption, the whole column. Never the file name.
      expect(parseRichText(doc({ type: "image", attrs: { src: local } })).content?.[0]).toMatchObject({
        attrs: { alt: "", caption: "", widthPercent: 100 },
      });
      // Its words are the alt and the caption; a width share is one of four, never a free number.
      expect(richTextToPlainText(parsed)).toBe("Startul\nStartul, 2025");
      expect(() => parseRichText(doc({ type: "image", attrs: { src: ours, widthPercent: 60 } }))).toThrow();
      expect(countImagesWithoutAlt(parseRichText(doc({ type: "image", attrs: { src: ours } }, { type: "image", attrs: { src: local, alt: "x" } })))).toBe(1);
    });

    it("refuses any other address", () => {
      for (const src of [
        "https://example.test/x.png",
        "data:image/png;base64,AAAA",
        "https://pub-example.r2.dev/qa/not-a-uuid/web.webp",
        "http://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp",
        "javascript:alert(1)",
      ]) {
        expect(() => parseRichText(doc({ type: "image", attrs: { src } })), src).toThrow();
      }
      // Never inline: a picture inside a paragraph is a layout, not a body.
      expect(() => parseRichText(doc(paragraph({ type: "image", attrs: { src: ours } } as never)))).toThrow();
    });
  });

  it("refuses a heading level that is not 2 or 3", () => {
    // Level 1 is the page's own title; a second h1 breaks the heading order (§18.2).
    expect(() => parseRichText(doc({ type: "heading", attrs: { level: 1 }, content: [text("x")] }))).toThrow();
    expect(() => parseRichText(doc({ type: "heading", attrs: { level: 4 }, content: [text("x")] }))).toThrow();
  });

  describe("links", () => {
    const withHref = (href: string) => doc(paragraph(text("click", [{ type: "link", attrs: { href } }])));

    it("accepts http, https, mailto and a path on this site", () => {
      for (const href of ["https://example.test/a", "http://example.test", "mailto:ana@example.test", "/ro/evenimente"]) {
        expect(() => parseRichText(withHref(href)), href).not.toThrow();
      }
    });

    it("refuses an href that would execute instead of navigate", () => {
      // An href is one of the few places a string becomes code.
      for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>x</script>", "vbscript:x"]) {
        expect(() => parseRichText(withHref(href)), href).toThrow();
      }
    });

    it("refuses a protocol-relative href, which leaves the site without looking like it", () => {
      expect(() => parseRichText(withHref("//evil.example/login"))).toThrow();
    });

    it("keeps the address and drops everything the editor decorates it with", () => {
      // `target`, `rel` and `class` are the renderer's decision, every time it renders — not a
      // value stored years ago and trusted afterwards.
      const parsed = parseRichText(
        doc(
          paragraph(
            text("click", [
              { type: "link", attrs: { href: "https://example.test", target: "_self", rel: "", class: "x" } },
            ]),
          ),
        ),
      );
      const mark = (parsed.content?.[0] as { content: { marks: { attrs: unknown }[] }[] }).content[0].marks[0];
      expect(mark.attrs).toEqual({ href: "https://example.test" });
    });
  });

  describe("reading what is already stored", () => {
    it("reads a body written before the editor existed", () => {
      // The section shape the textarea produced. A read-time adapter rather than a migration:
      // old rows and new rows both work during a deployment (§7.6).
      const legacy = { sections: [{ heading: "Despre noi", paragraphs: ["Alergăm.", "Împreună."] }] };

      expect(readRichText(legacy)).toEqual({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Despre noi" }] },
          { type: "paragraph", content: [{ type: "text", text: "Alergăm." }] },
          { type: "paragraph", content: [{ type: "text", text: "Împreună." }] },
        ],
      });
    });

    it("reads anything unrecognisable as empty rather than throwing", () => {
      // This runs while rendering a public page: an unreadable body costs a paragraph, never the
      // whole page. Writing is the opposite policy — `parseRichText` refuses.
      for (const value of [null, undefined, 42, "text", {}, { sections: "no" }]) {
        expect(readRichText(value)).toEqual(EMPTY_DOC);
      }
    });
  });

  describe("derived text", () => {
    it("gives one line per block, for an excerpt or a search index", () => {
      const body = parseRichText(
        doc(
          { type: "heading", attrs: { level: 2 }, content: [text("Clubul")] },
          paragraph(text("Alergăm "), text("împreună", [{ type: "bold" }])),
          { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("luni"))] }] },
        ),
      );

      expect(richTextToPlainText(body)).toBe("Clubul\nAlergăm împreună\nluni");
    });

    it("calls a body of empty paragraphs empty, because it shows nothing", () => {
      expect(isRichTextEmpty(EMPTY_DOC)).toBe(true);
      expect(isRichTextEmpty(parseRichText(doc(paragraph(), paragraph())))).toBe(true);
      expect(isRichTextEmpty(parseRichText(doc(paragraph(text("a")))))).toBe(false);
    });
  });
});
