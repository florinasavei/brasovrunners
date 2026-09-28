import { bodyToText, textToBody } from "./body-text";
import { parseInline } from "./inline";

/**
 * The WYSIWYG editor's document to and from the stored plain text (§279). The editor is only a
 * view: it posts the same text the textarea did, so the hash, page and PDF are unchanged and
 * approved versions round-trip (`editor-doc.test.ts`). It holds only what the format carries —
 * headings, paragraphs, line breaks, links, a picture on its own line; no bold, italic or lists.
 */

export type LegalInline =
  | { type: "text"; text: string; marks?: { type: "link"; attrs: { href: string } }[] }
  | { type: "hardBreak" };

export type LegalBlock =
  | { type: "heading"; attrs: { level: 2 }; content?: LegalInline[] }
  | { type: "paragraph"; content?: LegalInline[] }
  | { type: "image"; attrs: { src: string; alt: string } };

export type LegalEditorDoc = { type: "doc"; content: LegalBlock[] };

/** A paragraph's words as the editor's runs: text, links, and the breaks the author typed. */
function inlineOf(paragraph: string): LegalInline[] {
  const runs: LegalInline[] = [];
  for (const part of parseInline(paragraph)) {
    if (part.kind === "image") {
      // A picture among words stays its written mark; an image node cannot sit inline.
      runs.push({ type: "text", text: `![${part.alt}](${part.src})` });
      continue;
    }
    const { text } = part;
    const marks = part.kind === "link" ? [{ type: "link" as const, attrs: { href: part.href } }] : undefined;
    // A single newline is the author's line break (Shift+Enter): a node, not a character.
    const pieces = text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) runs.push({ type: "hardBreak" });
      if (piece !== "") runs.push(marks ? { type: "text", text: piece, marks } : { type: "text", text: piece });
    });
  }
  return runs;
}

/** The stored text as the document the editor opens. Total: anything unreadable is no document. */
export function textToEditorDoc(text: string): LegalEditorDoc {
  const content: LegalBlock[] = [];
  for (const section of textToBody(text).sections) {
    if (section.heading !== undefined) {
      content.push({ type: "heading", attrs: { level: 2 }, content: inlineOf(section.heading) });
    }
    for (const paragraph of section.paragraphs) {
      const parts = parseInline(paragraph);
      // As on the public page, a paragraph that is only a picture is the picture.
      if (parts.length === 1 && parts[0].kind === "image") {
        content.push({ type: "image", attrs: { src: parts[0].src, alt: parts[0].alt } });
        continue;
      }
      content.push({ type: "paragraph", content: inlineOf(paragraph) });
    }
  }
  return { type: "doc", content };
}

function runToText(run: LegalInline): string {
  if (run.type === "hardBreak") return "\n";
  const href = run.marks?.find((mark) => mark.type === "link")?.attrs.href;
  return href ? `[${run.text}](${href})` : run.text;
}

function blockToText(block: LegalBlock): string {
  switch (block.type) {
    case "heading":
      return `## ${(block.content ?? []).map(runToText).join("").replace(/\n/g, " ").trim()}`;
    case "image":
      return `![${block.attrs.alt}](${block.attrs.src})`;
    case "paragraph":
      return (block.content ?? []).map(runToText).join("");
    default:
      // A node the format cannot hold (e.g. from a paste) is dropped.
      return "";
  }
}

/** The document back to the posted text. Blank blocks are dropped, as `textToBody` would, so the hash stays stable. */
export function editorDocToText(doc: unknown): string {
  if (!isLegalEditorDoc(doc)) return "";
  return bodyToText(
    textToBody(
      doc.content
        .map(blockToText)
        .map((block) => block.trimEnd())
        .filter((block) => block.trim() !== "" && block.trim() !== "##")
        .join("\n\n"),
    ),
  );
}

export function isLegalEditorDoc(value: unknown): value is LegalEditorDoc {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content)
  );
}
