/**
 * Links and pictures inside a legal paragraph (`DECISIONS.md` §127; the owner: "I must be
 * able to put pictures and links in these documents"). The body stays plain text — that is
 * what is hashed, signed and merged — and two marks everybody knows are read out of it:
 *
 *     [the words](https://…)     a link; https, mailto or a path on this site
 *     ![what it shows](https://…)   a picture, on a line of its own; https only
 *
 * Anything else is text, exactly as typed. No HTML is ever parsed or emitted.
 */

export type InlinePart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "image"; alt: string; src: string };

const MARK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

function allowedHref(href: string): boolean {
  return /^https:\/\//i.test(href) || /^mailto:[^\s@]+@[^\s@]+$/i.test(href) || (href.startsWith("/") && !href.startsWith("//"));
}

/** The paragraph as text, links and pictures, in order; a mark that is not allowed stays text. */
export function parseInline(paragraph: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of paragraph.matchAll(MARK)) {
    const [whole, bang, label, target] = match;
    const index = match.index ?? 0;
    const isImage = bang === "!";
    const allowed = isImage ? /^https:\/\//i.test(target) : allowedHref(target);
    if (!allowed) continue;
    if (index > last) parts.push({ kind: "text", text: paragraph.slice(last, index) });
    parts.push(isImage ? { kind: "image", alt: label.trim(), src: target } : { kind: "link", text: label.trim() || target, href: target });
    last = index + whole.length;
  }
  if (last < paragraph.length) parts.push({ kind: "text", text: paragraph.slice(last) });
  return parts;
}

/** The same paragraph for a PDF or a plain place: a link as "words (address)", a picture as its alt. */
export function plainInline(paragraph: string): string {
  return parseInline(paragraph)
    .map((part) => (part.kind === "text" ? part.text : part.kind === "link" ? `${part.text} (${part.href})` : part.alt))
    .join("")
    .trim();
}
