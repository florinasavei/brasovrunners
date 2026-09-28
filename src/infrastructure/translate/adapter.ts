/**
 * The translation provider boundary (`DECISIONS.md` §464; the `AGENTS.md` §17 adapter shape).
 * Nothing provider-specific passes this file and `deepl-adapter.ts`; a second provider is a new
 * file and one line in `translator.ts`.
 *
 * Only the club's own writing crosses it — never personal data: the service accepts only the
 * fields in `modules/translate/domain/fields.ts`. Legal texts are excluded (§418).
 */

export type TranslateLanguage = "ro" | "en";

/**
 * `html` is one rich-text paragraph's inline content in the tags `domain/rich-text-html.ts`
 * writes, so the provider keeps marks and links on their words.
 */
export type TranslateFormat = "text" | "html";

export type TranslateRequest = {
  from: TranslateLanguage;
  to: TranslateLanguage;
  format: TranslateFormat;
  /** The answer is in the same order, one string per string. */
  texts: readonly string[];
  /** The club's glossary (`domain/glossary.ts`); guides word choice, never translated or billed. */
  context?: string;
};

/** `off` is not a provider: it is the absence of a translator. */
export type TranslateProviderName = "deepl";

export interface Translator {
  readonly provider: TranslateProviderName;
  translate(request: TranslateRequest): Promise<string[]>;
}

/**
 * The key's used and total characters from the provider's meter (§497). On the club's key it is a
 * one-time credit, not a monthly allowance; `modules/translate/domain/credit.ts` reads it so.
 */
export type TranslateUsage = { used: number; limit: number };

/**
 * - `quota` — the allowance is spent (HTTP 456); no month refills it (§497).
 * - `refused` — the key is wrong or revoked (401/403).
 * - `unavailable` — anything else (timeout, 5xx, 429, wrong shape); retryable.
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
