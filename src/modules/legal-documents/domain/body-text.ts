import type { LegalDocumentBody, LegalDocumentSection } from "./content-hash";

/**
 * The plain-text editing format for a legal body (AGENTS.md §1.5: no rich-text dependency):
 * `## ` starts a section, a blank line separates paragraphs, text before any heading is a
 * section without one. The round trip only normalises whitespace, so re-saving an existing
 * version keeps its content hash.
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
    // A heading with nothing under it is still a section: never drop what the club typed.
    if (paragraphs.length > 0 || heading !== undefined) {
      sections.push(heading === undefined ? { paragraphs } : { heading, paragraphs });
    }
    heading = undefined;
    paragraphs = [];
  };

  for (const block of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (trimmed === "") continue;

    const match = HEADING.exec(trimmed);
    if (match) {
      flush();
      heading = match[1].trim();
      continue;
    }

    // A single newline is a line break kept inside the paragraph (an address, a list).
    paragraphs.push(trimmed);
  }

  flush();
  return { sections };
}

export function isEmptyBody(body: LegalDocumentBody): boolean {
  return body.sections.every(
    (section) => !section.heading && section.paragraphs.every((p) => p.trim() === ""),
  );
}
