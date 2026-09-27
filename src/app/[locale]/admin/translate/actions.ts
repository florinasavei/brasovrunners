"use server";

import { getDb } from "@/db/client";
import { createTranslatorForEnvironment } from "@/infrastructure/translate/translator";
import { forgetTranslationCredit, readTranslationCredit } from "@/modules/translate/credit";
import { type TranslateOutcome, translateClubTexts } from "@/modules/translate/service";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * «Tradu din română» (`DECISIONS.md` §464): the Romanian words of some English boxes, translated,
 * handed back to the button that asked. Called by the button, not posted by a form — the answer
 * fills boxes in the browser and saves nothing, so there is no page to redirect to and no toast
 * of "saved". The session is asserted here and the role again in the service (BR-REQ-060-01);
 * every other rule — which boxes, the throttle, the budget, the audit row — is the service's.
 */
export async function translateFieldAction(input: unknown): Promise<TranslateOutcome> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return { ok: false, reason: "forbidden" };
    throw error;
  }
  const outcome = await translateClubTexts(getDb(), actor, input, {
    translator: createTranslatorForEnvironment(env),
    now: new Date(),
    // DeepL's credit (§NNN): a spent one refuses without a request; an unread one lets DeepL answer.
    credit: async () => {
      const reading = await readTranslationCredit(env);
      return reading.ok ? reading.credit : null;
    },
  });
  // A press that reached DeepL moved its meter: the next reading on Costuri is DeepL's new figure.
  if (outcome.ok || outcome.reason === "quota" || outcome.reason === "unavailable") forgetTranslationCredit();
  return outcome;
}
