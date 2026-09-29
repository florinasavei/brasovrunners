import { createHash } from "node:crypto";
import type { LegalDocumentBody } from "./content-hash";
import { plainInline } from "./inline";
import { dropsParagraph, mergeTextSegments, type MergeValues } from "./merge-fields";

/**
 * The exact text a person signed, and its fingerprint (§556, amending §85 and §499; the second
 * review of 2026-09-29: «the paragraph on the electronic signature is good only if the platform
 * keeps what it says: name + email + timestamp + the declaration's version + the exact text's hash
 * + the acceptance»).
 *
 * `content_sha256` on an acceptance is the approved **version's** hash — both languages, the
 * template with its `{{blanks}}` (§46). That proves which text the club approved; it does not prove
 * what this signer read, with their name, the run, the date and the moment filled in. This is that:
 * the declaration's title, then every paragraph the PDF prints — a dropped paragraph dropped
 * (`dropsParagraph`, §440, §523), each blank filled with the value the signer's copy prints, the
 * inline marks stripped per run exactly as the PDF strips them (`runText`) — one line each, joined
 * by a line feed, as UTF-8. The same function the PDF's paragraphs are drawn from, so the bytes
 * hashed are the bytes printed; the title is hashed as stored (the PDF sets it in capitals, a
 * matter of type, not of text).
 *
 * The signer's own copy, never the club's (§320): the club's archive copy masks the identity
 * document, and is a copy **of** the signed text, not a second text. Pure: no clock, no database.
 */

/**
 * One run of a paragraph as the PDF draws it: the marks stripped (`plainInline`), and a space at
 * either end kept, because the run beside it is drawn straight after it and `plainInline` trims.
 */
export function runText(raw: string): string {
  const plain = plainInline(raw);
  if (plain === "") return /\s/.test(raw) ? " " : "";
  return `${/^\s/.test(raw) ? " " : ""}${plain}${/\s$/.test(raw) ? " " : ""}`;
}

/** One paragraph as the PDF prints it, its blanks filled: the runs' own text, end to end. */
export function paragraphText(paragraph: string, values: MergeValues): string {
  return mergeTextSegments(paragraph, values)
    .map((run) => runText(run.text))
    .join("");
}

export type SignedTextInput = {
  title: string;
  body: LegalDocumentBody;
  values: MergeValues;
};

/** The lines of the signed text: the title, each heading, each paragraph the PDF keeps. */
export function signedTextLines(input: SignedTextInput): string[] {
  const lines = [input.title];
  for (const section of input.body.sections) {
    if (section.heading) lines.push(section.heading);
    for (const paragraph of section.paragraphs) {
      if (dropsParagraph(paragraph, input.values)) continue;
      lines.push(paragraphText(paragraph, input.values));
    }
  }
  return lines;
}

/** The signed text as one string: its lines joined by a line feed. */
export function signedText(input: SignedTextInput): string {
  return signedTextLines(input).join("\n");
}

/** The SHA-256 of the signed text's UTF-8 bytes, in lower-case hex: the row's `text_hash`. */
export function signedTextHash(input: SignedTextInput): string {
  return createHash("sha256").update(signedText(input), "utf8").digest("hex");
}

/** The first characters of a hash as the backoffice shows it, the whole one in its tooltip. */
export const TEXT_HASH_SHORT = 12;
export function shortTextHash(hash: string): string {
  return hash.slice(0, TEXT_HASH_SHORT);
}
