import { z } from "zod";

/**
 * The editorial body, as stored: Tiptap/ProseMirror JSON restricted to the node and mark set
 * `AGENTS.md` §11.3 allows, and nothing else.
 *
 * ## Why a schema of our own rather than trusting the editor
 *
 * The editor runs in the club's browser, so what arrives at the server is whatever that browser
 * chose to post — a different build, a stale tab, or somebody typing into the network panel.
 * §11.3 is explicit: validate on the server, reject unknown nodes, marks and attributes, and
 * render through the same allowlist. This module is that allowlist, and it is the only thing
 * that decides what a body may contain.
 *
 * ## Why the output type is the canonical stored shape
 *
 * Each node's attributes are read with `z.object`, which **drops** keys it does not name. Tiptap
 * emits `target`, `rel` and `class` on a link; none of them survive parsing, so the stored
 * document carries an `href` and the renderer decides the rest (an external link gets its own
 * `rel`, every time, rather than trusting one that was stored years ago). Node *types* are a
 * different matter and are a discriminated union: an unknown type is refused, not stripped,
 * because dropping a node would silently delete something the club wrote.
 *
 * ## What is deliberately not here
 *
 * - **Nested lists.** A list item holds paragraphs. Nesting is one `z.lazy` away and nothing has
 *   asked for it; recursion costs legibility (§1.5 rule 2) and buys a sub-bullet.
 * - **Images.** §11.3 allows a media-library reference "if implemented", and there is no media
 *   library: no bucket, no upload route, and uploads are the one unguarded surface in §19.4.
 *   When that exists, an `image` node joins this union and the renderer grows one case.
 * - **Code, strike, underline, horizontal rules, hard breaks.** Tiptap's StarterKit ships them;
 *   §11.3 does not list them, so `RichTextEditor` switches them off and this schema would refuse
 *   them anyway. Adding one is a rule change, not a configuration change.
 */

/** `http(s)` and `mailto` for the outside world, a rooted path for this site, and nothing else. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * A link target that cannot become script execution.
 *
 * `javascript:alert(1)` is a valid URL whose protocol is `javascript:`, and an `href` is one of
 * the few places a string becomes code. Anything that parses as absolute must carry a protocol
 * from the set above; anything else is accepted only as a site-relative path, which cannot carry
 * a protocol at all. `//evil.example` is refused with it: it parses as protocol-relative and is
 * an off-site jump that does not look like one.
 */
function isSafeHref(value: string): boolean {
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  try {
    return SAFE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

const href = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(isSafeHref, "a link must be http(s), mailto, or a path on this site");

const boldMark = z.strictObject({ type: z.literal("bold") });
const italicMark = z.strictObject({ type: z.literal("italic") });
const linkMark = z.object({
  type: z.literal("link"),
  attrs: z.object({ href }),
});

const mark = z.discriminatedUnion("type", [boldMark, italicMark, linkMark]);

/**
 * Text, with its marks. Empty strings are refused: ProseMirror does not produce them, and one
 * arriving means something built this document by hand.
 */
const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(mark).optional(),
});

/** Inline content is text alone until a media library exists. */
const inlineContent = z.array(textNode).optional();

const paragraphNode = z.object({
  type: z.literal("paragraph"),
  content: inlineContent,
});

/**
 * Headings start at level 2. Level 1 is the page's own title, rendered by the page and never by
 * the body — two `h1`s on one page is a heading order a screen reader cannot make sense of
 * (`AGENTS.md` §18.2).
 */
const headingNode = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: inlineContent,
});

const listItemNode = z.object({
  type: z.literal("listItem"),
  content: z.array(paragraphNode).min(1),
});

const bulletListNode = z.object({
  type: z.literal("bulletList"),
  content: z.array(listItemNode).min(1),
});

const orderedListNode = z.object({
  type: z.literal("orderedList"),
  // Tiptap tracks where an ordered list starts counting; anything else it emits is dropped.
  attrs: z.object({ start: z.number().int().min(1).max(9999) }).optional(),
  content: z.array(listItemNode).min(1),
});

const blockquoteNode = z.object({
  type: z.literal("blockquote"),
  content: z.array(paragraphNode).min(1),
});

/**
 * A table (`DECISIONS.md` §196; the owner: "ar fi fain să pot face tabele în editor!").
 *
 * What a running club puts in one is a schedule of waves, a price list, a table of cut-offs — a
 * few columns of short facts. So the allowlist is deliberately the smallest table that can carry
 * those and nothing that turns a page into a layout:
 *
 * - **Cells hold blocks, not arbitrary documents.** A paragraph or a list, which is what a fact
 *   with a note under it looks like. No table inside a table: nesting is where a text editor
 *   becomes a spreadsheet, and where a phone runs out of width.
 * - **`colspan` and `rowspan` are kept**, because Tiptap emits them for a merged header and a
 *   table that lost its merges on the way through the allowlist would be silently rearranged.
 *   Both are bounded: a span beyond the table is a way to make a page render strangely.
 * - **`colwidth` is dropped.** It is a pixel width chosen on somebody's laptop, and this site's
 *   hard target is a 320-pixel column. The renderer decides widths.
 *
 * A header row is `tableHeader` cells, which is Tiptap's own shape; the renderer turns them into
 * `<th>` with a scope, so a screen reader announces which column a figure belongs to.
 */
const SPAN = z.number().int().min(1).max(20).optional();

const tableCellContent = z.array(z.union([paragraphNode, bulletListNode, orderedListNode])).min(1);

const tableCellNode = z.object({
  type: z.literal("tableCell"),
  attrs: z.object({ colspan: SPAN, rowspan: SPAN }).optional(),
  content: tableCellContent,
});

const tableHeaderNode = z.object({
  type: z.literal("tableHeader"),
  attrs: z.object({ colspan: SPAN, rowspan: SPAN }).optional(),
  content: tableCellContent,
});

const tableRowNode = z.object({
  type: z.literal("tableRow"),
  content: z.array(z.union([tableCellNode, tableHeaderNode])).min(1),
});

const tableNode = z.object({
  type: z.literal("table"),
  content: z.array(tableRowNode).min(1),
});

/**
 * A picture (AGENTS.md §11.3's "media-library image reference", `DECISIONS.md` §72, §73): a
 * block of its own, never inline in a paragraph, so a page is text with pictures between
 * paragraphs rather than a layout. `src` is the address the upload route answered — one of
 * this application's own WebP variants, on the store's public host or the local `/api/media`
 * route — and nothing else: not a data URI, not a third party's image, not a page. `alt` is
 * what a screen reader says; empty means decorative, and it is empty until somebody writes it
 * (a file name is not a description). `caption` is a sentence under the picture, visible to
 * everybody. `width`/`height` are the variant's, so the page reserves the space before the
 * bytes arrive; `widthPercent` is how much of the text column the picture takes on a wide
 * screen — one of four sizes, never a free number, and always the full width on a phone.
 *
 * `align` is where the picture sits in that column: `block` is a band across it, the way every
 * picture written before 2026-09-20 sits and the way every picture sits on a phone, and `left`
 * or `right` floats it so the paragraphs beside it wrap around (the owner: "vreau sa pot seta
 * imaginile ca si «inline» ca sa pot scrie text in stanga sau dreapta lor"). A closed set of
 * three words, exactly as `widthPercent` is a closed set of four numbers: the attribute names a
 * rendering the renderer knows, never a CSS value somebody typed. Absent — every stored document
 * — it reads as `block`, so nothing written before this renders differently.
 */
export const IMAGE_WIDTH_PERCENTS = [100, 75, 50, 33] as const;
export type ImageWidthPercent = (typeof IMAGE_WIDTH_PERCENTS)[number];
export const IMAGE_ALIGNMENTS = ["block", "left", "right"] as const;
export type ImageAlignment = (typeof IMAGE_ALIGNMENTS)[number];
const imageSrc = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) =>
      /\/[0-9a-f-]{36}\/web\.webp$/.test(value) &&
      (value.startsWith("https://") || value.startsWith("/api/media/")),
    "a picture must be one this site stored",
  );

const imageNode = z.object({
  type: z.literal("image"),
  attrs: z.object({
    src: imageSrc,
    alt: z.string().max(300).nullable().optional().transform((value) => value ?? ""),
    caption: z.string().max(500).nullable().optional().transform((value) => value ?? ""),
    width: z.number().int().min(1).max(12_000).nullable().optional(),
    height: z.number().int().min(1).max(12_000).nullable().optional(),
    widthPercent: z
      .union([z.literal(100), z.literal(75), z.literal(50), z.literal(33)])
      .nullable()
      .optional()
      .transform((value) => value ?? 100),
    align: z
      .union([z.literal("block"), z.literal("left"), z.literal("right")])
      .nullable()
      .optional()
      .transform((value) => value ?? "block"),
  }),
});

/**
 * A YouTube film between paragraphs (`DECISIONS.md` §110): the eleven-character video id and
 * nothing else — never a URL, never an iframe, never a third host. The renderer builds the
 * `youtube-nocookie.com` embed from the id behind a closed disclosure, as the event's own film
 * is shown (§69): nothing is fetched from Google until the reader presses. `caption` is the
 * sentence under it, visible to everybody.
 */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const youtubeNode = z.object({
  type: z.literal("youtube"),
  attrs: z.object({
    videoId: z.string().regex(YOUTUBE_ID, "a YouTube video id is eleven characters"),
    caption: z.string().max(500).nullable().optional().transform((value) => value ?? ""),
  }).strict(),
});

const blockNode = z.discriminatedUnion("type", [
  paragraphNode,
  headingNode,
  bulletListNode,
  orderedListNode,
  blockquoteNode,
  imageNode,
  youtubeNode,
  tableNode,
]);

export const richTextSchema = z.object({
  type: z.literal("doc"),
  content: z.array(blockNode).optional(),
});

export type RichTextDoc = z.infer<typeof richTextSchema>;
export type RichTextBlock = z.infer<typeof blockNode>;
export type RichTextText = z.infer<typeof textNode>;

/** What an untouched body is. Stored rather than `null`, so a reader never branches on absence. */
export const EMPTY_DOC: RichTextDoc = { type: "doc", content: [] };

/**
 * The shape bodies were stored in before the editor existed: a flat list of sections, each an
 * optional plain-text heading and its plain-text paragraphs, produced by a textarea where a
 * blank line separated paragraphs and `##` began a heading.
 *
 * Legal documents still use it and always will — `content_sha256` is computed over it and
 * published under a version number, so changing the shape would invalidate every hash a
 * participant's acceptance names (`AGENTS.md` §12.5, `DECISIONS.md` §46).
 */
type LegacyBody = { sections: { heading?: string; paragraphs: string[] }[] };

function isLegacyBody(value: unknown): value is LegacyBody {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { sections?: unknown }).sections)
  );
}

function paragraphsOf(texts: readonly unknown[]): RichTextBlock[] {
  return texts
    .filter((text): text is string => typeof text === "string" && text.trim() !== "")
    .map((text) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] }));
}

/**
 * Read any stored body as a document this application can render.
 *
 * **A read-time adapter rather than a migration**, deliberately. A push starts the deployment and
 * any migration at the same moment, so for a few seconds the running code and the stored rows
 * disagree (`AGENTS.md` §7.6). Converting on read means old rows and new rows both work during
 * that window and for as long afterwards as nobody edits them — the expand half of
 * expand/contract, with the contract half optional and safe to do any time.
 *
 * Anything unrecognisable reads as empty rather than throwing: this runs while rendering a public
 * page, and a body nobody can parse should cost a paragraph, not the whole page.
 */
export function readRichText(value: unknown): RichTextDoc {
  const parsed = richTextSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  if (isLegacyBody(value)) {
    return {
      type: "doc",
      content: value.sections.flatMap((section) => [
        ...(typeof section.heading === "string" && section.heading.trim() !== ""
          ? [
              {
                type: "heading" as const,
                attrs: { level: 2 as const },
                content: [{ type: "text" as const, text: section.heading }],
              },
            ]
          : []),
        ...paragraphsOf(Array.isArray(section.paragraphs) ? section.paragraphs : []),
      ]),
    };
  }

  return EMPTY_DOC;
}

/**
 * Parse a body that is about to be **written**, strictly.
 *
 * The opposite policy to `readRichText`: on the way in, anything that does not validate is a
 * refusal, because storing it would mean the club's page contains something this application
 * never agreed to render. Returns the canonical document — unknown attributes already dropped.
 */
export function parseRichText(value: unknown): RichTextDoc {
  return richTextSchema.parse(value);
}

/**
 * The document's words, for an excerpt, a search index or a reading time (§11.3 requires this to
 * be derivable). One line per block, so a heading does not run into the paragraph beneath it.
 */
export function richTextToPlainText(doc: RichTextDoc): string {
  const inline = (content: RichTextText[] | undefined) =>
    (content ?? []).map((node) => node.text).join("");

  const blockText = (block: RichTextBlock): string[] => {
    switch (block.type) {
      case "paragraph":
      case "heading":
        return [inline(block.content)];
      case "blockquote":
        return block.content.map((paragraph) => inline(paragraph.content));
      case "bulletList":
      case "orderedList":
        return block.content.flatMap((item) =>
          item.content.map((paragraph) => inline(paragraph.content)),
        );
      case "image":
        // A picture's words are its alt text and its caption: what a screen reader says and
        // what everybody reads beneath it. A decorative, uncaptioned picture contributes nothing.
        return [block.attrs.alt, block.attrs.caption];
      case "youtube":
        // A film's words are its caption; the id is not a word.
        return [block.attrs.caption];
      case "table":
        /*
          A table's words are its cells, row by row, each row on one line with its cells
          separated (§196).

          This projection is what the excerpt, the calendar entry and the search index read, and
          all three are single-column plain text — so a table has to become sentences rather than
          a grid. Tab between cells rather than a pipe: a tab is what a spreadsheet takes if
          somebody pastes the line, and it is invisible where the line is only being counted for
          words.
        */
        return block.content.map((row) =>
          row.content
            .flatMap((cell) => cell.content.flatMap(blockText))
            .map((line) => line.trim())
            .filter((line) => line !== "")
            .join("	"),
        );
    }
  };

  return (doc.content ?? [])
    .flatMap(blockText)
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/** Whether there is anything to render — a body of empty paragraphs is still empty. */
export function isRichTextEmpty(doc: RichTextDoc): boolean {
  return richTextToPlainText(doc).trim() === "";
}

/** A plain string read as a one-paragraph document — how a short description written before the editor is shown in it. */
export function fromPlainText(text: string | null | undefined): RichTextDoc {
  if (!text || text.trim() === "") return EMPTY_DOC;
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

/** Whether a body holds anything at all — words, or a picture with nothing said about it. */
export function hasRichTextContent(doc: RichTextDoc): boolean {
  return !isRichTextEmpty(doc) || (doc.content ?? []).some((block) => block.type === "image" || block.type === "youtube");
}

/** The pictures in a body that a screen reader would have nothing to say for. */
export function countImagesWithoutAlt(doc: RichTextDoc): number {
  return (doc.content ?? []).filter((block) => block.type === "image" && block.attrs.alt.trim() === "").length;
}
