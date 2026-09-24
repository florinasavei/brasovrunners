import type { z } from "zod";

/**
 * Both languages or neither (§352; the owner, 2026-09-24: "I want multi-lingual, always").
 *
 * Every text the club types for a page is Romanian **and** English. A text that is optional is
 * optional in both at once: written in both, or left empty in both. One side written and the
 * other empty is refused at the save — a draft's too — naming the empty box, so the refusal
 * summary links straight to the language still owed and the rest of the form comes back as typed
 * (§315). The site then never has to decide what an English page shows where only Romanian was
 * written: there is nothing to fall back from, so nothing falls back.
 *
 * One rule, read two ways: `refuseOneLanguage` for a pair inside a Zod schema (a partner's
 * description, a link's label — `content/events/fields.ts`; a standing page's two search-engine
 * texts, `content/pages/fields.ts`; an album's description, `content/gallery/fields.ts`), and
 * `missingLanguage` for a pair the service can only see once both languages are parsed (the event
 * texts, `content/events/service.ts`; the organizer's note and the cancellation's reason, which
 * that service reads beside the save). No list of pairs lives here; each caller names its own.
 *
 * "Bilingual everywhere" (§354) adds the other half of the owner's rule: the same words in both
 * boxes (`identicalInBothLanguages`) — the Romanian pasted into the English box — which is warned
 * about in the editor and never refused.
 */

/** The two languages a club text is written in, as the form's own suffixes spell them. */
export type TextLanguage = "ro" | "en";

/** A plain box says something when it holds more than whitespace. */
export const isWrittenText = (value: string | null | undefined): boolean => (value ?? "").trim() !== "";

/**
 * The language whose side of the pair is empty while the other is written, or null when both or
 * neither are. `isWritten` says what "written" means for this pair — a plain box by default; a
 * rich text passes its own test, where a document with no words may still carry a picture.
 */
export function missingLanguage<T>(pair: Readonly<Record<TextLanguage, T>>, isWritten: (value: T) => boolean): TextLanguage | null {
  const ro = isWritten(pair.ro);
  const en = isWritten(pair.en);
  if (ro === en) return null;
  return ro ? "en" : "ro";
}

const LANGUAGE_NAME: Record<TextLanguage, string> = { ro: "Romanian", en: "English" };

/**
 * A Zod refinement for one pair of plain boxes: one issue, on the empty side's path, when only
 * the other side is written. `what` starts the developer-facing message ("partner 2: the
 * description"); the organizer reads the box's own label from `field-labels.ts`, never this.
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

/**
 * A pair as the platform keeps it once the rule has passed (§354, bilingual everywhere): both
 * languages written. The organizer's note on an update and the reason for a cancellation travel
 * in the outbox as one of these, so each registrant's message reads the half in their language.
 */
export type BilingualText = Readonly<Record<TextLanguage, string>>;

/** The other language of the pair — the second half of a bilingual email, the box beside this one. */
export const otherLanguage = (language: TextLanguage): TextLanguage => (language === "ro" ? "en" : "ro");

// --- The same text in both boxes (§354, bilingual everywhere) --------------------------------

/**
 * How long a text has to be, once normalized, before "identical in both languages" is worth a
 * warning. A name — "Happy Monday", "Tâmpa Trail", a partner's own brand — may honestly read the
 * same in Romanian and English; a paragraph that does is almost always the Romanian pasted into
 * the English box, which is exactly what the English "Happy Monday" date carries on production.
 */
export const IDENTICAL_TEXT_MIN_LENGTH = 40;

type TextNode = { text?: unknown; content?: unknown };

/** Every run of text in a rich-text document, in order — a lenient walk that never throws. */
function textRuns(node: unknown, runs: string[]): void {
  if (!node || typeof node !== "object") return;
  const { text, content } = node as TextNode;
  if (typeof text === "string") runs.push(text);
  if (Array.isArray(content)) for (const child of content) textRuns(child, runs);
}

/**
 * A box's words as they are compared across languages: a plain box's text, or a rich text's
 * words (a stored document, or the JSON its hidden input posts), with every run of whitespace one
 * space, composed characters, and no case — so a pasted copy with a different line break or a
 * capital letter is still the same text. A document with pictures and no words reads as "".
 *
 * Pure and dependency-free on purpose: the editor's boxes re-read it on every keystroke in the
 * browser (`LocaleTabPanels`, `CoHostRowsEditor`), and the server reads stored rows with it, so
 * the first paint and the first keystroke give the same answer.
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
    // Each run apart, so the last word of one paragraph and the first of the next never fuse.
    words = runs.join(" ");
  }
  return words.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ro");
}

/**
 * Whether the two languages of one text say exactly the same words (§354, bilingual everywhere):
 * both written, identical once normalized (`comparableText`), and longer than
 * `IDENTICAL_TEXT_MIN_LENGTH`. A **warning**, never a refusal — the editor shows it in the box,
 * marks the English tab and the closed line, and lists it before publication; nothing is refused
 * for it, because a short text may legitimately be the same in both.
 */
export function identicalInBothLanguages(ro: unknown, en: unknown): boolean {
  const a = comparableText(ro);
  if (a.length <= IDENTICAL_TEXT_MIN_LENGTH) return false;
  return a === comparableText(en);
}
