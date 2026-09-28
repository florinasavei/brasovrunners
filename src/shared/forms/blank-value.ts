/**
 * Whether a posted value says nothing (§350): whitespace, or a Tiptap document with no text and
 * no non-structural node (a picture or a table counts). Mirrors the server's `isRichTextEmpty`
 * without the schema; runs per keystroke, so it never throws.
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
