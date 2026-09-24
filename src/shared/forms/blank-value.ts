/**
 * Whether a posted value says nothing (§NNN, the event editor's "· incomplet" tab marks).
 *
 * A plain box is blank when it holds only whitespace. A rich-text field posts its Tiptap
 * document as JSON (`RichTextEditor`'s hidden input), and an empty editor still posts a document
 * — `{"type":"doc","content":[{"type":"paragraph"}]}` — so a document is blank when no node in it
 * carries text or is something other than structure: a picture, a film or a table is content even
 * without a word beside it. The same answer `isRichTextEmpty` gives on the server, without the
 * schema: this runs on every keystroke in the browser and must never throw on a half-typed value.
 */
const STRUCTURE = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
]);

type Node = { type?: unknown; text?: unknown; content?: unknown };

function hasContent(node: Node): boolean {
  if (typeof node.text === "string" && node.text.trim() !== "") return true;
  if (typeof node.type === "string" && !STRUCTURE.has(node.type)) return true;
  return Array.isArray(node.content) && node.content.some((child) => child && typeof child === "object" && hasContent(child as Node));
}

export function isBlankValue(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim();
  if (value === "") return true;
  if (!value.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(value) as Node;
    if (!parsed || typeof parsed !== "object" || parsed.type !== "doc") return false;
    return !hasContent(parsed);
  } catch {
    return false;
  }
}
