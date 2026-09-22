import { bodyToText, textToBody } from "./body-text";
import { parseInline } from "./inline";

/**
 * The bridge between what the club sees and what a legal document stores (`DECISIONS.md` §279;
 * the owner, 2026-09-22: "this declaration must be WYSIWYG").
 *
 * ## Why the stored shape does not change
 *
 * `body_json` is `{ sections: [{ heading?, paragraphs }] }`, and it is the thing that is hashed
 * (`content-hash.ts`), approved, merged per person and drawn into the PDF the participant signs.
 * The club's three texts are approved on production against exactly those bytes. So the editor
 * is a *view*: it reads the stored text into a document, and it writes the same plain text back
 * into the same hidden field the textarea used. The server, the hash, the public page and the
 * PDF are untouched, and a version approved before this existed opens and saves identically.
 *
 * That is also what makes this safe to ship two months before the race: nothing downstream of
 * the form learns a new shape, and `editor-doc.test.ts` proves the round trip for the three
 * templates the club actually approved.
 *
 * ## What the editor may therefore contain
 *
 * Exactly what the format already carries, and nothing else: a heading, a paragraph, a line
 * break inside a paragraph, a link, and a picture on a line of its own. **No bold, no italic,
 * no lists** — not because they would be hard to draw, but because the stored body has nowhere
 * to put them, and an editor offering a button whose result is silently dropped on save is
 * worse than one that never offered it.
 */

export type LegalInline =
  | { type: "text"; text: string; marks?: { type: "link"; attrs: { href: string } }[] }
  | { type: "hardBreak" };

export type LegalBlock =
  | { type: "heading"; attrs: { level: 2 }; content?: LegalInline[] }
  | { type: "paragraph"; content?: LegalInline[] }
  | { type: "image"; attrs: { src: string; alt: string } };

export type LegalEditorDoc = { type: "doc"; content: LegalBlock[] };

export const EMPTY_LEGAL_DOC: LegalEditorDoc = { type: "doc", content: [] };

/** A paragraph's words as the editor's runs: text, links, and the breaks the author typed. */
function inlineOf(paragraph: string): LegalInline[] {
  const runs: LegalInline[] = [];
  for (const part of parseInline(paragraph)) {
    if (part.kind === "image") {
      // A picture among words — rare, and the page draws it inline. The editor keeps it as the
      // mark it is written as rather than losing it to a node it cannot sit beside.
      runs.push({ type: "text", text: `![${part.alt}](${part.src})` });
      continue;
    }
    const { text } = part;
    const marks = part.kind === "link" ? [{ type: "link" as const, attrs: { href: part.href } }] : undefined;
    // A single newline inside a paragraph is a break the author wrote (`body-text.ts`), and in
    // the editor it is Shift+Enter — so it is a node, not a character inside a run.
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
      // The same rule the public page draws by: a paragraph that is one picture and nothing
      // else is the picture, so the editor shows it rather than its address.
      if (parts.length === 1 && parts[0].kind === "image") {
        content.push({ type: "image", attrs: { src: parts[0].src, alt: parts[0].alt } });
        continue;
      }
      content.push({ type: "paragraph", content: inlineOf(paragraph) });
    }
  }
  return { type: "doc", content };
}

/** One run back to the text it was written as. */
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
      // A node this format has nowhere to put — the toolbar offers none, and one arriving from
      // a paste is dropped here rather than written into a document somebody signs.
      return "";
  }
}

/**
 * The document back to the text the form posts — the same field, in the same format, as the
 * textarea wrote. Blank blocks are dropped rather than stored: `textToBody` would drop them on
 * the next read anyway, and a body whose text does not survive a save is what makes a content
 * hash move for no reason anybody can see.
 */
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

/** Is this the document shape above? The editor's own value, coming back through a form field. */
export function isLegalEditorDoc(value: unknown): value is LegalEditorDoc {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content)
  );
}
