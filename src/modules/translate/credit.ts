import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { isTranslatorError, type TranslateUsage, type TranslatorFailure } from "@/infrastructure/translate/adapter";
import { readTranslationUsageForEnvironment, type TranslateEnvironment } from "@/infrastructure/translate/translator";
import { type TranslationCredit, translationCredit } from "./domain/credit";

/**
 * The DeepL credit from DeepL's meter (§497), cached an hour in Next's data cache (§402, §479) and
 * expired after every press that reached DeepL, so every screen reads one figure.
 *
 * A failure is not cached but memoised in this instance for `FAILURE_MEMO_MS`, so pages do not
 * each wait DeepL's timeout while it is away.
 */

const TAG = "br-translation-credit";
/** The credit moves only on a press, and every press expires it. */
const CREDIT_CACHE_SECONDS = 3_600;
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
 * Host kind plus a non-reversible fingerprint, never the key (§479). The data cache outlives a
 * redeploy, so a replaced key must not inherit the old one's reading.
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

/** Called after a press that reached DeepL. */
export function forgetTranslationCredit(): void {
  lastFailure = null;
  try {
    revalidateTag(TAG, { expire: 0 });
  } catch {
    // Outside a Next server there is no cache to expire.
  }
}
