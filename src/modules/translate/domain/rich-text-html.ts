import type { RichTextBlock, RichTextDoc, RichTextText } from "@/modules/content/rich-text/domain/schema";

/**
 * A rich text translated without losing its layout (`DECISIONS.md` §464). Only the words leave:
 * each block's inline content as HTML, pictures' alt/caption and films' caption as plain text.
 * They return into a copy of the same document, so every structure and attribute is the
 * Romanian document's by construction.
 *
 * Inline HTML uses `<b>`, `<i>` and `<a data-l="N">` (N indexes a local list): a link's address
 * is never sent, so the provider cannot rewrite it. Invented tags are dropped, their words kept.
 */

export type InlineHtml = { html: string; links: string[] };

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

/** Empty text is dropped (the schema refuses it) and same-mark neighbours joined, as the editor stores them. */
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
    // Any other tag is dropped, its words kept.
  }
  return nodes;
}

const isBlank = (text: string | undefined) => (text ?? "").trim() === "";
const inlineIsBlank = (content: readonly RichTextText[] | undefined) => (content ?? []).every((node) => isBlank(node.text));

type Visitor = {
  inline: (content: RichTextText[] | undefined) => RichTextText[] | undefined;
  plain: (text: string, max: number) => string;
};

/** The one walk both collecting and restoring use, so they cannot disagree on the pieces' order. */
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

/** Only pieces with words in them. */
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

/** Translations in `richTextSegments`' order; alt and caption are cut to the schema's limits, as a translation may run longer. */
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

/** Characters sent, tags included — the stricter count. */
export function segmentCharacters(segment: RichTextSegment): number {
  return segment.format === "html" ? segment.html.length : segment.text.length;
}
