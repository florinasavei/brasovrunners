import type { TranslateProviderSetting } from "@/shared/config/env-enums";
import type { TranslateUsage, Translator } from "./adapter";
import { createDeeplTranslator, readDeeplUsage } from "./deepl-adapter";

/**
 * The translator this deployment has, or none (`DECISIONS.md` §464).
 *
 * None is an ordinary answer, not an error: `TRANSLATE_PROVIDER=off`, or `deepl` with no
 * `DEEPL_API_KEY`. The buttons are then absent (`TranslateProvider` is told so by the layout) and
 * the action refuses, in words, anything that reaches it anyway.
 */
export type TranslateEnvironment = { TRANSLATE_PROVIDER: TranslateProviderSetting; DEEPL_API_KEY?: string | undefined };

export function isTranslationConfigured(env: TranslateEnvironment): boolean {
  return env.TRANSLATE_PROVIDER === "deepl" && Boolean(env.DEEPL_API_KEY);
}

export function createTranslatorForEnvironment(env: TranslateEnvironment): Translator | null {
  if (env.TRANSLATE_PROVIDER === "deepl" && env.DEEPL_API_KEY) return createDeeplTranslator({ apiKey: env.DEEPL_API_KEY });
  return null;
}

/**
 * What the configured key has used and may use (§NNN), from the provider's own meter, or null
 * when no translator is configured here. Throws `TranslatorError` when the provider says no.
 */
export async function readTranslationUsageForEnvironment(
  env: TranslateEnvironment,
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>,
): Promise<TranslateUsage | null> {
  if (env.TRANSLATE_PROVIDER === "deepl" && env.DEEPL_API_KEY) return readDeeplUsage({ apiKey: env.DEEPL_API_KEY, fetchImpl });
  return null;
}
