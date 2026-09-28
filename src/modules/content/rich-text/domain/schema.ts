import { z } from "zod";

/**
 * The editorial body as stored: Tiptap/ProseMirror JSON restricted to the allowlist of
 * `AGENTS.md` §11.3. The browser posts whatever it likes, so this module alone decides what a
 * body may contain, and the renderer draws through the same set.
 *
 * Attributes are read with `z.object`, which drops unnamed keys (Tiptap's link `target`, `rel`,
 * `class`); the renderer decides those. Unknown node types are refused, not stripped, so nothing
 * the club wrote is silently deleted. Not allowed: nested lists (§1.5 rule 2); code, strike,
 * underline, rules, hard breaks — adding one is a rule change.
 */

/** `http(s)` and `mailto` for the outside world, a rooted path for this site, and nothing else. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * A link target that cannot become script (`javascript:`): an absolute URL needs a safe protocol,
 * anything else must be a rooted path. `//host` is refused as a disguised off-site jump.
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

/** Empty strings are refused: ProseMirror never produces them. */
const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(mark).optional(),
});

const inlineContent = z.array(textNode).optional();

/**
 * Text alignment (§213): a closed set, never a CSS value; no `justify` (rivers at 320 px).
 * `attrs` is optional so older bodies parse byte-identical (golden-string tests); absent is `left`.
 */
export const BLOCK_ALIGNMENTS = ["left", "center", "right"] as const;
export type BlockAlignment = (typeof BLOCK_ALIGNMENTS)[number];

const blockAlign = z
  .union([z.literal("left"), z.literal("center"), z.literal("right")])
  .nullish();

const blockAlignAttrs = z.object({ align: blockAlign }).optional();

/** Absent, null and "left" are the same. */
export function alignmentOf(attrs: { align?: BlockAlignment | null } | undefined): BlockAlignment {
  return attrs?.align ?? "left";
}

const paragraphNode = z.object({
  type: z.literal("paragraph"),
  attrs: blockAlignAttrs,
  content: inlineContent,
});

/** Levels 2 and 3 only: the page's title is the one `h1` (`AGENTS.md` §18.2). */
const headingNode = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]), align: blockAlign }),
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
  attrs: z.object({ start: z.number().int().min(1).max(9999) }).optional(),
  content: z.array(listItemNode).min(1),
});

const blockquoteNode = z.object({
  type: z.literal("blockquote"),
  content: z.array(paragraphNode).min(1),
});

/**
 * A table (§196), the smallest that carries a few columns of short facts: cells hold paragraphs
 * or lists, never a table. `colspan`/`rowspan` are kept (bounded) so merged headers survive;
 * `colwidth` is kept and read as a proportion, never pixels (§271).
 *
 * `borders` and `valign` are per table, not per cell (§263); horizontal centring is the
 * paragraph's own alignment (§213). Absent `attrs` means the defaults, so older tables parse
 * byte-identical.
 */
export const TABLE_BORDERS = ["all", "rows", "none"] as const;
export type TableBorders = (typeof TABLE_BORDERS)[number];
export const TABLE_VALIGNS = ["top", "middle"] as const;
export type TableValign = (typeof TABLE_VALIGNS)[number];

/**
 * Line and header colours (§271): palette names mapped in `table-layout.ts`, never a typed colour,
 * so a body carries no CSS and both schemes stay readable.
 */
export const TABLE_BORDER_COLOURS = ["default", "strong", "blue", "orange"] as const;
export type TableBorderColour = (typeof TABLE_BORDER_COLOURS)[number];
export const TABLE_HEADER_FILLS = ["default", "none", "blue", "orange"] as const;
export type TableHeaderFill = (typeof TABLE_HEADER_FILLS)[number];

export type TableStyle = {
  borders: TableBorders;
  valign: TableValign;
  borderColour: TableBorderColour;
  headerFill: TableHeaderFill;
};

type TableStyleAttrs = {
  borders?: TableBorders | null;
  valign?: TableValign | null;
  borderColour?: TableBorderColour | null;
  headerFill?: TableHeaderFill | null;
};

/** Absent, null and the default are the same. */
export function tableStyleOf(attrs: TableStyleAttrs | undefined): TableStyle {
  return {
    borders: attrs?.borders ?? "all",
    valign: attrs?.valign ?? "top",
    borderColour: attrs?.borderColour ?? "default",
    headerFill: attrs?.headerFill ?? "default",
  };
}

/**
 * Column widths as fractions of the table, or `null` when unsized. Read from the first row (what
 * a `<colgroup>` describes); a first row with a `colspan` gives `null`, its count would be wrong.
 */
export function tableColumnFractions(
  rows: readonly {
    content: readonly { attrs?: { colwidth?: readonly (number | null)[] | null; colspan?: number } }[];
  }[],
): number[] | null {
  const first = rows[0];
  if (!first) return null;
  if (first.content.some((cell) => (cell.attrs?.colspan ?? 1) !== 1)) return null;
  const widths = first.content.map((cell) => cell.attrs?.colwidth?.[0] ?? null);
  if (widths.some((width) => width === null || width <= 0)) return null;
  const total = (widths as number[]).reduce((sum, width) => sum + width, 0);
  return total > 0 ? (widths as number[]).map((width) => width / total) : null;
}

const SPAN = z.number().int().min(1).max(20).optional();

/**
 * ProseMirror's measured pixels per spanned column (§271), read only as proportions. `null` marks
 * an unsized column and must survive, or resizing one column resets its neighbours.
 */
const COLWIDTH = z.array(z.number().int().min(10).max(4000).nullable()).max(20).nullish();

const tableCellContent = z.array(z.union([paragraphNode, bulletListNode, orderedListNode])).min(1);

const tableCellNode = z.object({
  type: z.literal("tableCell"),
  attrs: z.object({ colspan: SPAN, rowspan: SPAN, colwidth: COLWIDTH }).optional(),
  content: tableCellContent,
});

const tableHeaderNode = z.object({
  type: z.literal("tableHeader"),
  attrs: z.object({ colspan: SPAN, rowspan: SPAN, colwidth: COLWIDTH }).optional(),
  content: tableCellContent,
});

const tableRowNode = z.object({
  type: z.literal("tableRow"),
  content: z.array(z.union([tableCellNode, tableHeaderNode])).min(1),
});

const tableNode = z.object({
  type: z.literal("table"),
  attrs: z
    .object({
      borders: z.union([z.literal("all"), z.literal("rows"), z.literal("none")]).nullish(),
      valign: z.union([z.literal("top"), z.literal("middle")]).nullish(),
      borderColour: z.enum(TABLE_BORDER_COLOURS).nullish(),
      headerFill: z.enum(TABLE_HEADER_FILLS).nullish(),
    })
    .optional(),
  content: z.array(tableRowNode).min(1),
});

/**
 * A picture (§11.3's media reference; §72, §73): a block, never inline. `src` must be one of
 * this site's stored WebP variants, never a data URI or a third party. Empty `alt` means
 * decorative. `width`/`height` reserve the space. `widthPercent` and `align` are closed sets,
 * never CSS; absent reads as 100 and `block`.
 */
/**
 * `crop` (§241): four fractions of the stored picture, never pixels; absent is the whole
 * photograph. The refinements keep the rectangle inside the picture.
 */
const cropFraction = z.number().min(0).max(1);
const imageCrop = z
  .object({
    x: cropFraction,
    y: cropFraction,
    w: z.number().min(0.02).max(1),
    h: z.number().min(0.02).max(1),
  })
  .strict()
  .refine((crop) => crop.x + crop.w <= 1.0001, "a crop must end inside the picture")
  .refine((crop) => crop.y + crop.h <= 1.0001, "a crop must end inside the picture");

export type ImageCrop = z.infer<typeof imageCrop>;

/** For a crop kept outside a document, e.g. «Echipa»'s photograph (§541). */
export const imageCropSchema = imageCrop;

export const WHOLE_IMAGE: ImageCrop = { x: 0, y: 0, w: 1, h: 1 };

/** `null` for a rectangle covering the whole photograph, decided in one place. */
export function meaningfulCrop(crop: ImageCrop | null | undefined): ImageCrop | null {
  if (!crop) return null;
  return crop.w >= 0.999 && crop.h >= 0.999 ? null : crop;
}

/**
 * `focus` (§454): the point the listing card's 16∶9 frame centres on, as fractions; absent is the
 * crop's middle. Ignored on the event page.
 */
const imageFocus = z.object({ x: cropFraction, y: cropFraction }).strict();

export type ImageFocus = z.infer<typeof imageFocus>;

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
    crop: imageCrop
      .nullable()
      .optional()
      .transform((value) => meaningfulCrop(value)),
    // No transform: absent stays absent, so older JSON round-trips exactly.
    focus: imageFocus.nullable().optional(),
  }),
});

/**
 * A YouTube film (§110, §266): the video id only, never a URL or iframe; the renderer builds the
 * `youtube-nocookie.com` embed and fetches nothing before the press (§69). `widthPercent` and
 * `align` are the picture's closed sets, with the same defaults.
 */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/**
 * A poster must be this site's stored copy (§72, §403): a third-party host would be a pre-click
 * request (§69, §110) and could break out of a CSS `url(…)`. Keys are `yt-<id>`
 * (`video-poster.ts#posterKeyPrefix`) or, for a club upload, a UUID.
 */
const posterSrc = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) =>
      /\/(?:yt-[A-Za-z0-9_-]{11}|[0-9a-f-]{36})\/web\.webp$/.test(value) &&
      (value.startsWith("https://") || value.startsWith("/api/media/")),
    "a poster must be one this site stored",
  );
const youtubeNode = z.object({
  type: z.literal("youtube"),
  attrs: z.object({
    videoId: z.string().regex(YOUTUBE_ID, "a YouTube video id is eleven characters"),
    caption: z.string().max(500).nullable().optional().transform((value) => value ?? ""),
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
    /**
     * The stored thumbnail (§403), a URL like `src` so `media/references.ts`'s text search finds
     * it. Null: none stored yet.
     */
    poster: posterSrc.nullable().optional().transform((value) => value ?? null),
    /** `"club"` once an organizer picked one; `attachYoutubePosters` never replaces it (§403). */
    posterSource: z
      .union([z.literal("club"), z.literal("youtube")])
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    /**
     * The poster's size (§414): the width selects ladder rungs; also written for a crop (§485),
     * whose shape needs the ratio (a `yt-` poster has no ladder). No transform, for exact JSON.
     */
    posterWidth: z.number().int().min(1).max(12_000).nullable().optional(),
    posterHeight: z.number().int().min(1).max(12_000).nullable().optional(),
    /** The poster's crop for the 16∶9 box (§485, §241's fractions); needs the poster's size. */
    posterCrop: imageCrop.nullable().optional(),
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

/** Stored rather than `null`, so a reader never branches on absence. */
export const EMPTY_DOC: RichTextDoc = { type: "doc", content: [] };

/**
 * The pre-editor shape: sections of a plain heading and paragraphs. Legal documents keep it for
 * good, since `content_sha256` is computed over it (`AGENTS.md` §12.5, §46).
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
 * Any stored body as a renderable document: a read-time adapter rather than a migration, so old
 * and new rows both work across a deploy (`AGENTS.md` §7.6). Unparseable reads as empty rather
 * than throwing, since this runs on public pages.
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

/** Strict parse for writing, unlike `readRichText`: invalid input throws. Unknown attributes are dropped. */
export function parseRichText(value: unknown): RichTextDoc {
  return richTextSchema.parse(value);
}

/** The document's words (§11.3), one line per block. */
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
        return [block.attrs.alt, block.attrs.caption];
      case "youtube":
        return [block.attrs.caption];
      case "table":
        // One line per row, cells tab-separated (§196): pastes into a spreadsheet, invisible to word counts.
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

/** A body of empty paragraphs is still empty. */
export function isRichTextEmpty(doc: RichTextDoc): boolean {
  return richTextToPlainText(doc).trim() === "";
}

/** A plain string as a one-paragraph document (older short descriptions). */
export function fromPlainText(text: string | null | undefined): RichTextDoc {
  if (!text || text.trim() === "") return EMPTY_DOC;
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

/** Words, or a picture or film without any. */
export function hasRichTextContent(doc: RichTextDoc): boolean {
  return !isRichTextEmpty(doc) || (doc.content ?? []).some((block) => block.type === "image" || block.type === "youtube");
}

export function countImagesWithoutAlt(doc: RichTextDoc): number {
  return (doc.content ?? []).filter((block) => block.type === "image" && block.attrs.alt.trim() === "").length;
}
