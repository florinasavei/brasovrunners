import type { z } from "zod";

/**
 * Both languages or neither (§352): an optional club text is written in both or empty in both;
 * one side alone is refused at save (drafts too) on the empty side's box, so nothing ever falls
 * back to the other language. `refuseOneLanguage` checks a pair inside a Zod schema,
 * `missingLanguage` a pair a service sees after parsing; each caller names its own pairs.
 *
 * The same words in both boxes (`identicalInBothLanguages`, §354) is only warned about.
 */

/** As the form's own field suffixes spell them. */
export type TextLanguage = "ro" | "en";

export const isWrittenText = (value: string | null | undefined): boolean => (value ?? "").trim() !== "";

/**
 * The empty side when the other is written, else null. `isWritten` defines "written" (a rich text
 * with no words may still carry a picture).
 */
export function missingLanguage<T>(pair: Readonly<Record<TextLanguage, T>>, isWritten: (value: T) => boolean): TextLanguage | null {
  const ro = isWritten(pair.ro);
  const en = isWritten(pair.en);
  if (ro === en) return null;
  return ro ? "en" : "ro";
}

const LANGUAGE_NAME: Record<TextLanguage, string> = { ro: "Romanian", en: "English" };

/**
 * A Zod refinement for one pair of plain boxes: one issue on the empty side's path. `what` is for
 * developers only; the organizer reads the box's label from `field-labels.ts`.
 */
export function refuseOneLanguage(
  ctx: z.RefinementCtx,
  pair: Readonly<Record<TextLanguage, string | null | undefined>>,
  paths: Readonly<Record<TextLanguage, (string | number)[]>>,
  what: string,
): void {
  const missing = missingLanguage(pair, isWrittenText);
  if (!missing) return;
  const written = missing === "ro" ? "en" : "ro";
  ctx.addIssue({
    code: "custom",
    path: paths[missing],
    message: `${what} is written in ${LANGUAGE_NAME[written]} only; write it in ${LANGUAGE_NAME[missing]} too, or in neither`,
  });
}

/** A pair with both languages written (§354), e.g. an organizer's note carried in the outbox. */
export type BilingualText = Readonly<Record<TextLanguage, string>>;

// --- The same text in both boxes (§354, bilingual everywhere) --------------------------------

/**
 * Below this normalized length, identical texts are not warned about: a name may honestly read the
 * same in both languages; a paragraph that does is almost always a paste.
 */
export const IDENTICAL_TEXT_MIN_LENGTH = 40;

type TextNode = { text?: unknown; content?: unknown };

/** Every text run of a rich-text document, in order; never throws. */
function textRuns(node: unknown, runs: string[]): void {
  if (!node || typeof node !== "object") return;
  const { text, content } = node as TextNode;
  if (typeof text === "string") runs.push(text);
  if (Array.isArray(content)) for (const child of content) textRuns(child, runs);
}

/**
 * A box's words for comparison across languages — plain text or a rich-text document (or its
 * posted JSON) — whitespace collapsed, NFC, lower case. Pure: the browser runs it per keystroke
 * and the server on stored rows, and both must agree.
 */
export function comparableText(value: unknown): string {
  let source: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) {
      try {
        source = JSON.parse(trimmed);
      } catch {
        source = value;
      }
    }
  }
  let words: string;
  if (typeof source === "string") words = source;
  else {
    const runs: string[] = [];
    textRuns(source, runs);
    // Joined with a space so words across paragraphs never fuse.
    words = runs.join(" ");
  }
  return words.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ro");
}

/**
 * Whether both languages say the same words once normalized, beyond `IDENTICAL_TEXT_MIN_LENGTH`
 * (§354). A warning in the editor, never a refusal.
 */
export function identicalInBothLanguages(ro: unknown, en: unknown): boolean {
  const a = comparableText(ro);
  if (a.length <= IDENTICAL_TEXT_MIN_LENGTH) return false;
  return a === comparableText(en);
}
