import type { TranslateProviderSetting } from "@/shared/config/env-enums";
import type { Translator } from "./adapter";
import { createDeeplTranslator } from "./deepl-adapter";

/**
 * The translator this deployment has, or none (`DECISIONS.md` §NNN).
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
