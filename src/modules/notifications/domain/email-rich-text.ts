import { COLOR } from "@/theme/brand";
import {
  alignmentOf,
  richTextSchema,
  type RichTextBlock,
  type RichTextDoc,
  type RichTextText,
} from "@/modules/content/rich-text/domain/schema";
import { fillPlaceholders, placeholdersIn } from "./email-copy";

/**
 * The club's own words for a message, written in the rich-text editor (`DECISIONS.md` §270; the
 * owner, 2026-09-22: "the email template editors must also be rich text").
 *
 * ## Why a narrower allowlist than a page's body
 *
 * A page is rendered by one engine — a browser. An email is rendered by Gmail, Outlook, Apple
 * Mail and a dozen others, several of which strip `<style>`, ignore floats and refuse anything
 * that is not a table for layout. So the vocabulary here is the part of `AGENTS.md` §11.3 that
 * every mail client draws the same way: paragraphs, two heading levels, the two lists, a quote,
 * bold, italic and links. **A picture, a film and a table are refused**, each for its own
 * reason and not merely for tidiness:
 *
 * - a **picture** in an email is a request to a server the moment it is opened, which is the
 *   tracking pixel every mail client blocks by default; the one image this platform sends is
 *   the QR, and it is the message's machinery rather than its words (§247);
 * - a **film** cannot play in an inbox at all — every client renders an `<iframe>` as nothing;
 * - a **table** is how a mail client decides the whole message's layout, and a 320-pixel phone
 *   is the hard target. The facts an organizer would put in one belong on the event's page,
 *   which every message already links to.
 *
 * Refused, not stripped: silently dropping a picture would send a message whose sentences refer
 * to something that is not there. The save says which node and the editor never offers it.
 *
 * ## Why the HTML is written here rather than reusing the page's renderer
 *
 * `RichText.tsx` emits React with MUI's `sx`, which is classes in a stylesheet — and a
 * stylesheet is exactly what a mail client drops. Every rule below is an inline `style`
 * attribute on the element it belongs to, matching the ones `templates.ts` already writes by
 * hand, so a paragraph the club wrote and a paragraph the platform ships are the same paragraph
 * on the screen.
 */

/** What an email body may be made of. Anything else is a refusal that names itself. */
export const EMAIL_BODY_BLOCKS = ["paragraph", "heading", "bulletList", "orderedList", "blockquote"] as const;
type EmailBodyBlock = Extract<RichTextBlock, { type: (typeof EMAIL_BODY_BLOCKS)[number] }>;

export type EmailBodyIssue = { node: string };

/** The blocks an email cannot carry, in the order they were written. */
export function unsupportedEmailBlocks(doc: RichTextDoc): string[] {
  const allowed = new Set<string>(EMAIL_BODY_BLOCKS);
  return [...new Set((doc.content ?? []).map((block) => block.type).filter((type) => !allowed.has(type)))];
}

/** Nothing written yet — the same question `isRichTextEmpty` answers for a page's body. */
export function isEmailBodyEmpty(doc: RichTextDoc | null | undefined): boolean {
  if (!doc) return true;
  return (doc.content ?? []).every((block) => textOf(block).trim() === "");
}

/** Every `{name}` anywhere in the document, so the save can refuse one this platform cannot fill. */
export function emailBodyPlaceholders(doc: RichTextDoc): string[] {
  return (doc.content ?? []).flatMap((block) => placeholdersIn(textOf(block)));
}

/**
 * A stored document, or `null` when it is not one.
 *
 * Deliberately total: a body that cannot be parsed makes the platform's own text win, exactly
 * as an unreadable settings row does in `readEmailCopy`. A message still goes out.
 */
export function readEmailBody(value: unknown): RichTextDoc | null {
  const parsed = richTextSchema.safeParse(value);
  if (!parsed.success) return null;
  return unsupportedEmailBlocks(parsed.data).length > 0 ? null : parsed.data;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Put the message's facts in, or leave the placeholders as they were written.
 *
 * `null` is what deriving the stored plain paragraphs passes: those are the club's own words as
 * typed, `{participantName}` and all, and filling them there would store a sentence with the
 * field silently removed from it.
 */
type Facts = Record<string, unknown> | null;

function fill(text: string, data: Facts): string {
  return data === null ? text : fillPlaceholders(text, data);
}

/**
 * One run of text with its marks, escaped **before** any tag is added — the same order
 * `templates.ts` applies its `**bold**` markers in, and for the same reason: a mark may only
 * ever wrap text that has already been made safe.
 */
function inline(nodes: readonly RichTextText[] | undefined, data: Facts): string {
  return (nodes ?? [])
    .map((node) => {
      const filled = fill(node.text, data);
      if (filled === "") return "";
      let html = escapeHtml(filled);
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") html = `<strong>${html}</strong>`;
        if (mark.type === "italic") html = `<em>${html}</em>`;
        if (mark.type === "link") {
          // The href was checked against the safe-protocol rule when the document was stored,
          // and it is quoted here because an attribute is the other place a string becomes code.
          html = `<a href="${escapeHtml(mark.attrs.href)}" style="color:${COLOR.blueInk}">${html}</a>`;
        }
      }
      return html;
    })
    .join("");
}

/** The words of a block, unmarked — for the plain-text half and for counting placeholders. */
function textOf(block: RichTextBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return (block.content ?? []).map((node) => node.text).join("");
    case "bulletList":
    case "orderedList":
      return block.content.flatMap((item) => item.content.map((p) => textOf(p))).join("\n");
    case "blockquote":
      return block.content.map((p) => textOf(p)).join("\n");
    default:
      return "";
  }
}

const P_STYLE = "margin:0 0 14px;font-size:16px;line-height:1.5";
const LIST_STYLE = "margin:0 0 14px;padding:0 0 0 20px;font-size:16px;line-height:1.6";

function align(block: { attrs?: { align?: "left" | "center" | "right" | null } }): string {
  const value = alignmentOf(block.attrs);
  return value === "left" ? "" : `;text-align:${value}`;
}

function blockHtml(block: EmailBodyBlock, data: Facts): string {
  switch (block.type) {
    case "paragraph": {
      const inner = inline(block.content, data);
      // An empty paragraph is the blank line somebody pressed Enter twice for; in an email it
      // would be a `<p>` with nothing in it, which several clients collapse and others do not.
      return inner === "" ? "" : `<p style="${P_STYLE}${align(block)}">${inner}</p>`;
    }
    case "heading": {
      const level = block.attrs.level;
      const size = level === 2 ? 19 : 17;
      return `<h${level} style="margin:18px 0 8px;font-size:${size}px;line-height:1.3;color:${COLOR.ink}${align(block)}">${inline(block.content, data)}</h${level}>`;
    }
    case "bulletList":
    case "orderedList": {
      const tag = block.type === "bulletList" ? "ul" : "ol";
      const start = block.type === "orderedList" && block.attrs?.start && block.attrs.start !== 1 ? ` start="${block.attrs.start}"` : "";
      const items = block.content
        .map((item) => `<li>${item.content.map((p) => inline(p.content, data)).join("<br>")}</li>`)
        .join("");
      return `<${tag}${start} style="${LIST_STYLE}">${items}</${tag}>`;
    }
    case "blockquote":
      return `<blockquote style="margin:0 0 14px;padding:2px 0 2px 12px;border-left:3px solid ${COLOR.line};color:${COLOR.inkMuted};font-size:16px;line-height:1.5">${block.content
        .map((p) => `<p style="${P_STYLE}">${inline(p.content, data)}</p>`)
        .join("")}</blockquote>`;
  }
}

function blockText(block: EmailBodyBlock, data: Facts): string[] {
  switch (block.type) {
    case "paragraph":
    case "heading": {
      const line = fill(textOf(block), data);
      return line === "" ? [] : [line];
    }
    case "bulletList":
      return block.content.map((item) => `- ${fill(item.content.map((p) => textOf(p)).join(" "), data)}`);
    case "orderedList":
      return block.content.map(
        (item, index) => `${index + 1}. ${fill(item.content.map((p) => textOf(p)).join(" "), data)}`,
      );
    case "blockquote":
      return block.content.map((p) => `> ${fill(textOf(p), data)}`);
  }
}

/**
 * One block of the club's body, in both halves at once: the inline-styled HTML a mail client
 * draws and the lines the plain-text part carries. They travel together because a message's
 * paragraphs are assembled with the platform's own sentences in among them — the "you are
 * already registered" line in front, the "this number is provisional" line after — and those
 * are plain strings. `renderContent` walks one list and asks each item which it is.
 */
export type EmailBodyPart = { html: string; text: string[] };

/** The club's body as those parts, in order. */
export function emailBodyParts(doc: RichTextDoc, data: Facts): EmailBodyPart[] {
  return emailBlocksOf(doc)
    .map((block) => ({ html: blockHtml(block, data), text: blockText(block, data) }))
    .filter((part) => part.html !== "");
}

/**
 * The club's body, as the two halves every message carries: inline-styled HTML parts that slot
 * in where `renderContent` puts its paragraphs, and plain-text lines for the text part.
 *
 * Blocks an email cannot carry are skipped here rather than throwing: they cannot be saved in
 * the first place, and a body that somehow holds one must still send.
 */
export function renderEmailBody(
  doc: RichTextDoc,
  /** The message's facts, or `null` to keep the placeholders as the club typed them. */
  data: Facts,
): { htmlParts: string[]; textLines: string[] } {
  const parts = emailBodyParts(doc, data);
  return { htmlParts: parts.map((part) => part.html), textLines: parts.flatMap((part) => part.text) };
}

/** The blocks an email may carry, in order — anything else was refused at save time. */
function emailBlocksOf(doc: RichTextDoc): EmailBodyBlock[] {
  return (doc.content ?? []).filter((block): block is EmailBodyBlock =>
    (EMAIL_BODY_BLOCKS as readonly string[]).includes(block.type),
  );
}

/**
 * The same body as plain paragraphs, which is what is stored beside it.
 *
 * Every entry keeps a plain `paragraphs` array whether or not it has a document: it is what the
 * plain-text half of the message is built from, what a mail client with HTML off shows, and
 * what an entry written before §270 already is. Derived at save time from the document, so the
 * two cannot disagree.
 */
export function emailBodyToParagraphs(doc: RichTextDoc): string[] {
  return renderEmailBody(doc, null)
    .textLines.map((line) => line.trim())
    .filter((line) => line !== "");
}
