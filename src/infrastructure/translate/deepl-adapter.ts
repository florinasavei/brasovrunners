import { type TranslateLanguage, type TranslateRequest, type Translator, TranslatorError } from "./adapter";

/**
 * DeepL's text API, v2 (`DECISIONS.md` §NNN; the owner, 2026-09-26: «use the free stuff, we are
 * an ONG»).
 *
 * Read from DeepL's own reference (developers.deepl.com, 2026-09-26), not from memory:
 *
 * - `POST /v2/translate`, JSON, `Authorization: DeepL-Auth-Key <key>` — the header is the only
 *   authentication DeepL still accepts (the form-body key was retired in November 2025).
 * - **The free plan has its own host**, `api-free.deepl.com`, and a free key ends in `:fx`; a paid
 *   key goes to `api.deepl.com`. Both are DeepL's, in the EU (DeepL SE, Cologne), and the host is
 *   picked from the key so a club that ever pays changes one variable and nothing else.
 * - Up to **50 texts per request**, answered in order; the whole request at most 128 KiB. A long
 *   description is split into several requests below both limits.
 * - `tag_handling: "html"` keeps the tags around the words they belong to — how a rich text keeps
 *   its bold, italic and links (`modules/translate/domain/rich-text-html.ts`).
 * - `context` is read and never translated or billed — the club's glossary goes there.
 * - `456` is "quota exceeded" (500 000 characters a month on Free), `403` a wrong key, `429` too
 *   many requests.
 *
 * English is `EN-GB`: the site's English is British (`en-GB` dates and numbers everywhere).
 */

const FREE_HOST = "https://api-free.deepl.com";
const PRO_HOST = "https://api.deepl.com";

/** DeepL's own ceiling is 50 texts a request. */
const MAX_TEXTS_PER_REQUEST = 50;
/** Under DeepL's 128 KiB request ceiling with room for the JSON around the texts and the context. */
const MAX_CHARACTERS_PER_REQUEST = 60_000;
/** A translation of a long description takes seconds; a hung request must not hold the press for a minute. */
const TIMEOUT_MS = 20_000;

const LANGUAGE: Record<TranslateLanguage, { source: string; target: string }> = {
  ro: { source: "RO", target: "RO" },
  en: { source: "EN", target: "EN-GB" },
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type DeeplOptions = {
  apiKey: string;
  /** Tests hand a fake; production uses the platform's own `fetch`. */
  fetchImpl?: FetchLike;
};

/** The host a key belongs to: a free key (`…:fx`) only works on the free host, and a paid one only on the other. */
export function deeplHostFor(apiKey: string): string {
  return apiKey.trim().endsWith(":fx") ? FREE_HOST : PRO_HOST;
}

/** The texts cut into requests DeepL accepts: at most 50 each, and at most the character ceiling. */
export function deeplBatches(texts: readonly string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (current.length > 0 && (current.length >= MAX_TEXTS_PER_REQUEST || size + text.length > MAX_CHARACTERS_PER_REQUEST)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function failureOf(status: number): TranslatorError {
  if (status === 456) return new TranslatorError("quota", "DeepL: the plan's character allowance is spent (456)");
  if (status === 401 || status === 403) return new TranslatorError("refused", `DeepL refused the key (${status})`);
  return new TranslatorError("unavailable", `DeepL answered ${status}`);
}

export function createDeeplTranslator({ apiKey, fetchImpl }: DeeplOptions): Translator {
  const endpoint = `${deeplHostFor(apiKey)}/v2/translate`;
  const send: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));

  async function translateBatch(request: TranslateRequest, texts: string[]): Promise<string[]> {
    let response: Response;
    try {
      response = await send(endpoint, {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: texts,
          source_lang: LANGUAGE[request.from].source,
          target_lang: LANGUAGE[request.to].target,
          ...(request.format === "html" ? { tag_handling: "html" } : { preserve_formatting: true }),
          ...(request.context ? { context: request.context } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      throw new TranslatorError("unavailable", `DeepL could not be reached: ${error instanceof Error ? error.name : "error"}`);
    }
    if (!response.ok) throw failureOf(response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TranslatorError("unavailable", "DeepL answered something that is not JSON");
    }
    const translations = (body as { translations?: unknown }).translations;
    if (!Array.isArray(translations) || translations.length !== texts.length) {
      throw new TranslatorError("unavailable", "DeepL answered a different number of texts than it was sent");
    }
    return translations.map((entry) => {
      const text = (entry as { text?: unknown }).text;
      if (typeof text !== "string") throw new TranslatorError("unavailable", "DeepL answered a translation without text");
      return text;
    });
  }

  return {
    provider: "deepl",
    async translate(request) {
      const answers: string[] = [];
      // One request after the other, never in parallel: a free key's rate limit is low, and a
      // description is at most a few requests.
      for (const batch of deeplBatches(request.texts)) answers.push(...(await translateBatch(request, batch)));
      return answers;
    },
  };
}
