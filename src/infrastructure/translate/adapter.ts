/**
 * The translation provider boundary (`DECISIONS.md` §464, «Tradu din română»).
 *
 * One method goes out, one list comes back: the club's Romanian words in, the English words out,
 * in the same order. Nothing about DeepL — its host, its error codes, its language tags — is
 * allowed past this file and `deepl-adapter.ts`, so adding a second provider (the owner kept the
 * door open for Claude, 2026-09-26) is a new file beside that one and one line in
 * `translator.ts`, and no module or screen changes at all. The `AGENTS.md` §17 shape: a narrow
 * adapter, a real implementation, a fake for the tests.
 *
 * **What crosses it is the club's own writing and nothing else.** A title, a description, a
 * partner's sentence, a link's label — the words the club types for a page or a message. Never a
 * participant's name, address or answer: the service accepts only the field names in
 * `modules/translate/domain/fields.ts`, and none of them holds personal data. The legal texts are
 * not among them either (§418: counsel-reviewed, translated by a person).
 */

/** The two languages a club text is written in. */
export type TranslateLanguage = "ro" | "en";

/**
 * `text` is a plain box's words, sent as they are. `html` is the inline content of one paragraph
 * of a rich text, serialised to the four tags `domain/rich-text-html.ts` writes, so the provider
 * keeps bold, italic and links around the words they belong to.
 */
export type TranslateFormat = "text" | "html";

export type TranslateRequest = {
  from: TranslateLanguage;
  to: TranslateLanguage;
  format: TranslateFormat;
  /** In order; the answer is in the same order, one string per string. */
  texts: readonly string[];
  /**
   * What the words are about, in words — the club's glossary (`domain/glossary.ts`). Read by the
   * provider to choose its words, never translated, never returned; DeepL does not bill it.
   */
  context?: string;
};

/** The providers this build wires. `off` is not one: it is the absence of a translator. */
export type TranslateProviderName = "deepl";

export interface Translator {
  readonly provider: TranslateProviderName;
  translate(request: TranslateRequest): Promise<string[]>;
}

/**
 * What the provider says the key has used and may use (§NNN): DeepL's `GET /v2/usage` answer,
 * `character_count` and `character_limit`, in the key's own terms. On the club's key that is a
 * credit given once and never renewed (the Developer plan, 1 000 000 characters, 2026-09-27), so
 * nothing here calls it a month: `modules/translate/domain/credit.ts` reads it as a credit.
 */
export type TranslateUsage = { used: number; limit: number };

/**
 * The three ways a provider says no, as the screen words them:
 *
 * - `quota` — the provider's own allowance is spent, answered as HTTP 456: a credit given once
 *   (the club's key, §NNN). A new credit or a new key; no month refills it.
 * - `refused` — the key is wrong or revoked (403). The Administrator's to fix; `/admin/tasks`
 *   names the variable.
 * - `unavailable` — anything else: a timeout, a 5xx, a 429, an answer of the wrong shape. Try
 *   again in a minute.
 */
export type TranslatorFailure = "quota" | "refused" | "unavailable";

export class TranslatorError extends Error {
  readonly failure: TranslatorFailure;

  constructor(failure: TranslatorFailure, message: string) {
    super(message);
    this.name = "TranslatorError";
    this.failure = failure;
  }
}

export function isTranslatorError(error: unknown): error is TranslatorError {
  return error instanceof TranslatorError;
}
