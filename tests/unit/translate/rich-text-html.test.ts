import { describe, expect, it } from "vitest";
import { type RichTextDoc, richTextSchema } from "@/modules/content/rich-text/domain/schema";
import { htmlToInline, inlineToHtml, richTextSegments, withTranslatedSegments } from "@/modules/translate/domain/rich-text-html";

/**
 * §464 — «Tradu tot din română» keeps the Romanian layout: only the words go to the provider, and
 * the answer is put back into a copy of the same document. Marks and links survive the round trip
 * through the provider's HTML; every picture, film and table keeps every attribute; a link's
 * address is never sent.
 */

const PICTURE_SRC = "/api/media/local/0f8fad5b-d9cb-469f-a165-70867728950e/web.webp";

const DOC: RichTextDoc = richTextSchema.parse({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, align: "center" }, content: [{ type: "text", text: "Traseul" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Pornim de la " },
        { type: "text", text: "Tâmpa", marks: [{ type: "bold" }] },
        { type: "text", text: " & urcăm ", marks: [{ type: "italic" }] },
        { type: "text", text: "pe traseul marcat", marks: [{ type: "link", attrs: { href: "https://example.org/traseu?a=1&b=2" } }] },
        { type: "text", text: "." },
      ],
    },
    { type: "paragraph", content: [] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Apă la km 5" }] }] }] },
    {
      type: "image",
      attrs: {
        src: PICTURE_SRC,
        alt: "Harta traseului",
        caption: "Harta, cu punctele de hidratare",
        width: 1600,
        height: 900,
        widthPercent: 50,
        align: "right",
        crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
      },
    },
    { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", caption: "Filmul de anul trecut", widthPercent: 75, align: "left" } },
    {
      type: "table",
      attrs: { borders: "rows", valign: "middle" },
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { colwidth: [120] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Ora" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Startul" }] }] },
          ],
        },
      ],
    },
  ],
});

/** A stand-in provider: English words, the tags left where they were, as DeepL's html mode does. */
const ENGLISH: Record<string, string> = {
  Traseul: "The route",
  'Pornim de la <b>Tâmpa</b><i> &amp; urcăm </i><a data-l="0">pe traseul marcat</a>.': 'We start from <b>Tâmpa</b><i> &amp; climb </i><a data-l="0">on the marked trail</a>.',
  "Apă la km 5": "Water at km 5",
  "Harta traseului": "Map of the route",
  "Harta, cu punctele de hidratare": "The map, with the water points",
  "Filmul de anul trecut": "Last year's film",
  Ora: "Time",
  Startul: "The start",
};

describe("§464 a rich text translated with its layout", () => {
  it("sends only the words: one line per block, pictures' and films' words as text, empty lines skipped, no address", () => {
    const segments = richTextSegments(DOC);
    expect(segments.map((segment) => (segment.format === "html" ? segment.html : segment.text))).toEqual(Object.keys(ENGLISH));
    const sent = JSON.stringify(segments.map((segment) => (segment.format === "html" ? segment.html : segment.text)));
    expect(sent).not.toContain("example.org");
    expect(sent).not.toContain(PICTURE_SRC);
    expect(sent).not.toContain("dQw4w9WgXcQ");
  });

  it("puts the answers back into the same structure, every attribute kept", () => {
    const answers = richTextSegments(DOC).map((segment) => ENGLISH[segment.format === "html" ? segment.html : segment.text] ?? "");
    const english = richTextSchema.parse(withTranslatedSegments(DOC, answers));

    const [heading, paragraph, empty, list, image, film, table] = english.content ?? [];
    expect(heading).toEqual({ type: "heading", attrs: { level: 2, align: "center" }, content: [{ type: "text", text: "The route" }] });
    expect(paragraph).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "We start from " },
        { type: "text", text: "Tâmpa", marks: [{ type: "bold" }] },
        { type: "text", text: " & climb ", marks: [{ type: "italic" }] },
        { type: "text", text: "on the marked trail", marks: [{ type: "link", attrs: { href: "https://example.org/traseu?a=1&b=2" } }] },
        { type: "text", text: "." },
      ],
    });
    expect(empty).toEqual({ type: "paragraph", content: [] });
    expect(list).toEqual({ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Water at km 5" }] }] }] });
    // The picture: its address, size, width, side and crop are the Romanian's; only its words changed.
    const romanianImage = DOC.content?.[4];
    expect(image).toEqual({
      ...romanianImage,
      attrs: { ...(romanianImage as { attrs: object }).attrs, alt: "Map of the route", caption: "The map, with the water points" },
    });
    const romanianFilm = DOC.content?.[5];
    expect(film).toEqual({ ...romanianFilm, attrs: { ...(romanianFilm as { attrs: object }).attrs, caption: "Last year's film" } });
    expect(table).toMatchObject({ type: "table", attrs: { borders: "rows", valign: "middle" } });
    expect(JSON.stringify(table)).toContain('"colwidth":[120]');
    expect(JSON.stringify(table)).toContain("The start");
  });

  it("refuses a mismatched number of answers rather than put words in the wrong place", () => {
    expect(() => withTranslatedSegments(DOC, ["one"])).toThrow();
  });
});

describe("§464 inline HTML, both ways", () => {
  it("round-trips marks, a link and escaped characters unchanged", () => {
    const content = [
      { type: "text" as const, text: "a < b & " },
      { type: "text" as const, text: "bold italic", marks: [{ type: "bold" as const }, { type: "italic" as const }] },
      { type: "text" as const, text: " link", marks: [{ type: "link" as const, attrs: { href: "mailto:club@example.org" } }] },
    ];
    const { html, links } = inlineToHtml(content);
    expect(html).toBe('a &lt; b &amp; <b><i>bold italic</i></b><a data-l="0"> link</a>');
    expect(links).toEqual(["mailto:club@example.org"]);
    expect(htmlToInline(html, links)).toEqual(content);
  });

  it("drops a tag the provider invented and keeps its words; an unknown link index loses only the link", () => {
    expect(htmlToInline('<span class="x">Hello</span><br/> <a data-l="7">there</a>', [])).toEqual([{ type: "text", text: "Hello there" }]);
  });

  it("decodes named and numeric entities, and never stores empty text", () => {
    expect(htmlToInline("&quot;Run&quot; &#8211; &#x2014;<b></b>", [])).toEqual([{ type: "text", text: '"Run" – —' }]);
  });
});
