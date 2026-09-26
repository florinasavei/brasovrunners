import type { RichTextBlock, RichTextDoc, RichTextText } from "@/modules/content/rich-text/domain/schema";

/**
 * A rich text translated without losing its layout (`DECISIONS.md` §464; the owner, 2026-09-26:
 * «I wanna override the descriptions and all from RO to EN so I have the same layout and all»).
 *
 * **The structure never leaves the site.** A document is walked block by block; what goes to the
 * provider is only the words: each paragraph's, heading's, list item's and table cell's inline
 * content as a line of HTML, and each picture's alt text and caption and each film's caption as
 * plain text. What comes back is put into a copy of the same document at the same places. So the
 * headings, the lists, the tables and their styles, the pictures with their address, size, crop
 * and side, the films with their id and poster — every attribute — are the Romanian document's,
 * byte for byte, and the two languages have the same layout by construction rather than by
 * whatever the provider chose to return.
 *
 * **Inline content is HTML of four tags**, which is what DeepL's `tag_handling: "html"` keeps
 * around the words it moves: `<b>`, `<i>`, and `<a data-l="N">`, where N is the link's index in a
 * list kept here. The link's address is never sent — only its place among the words — so a
 * provider cannot rewrite a URL, and the address is restored from the list on the way back. Text
 * is escaped on the way out and unescaped on the way in; any tag the provider invents is dropped
 * and its words kept.
 */

export type InlineHtml = { html: string; links: string[] };

/** One piece of a document the provider translates: a line of inline HTML, or a picture's or a film's words. */
export type RichTextSegment = { format: "html"; html: string; links: string[] } | { format: "text"; text: string };

const ALT_MAX = 300;
const CAPTION_MAX = 500;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** A paragraph's inline content as the four-tag HTML the provider is sent, with its links' addresses kept aside. */
export function inlineToHtml(content: readonly RichTextText[] | undefined): InlineHtml {
  const links: string[] = [];
  let html = "";
  for (const node of content ?? []) {
    let piece = escapeHtml(node.text);
    const marks = node.marks ?? [];
    if (marks.some((mark) => mark.type === "italic")) piece = `<i>${piece}</i>`;
    if (marks.some((mark) => mark.type === "bold")) piece = `<b>${piece}</b>`;
    const link = marks.find((mark) => mark.type === "link");
    if (link && link.type === "link") {
      let index = links.indexOf(link.attrs.href);
      if (index === -1) index = links.push(link.attrs.href) - 1;
      piece = `<a data-l="${index}">${piece}</a>`;
    }
    html += piece;
  }
  return { html, links };
}

type Mark = NonNullable<RichTextText["marks"]>[number];

function sameMarks(a: readonly Mark[] | undefined, b: readonly Mark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/**
 * The provider's HTML back into inline content: the words with the marks the tags around them
 * say, the links' addresses from the list, empty text dropped (the schema refuses it) and
 * neighbours with the same marks joined, as the editor itself would store them.
 */
export function htmlToInline(html: string, links: readonly string[]): RichTextText[] {
  const nodes: RichTextText[] = [];
  let bold = 0;
  let italic = 0;
  const linkStack: (string | null)[] = [];
  const pattern = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)|(<)/gi;
  for (const match of html.matchAll(pattern)) {
    const [, closing, tagName, attributes, words, strayBracket] = match;
    if (words !== undefined || strayBracket !== undefined) {
      const text = unescapeHtml(words ?? "<");
      if (text === "") continue;
      const marks: Mark[] = [];
      if (bold > 0) marks.push({ type: "bold" });
      if (italic > 0) marks.push({ type: "italic" });
      const href = linkStack.findLast((entry) => entry !== null);
      if (href) marks.push({ type: "link", attrs: { href } });
      const previous = nodes.at(-1);
      if (previous && sameMarks(previous.marks, marks)) previous.text += text;
      else nodes.push(marks.length > 0 ? { type: "text", text, marks } : { type: "text", text });
      continue;
    }
    const tag = (tagName ?? "").toLowerCase();
    const step = closing ? -1 : 1;
    if (tag === "b" || tag === "strong") bold = Math.max(0, bold + step);
    else if (tag === "i" || tag === "em") italic = Math.max(0, italic + step);
    else if (tag === "a") {
      if (closing) linkStack.pop();
      else {
        const index = /data-l\s*=\s*"?(\d+)"?/i.exec(attributes ?? "")?.[1];
        linkStack.push(index !== undefined ? (links[Number(index)] ?? null) : null);
      }
    }
    // Any other tag — a <br>, a <span> the provider wrapped round a word — is dropped, its words kept.
  }
  return nodes;
}

const isBlank = (text: string | undefined) => (text ?? "").trim() === "";
const inlineIsBlank = (content: readonly RichTextText[] | undefined) => (content ?? []).every((node) => isBlank(node.text));

type Visitor = {
  inline: (content: RichTextText[] | undefined) => RichTextText[] | undefined;
  plain: (text: string, max: number) => string;
};

/**
 * Every block of a document, rebuilt with its words passed through the visitor and everything
 * else as it was. The one walk both halves use — collecting what to send and putting back what
 * came — so the two can never disagree about the order of the pieces.
 */
function walkDoc(doc: RichTextDoc, visit: Visitor): RichTextDoc {
  const paragraph = <P extends { content?: RichTextText[] }>(node: P): P => {
    const content = visit.inline(node.content);
    // A paragraph stored without `content` stays without it, so an empty line is byte-identical.
    return (content === undefined ? node : { ...node, content }) as P;
  };
  const block = (node: RichTextBlock): RichTextBlock => {
    switch (node.type) {
      case "paragraph":
      case "heading":
        return paragraph(node);
      case "blockquote":
        return { ...node, content: node.content.map(paragraph) };
      case "bulletList":
      case "orderedList":
        return { ...node, content: node.content.map((item) => ({ ...item, content: item.content.map(paragraph) })) };
      case "table":
        return {
          ...node,
          content: node.content.map((row) => ({
            ...row,
            content: row.content.map((cell) => ({
              ...cell,
              content: cell.content.map((inner) =>
                inner.type === "paragraph" ? paragraph(inner) : { ...inner, content: inner.content.map((item) => ({ ...item, content: item.content.map(paragraph) })) },
              ),
            })),
          })),
        } as RichTextBlock;
      case "image":
        return { ...node, attrs: { ...node.attrs, alt: visit.plain(node.attrs.alt, ALT_MAX), caption: visit.plain(node.attrs.caption, CAPTION_MAX) } };
      case "youtube":
        return { ...node, attrs: { ...node.attrs, caption: visit.plain(node.attrs.caption, CAPTION_MAX) } };
    }
  };
  return { ...doc, ...(doc.content ? { content: doc.content.map(block) } : {}) };
}

/** What of a document the provider is sent, in order: only pieces with words in them. */
export function richTextSegments(doc: RichTextDoc): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  walkDoc(doc, {
    inline: (content) => {
      if (!inlineIsBlank(content)) segments.push({ format: "html", ...inlineToHtml(content) });
      return content;
    },
    plain: (text) => {
      if (!isBlank(text)) segments.push({ format: "text", text });
      return text;
    },
  });
  return segments;
}

/**
 * The same document with each piece replaced by its translation, in `richTextSegments`' order.
 * A picture's alt and caption are cut to the schema's limits, since a translation can be longer
 * than the words it came from; a paragraph whose translation has no words keeps none.
 */
export function withTranslatedSegments(doc: RichTextDoc, translations: readonly string[]): RichTextDoc {
  const segments = richTextSegments(doc);
  if (segments.length !== translations.length) throw new Error("a translation for every piece, and no more");
  let next = 0;
  return walkDoc(doc, {
    inline: (content) => {
      if (inlineIsBlank(content)) return content;
      const segment = segments[next];
      const translated = translations[next];
      next += 1;
      return segment?.format === "html" && translated !== undefined ? htmlToInline(translated, segment.links) : content;
    },
    plain: (text, max) => {
      if (isBlank(text)) return text;
      const translated = translations[next] ?? text;
      next += 1;
      return translated.trim().slice(0, max);
    },
  });
}

/** What a piece costs against the budget: the characters sent, tags included — the stricter count. */
export function segmentCharacters(segment: RichTextSegment): number {
  return segment.format === "html" ? segment.html.length : segment.text.length;
}
