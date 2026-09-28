import { type TranslateLanguage, type TranslateRequest, type TranslateUsage, type Translator, TranslatorError } from "./adapter";

/**
 * DeepL's text API v2 (`DECISIONS.md` §464), per developers.deepl.com:
 *
 * - Auth only by the `DeepL-Auth-Key` header (the form-body key was retired in November 2025).
 * - A free key (`…:fx`) works only on `api-free.deepl.com`, a paid one only on `api.deepl.com`;
 *   the host is picked from the key. Both are in the EU.
 * - At most 50 texts and 128 KiB per request; longer input is split.
 * - `tag_handling: "html"` keeps rich-text marks on their words; `context` is never translated or billed.
 * - 456 = quota spent (§497), 403 = wrong key, 429 = too many requests.
 *
 * English is `EN-GB`: the site's English is British.
 */

const FREE_HOST = "https://api-free.deepl.com";
const PRO_HOST = "https://api.deepl.com";

const MAX_TEXTS_PER_REQUEST = 50;
/** Under DeepL's 128 KiB request ceiling with room for the JSON around the texts and the context. */
const MAX_CHARACTERS_PER_REQUEST = 60_000;
const TIMEOUT_MS = 20_000;

const LANGUAGE: Record<TranslateLanguage, { source: string; target: string }> = {
  ro: { source: "RO", target: "RO" },
  en: { source: "EN", target: "EN-GB" },
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type DeeplOptions = {
  apiKey: string;
  fetchImpl?: FetchLike;
};

export function deeplHostFor(apiKey: string): string {
  return apiKey.trim().endsWith(":fx") ? FREE_HOST : PRO_HOST;
}

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

/** A small GET; Costuri must not wait on it the way a translation may. */
const USAGE_TIMEOUT_MS = 5_000;

/**
 * `GET /v2/usage` (§497), not billed: `character_count` used of `character_limit` — on the club's
 * key a one-time credit that does not renew. Throws `TranslatorError` like a translation.
 */
export async function readDeeplUsage({ apiKey, fetchImpl }: DeeplOptions): Promise<TranslateUsage> {
  const send: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  let response: Response;
  try {
    response = await send(`${deeplHostFor(apiKey)}/v2/usage`, {
      method: "GET",
      headers: { Authorization: `DeepL-Auth-Key ${apiKey.trim()}` },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
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
  const { character_count: used, character_limit: limit } = (body ?? {}) as { character_count?: unknown; character_limit?: unknown };
  const whole = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (!whole(used) || !whole(limit)) throw new TranslatorError("unavailable", "DeepL answered a usage without its two counts");
  return { used, limit };
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
      // Sequential: a free key's rate limit is low.
      for (const batch of deeplBatches(request.texts)) answers.push(...(await translateBatch(request, batch)));
      return answers;
    },
  };
}
