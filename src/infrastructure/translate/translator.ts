import type { TranslateProviderSetting } from "@/shared/config/env-enums";
import type { TranslateUsage, Translator } from "./adapter";
import { createDeeplTranslator, readDeeplUsage } from "./deepl-adapter";

/**
 * The deployment's translator, or none (`DECISIONS.md` §464). None (`off`, or `deepl` without a
 * key) is not an error: the buttons are absent and the action refuses in words.
 */
export type TranslateEnvironment = { TRANSLATE_PROVIDER: TranslateProviderSetting; DEEPL_API_KEY?: string | undefined };

export function isTranslationConfigured(env: TranslateEnvironment): boolean {
  return env.TRANSLATE_PROVIDER === "deepl" && Boolean(env.DEEPL_API_KEY);
}

export function createTranslatorForEnvironment(env: TranslateEnvironment): Translator | null {
  if (env.TRANSLATE_PROVIDER === "deepl" && env.DEEPL_API_KEY) return createDeeplTranslator({ apiKey: env.DEEPL_API_KEY });
  return null;
}

/** The key's usage from the provider's meter (§497), or null when none is configured; throws `TranslatorError`. */
export async function readTranslationUsageForEnvironment(
  env: TranslateEnvironment,
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>,
): Promise<TranslateUsage | null> {
  if (env.TRANSLATE_PROVIDER === "deepl" && env.DEEPL_API_KEY) return readDeeplUsage({ apiKey: env.DEEPL_API_KEY, fetchImpl });
  return null;
}
