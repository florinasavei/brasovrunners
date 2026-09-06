import type { LegalDocumentBody, LegalDocumentSection } from "./content-hash";

/**
 * The editing format for a legal document's body: plain text, in and out.
 *
 * `body_json` is structured — sections, each with an optional heading and its paragraphs — and
 * the club needs to write and read it without a rich-text editor. The Tiptap contract is M5, and
 * pulling it forward to type a privacy notice would be a dependency and a body schema decided
 * for the wrong reason (`AGENTS.md` §1.5: prefer nothing over a dependency).
 *
 * So the format is the one everybody already knows from writing anything:
 *
 *     ## Heading
 *
 *     A paragraph.
 *
 *     Another paragraph.
 *
 * A blank line separates paragraphs. A line beginning `## ` starts a new section. Text before
 * any heading is a section without one, which is how a document opens with a sentence.
 *
 * Both directions are pure and total: `toText(toBody(x))` normalises whitespace and is otherwise
 * the same document, which is what lets the editor round-trip an existing version without the
 * content hash changing for no reason.
 */

const HEADING = /^##\s+(.*)$/;

export function bodyToText(body: LegalDocumentBody): string {
  return body.sections
    .map((section) => {
      const paragraphs = section.paragraphs.join("\n\n");
      return section.heading ? `## ${section.heading}\n\n${paragraphs}` : paragraphs;
    })
    .join("\n\n")
    .trim();
}

export function textToBody(text: string): LegalDocumentBody {
  const sections: LegalDocumentSection[] = [];
  let heading: string | undefined;
  let paragraphs: string[] = [];

  const flush = () => {
    // A heading with nothing under it is still a section: dropping it would silently delete
    // something the club typed, which is the one thing a converter must never do.
    if (paragraphs.length > 0 || heading !== undefined) {
      sections.push(heading === undefined ? { paragraphs } : { heading, paragraphs });
    }
    heading = undefined;
    paragraphs = [];
  };

  // Blocks are separated by one or more blank lines; \r\n because this is typed in a browser on
  // Windows as often as anywhere else.
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (trimmed === "") continue;

    const match = HEADING.exec(trimmed);
    if (match) {
      flush();
      heading = match[1].trim();
      continue;
    }

    // A single newline inside a block is a line break the author wrote, not a new paragraph —
    // an address or a list is the ordinary case. Kept as one paragraph, with the break intact.
    paragraphs.push(trimmed);
  }

  flush();
  return { sections };
}

/** Nothing to say is not a document. Used by the form before anything reaches the database. */
export function isEmptyBody(body: LegalDocumentBody): boolean {
  return body.sections.every(
    (section) => !section.heading && section.paragraphs.every((p) => p.trim() === ""),
  );
}
