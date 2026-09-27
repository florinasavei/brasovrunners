import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { isTranslatorError, type TranslateUsage, type TranslatorFailure } from "@/infrastructure/translate/adapter";
import { readTranslationUsageForEnvironment, type TranslateEnvironment } from "@/infrastructure/translate/translator";
import { type TranslationCredit, translationCredit } from "./domain/credit";

/**
 * The DeepL credit as DeepL's own meter states it (§497), cached an hour in Next's data cache like
 * the other provider reads (§402, §479) and expired after every press that reached DeepL — so
 * Costuri, the `/admin/tasks` row, `/api/health`, the editors' button and the press's own check
 * read one figure without asking DeepL on every page.
 *
 * The cache key names the provider's host kind and a short fingerprint of the key — the first
 * eight hex characters of its SHA-256, which cannot be turned back into the key — and never the
 * key itself (the §479 rule for Vercel's token). The fingerprint is there because Vercel's data
 * cache outlives a redeploy: a key replaced by another of the same kind would otherwise keep the
 * old key's «spent» reading for up to an hour. A failure is not put in the data cache — the next minute asks again — but it is
 * remembered in this server instance for `FAILURE_MEMO_MS`, so while DeepL is slow or away the
 * backoffice does not wait its five-second timeout on every page.
 */

const TAG = "br-translation-credit";
/** An hour: the credit moves only when somebody presses, and every press expires it. */
const CREDIT_CACHE_SECONDS = 3_600;
/** How long a failed read is answered from memory before DeepL is asked again. */
export const FAILURE_MEMO_MS = 60_000;

let lastFailure: { at: number; keyId: string; reason: TranslatorFailure } | null = null;

export type CreditReading = { ok: true; credit: TranslationCredit } | { ok: false; reason: "unconfigured" | TranslatorFailure };

class UsageNotRead extends Error {
  readonly reason: TranslatorFailure;

  constructor(reason: TranslatorFailure) {
    super(reason);
    this.reason = reason;
  }
}

export async function readTranslationCredit(
  env: TranslateEnvironment,
  read: (env: TranslateEnvironment) => Promise<TranslateUsage | null> = readTranslationUsageForEnvironment,
  now: () => number = Date.now,
): Promise<CreditReading> {
  if (!(env.TRANSLATE_PROVIDER === "deepl" && env.DEEPL_API_KEY)) return { ok: false, reason: "unconfigured" };
  const keyId = creditCacheKey(env.DEEPL_API_KEY);
  if (lastFailure && lastFailure.keyId === keyId && now() - lastFailure.at < FAILURE_MEMO_MS) {
    return { ok: false, reason: lastFailure.reason };
  }
  const reading = await askCredit(env, read, keyId);
  lastFailure = reading.ok ? null : { at: now(), keyId, reason: reading.reason as TranslatorFailure };
  return reading;
}

/**
 * The key's part of the cache key: its host kind and a non-reversible fingerprint (the first
 * eight hex characters of the key's SHA-256) — never the key — so a new key reads its own credit.
 */
export function creditCacheKey(apiKey: string): string {
  const key = apiKey.trim();
  const kind = key.endsWith(":fx") ? "free" : "pro";
  return `${kind}-${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 8)}`;
}

async function askCredit(
  env: TranslateEnvironment,
  read: (env: TranslateEnvironment) => Promise<TranslateUsage | null>,
  keyId: string,
): Promise<CreditReading> {
  const load = async (): Promise<TranslateUsage> => {
    try {
      const usage = await read(env);
      if (!usage) throw new UsageNotRead("refused");
      return usage;
    } catch (error) {
      if (error instanceof UsageNotRead) throw error;
      throw new UsageNotRead(isTranslatorError(error) ? error.failure : "unavailable");
    }
  };
  try {
    const usage = await unstable_cache(load, [TAG, keyId], { revalidate: CREDIT_CACHE_SECONDS, tags: [TAG] })();
    return { ok: true, credit: translationCredit(usage) };
  } catch (error) {
    if (error instanceof UsageNotRead) return { ok: false, reason: error.reason };
    // No data cache here (a test, a script): ask once, directly.
    try {
      return { ok: true, credit: translationCredit(await load()) };
    } catch (again) {
      return { ok: false, reason: again instanceof UsageNotRead ? again.reason : "unavailable" };
    }
  }
}

/** After a press that reached DeepL: the next reading is DeepL's new figure, not the cached one. */
export function forgetTranslationCredit(): void {
  lastFailure = null;
  try {
    revalidateTag(TAG, { expire: 0 });
  } catch {
    // Outside a Next server there is no cache to expire.
  }
}
