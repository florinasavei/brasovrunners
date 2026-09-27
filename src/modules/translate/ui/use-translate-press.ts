"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { translateBoxes } from "./form-fields";
import { useTranslateAction } from "./TranslateProvider";

export type PressMessage = { tone: "done" | "refused"; text: string };

/**
 * One press of «Tradu din română», for one box or for all of them (`DECISIONS.md` §464): read the
 * Romanian twins as they are now, ask the action, put each answer in its English box, and say in
 * words what happened. The pressed state first (§371): the label turns to «Se traduce…» before
 * the request leaves. Nothing is saved — the sentence says so, and the ordinary save stores the
 * draft under the both-languages rule (§352).
 */
export function useTranslatePress() {
  const t = useTranslations("Translate");
  const locale = useLocale();
  const action = useTranslateAction();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<PressMessage | null>(null);

  async function translate(form: HTMLFormElement | null, englishNames: readonly string[], options: { all?: boolean } = {}): Promise<void> {
    if (!action) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await translateBoxes(form, englishNames, action);
      if (result.kind === "nothing") {
        // «Copiază și tradu tot» on a form with no Romanian words yet says so for the whole form.
        setMessage({ tone: "refused", text: options.all ? t("refusal.nothingAll") : t("refusal.nothing") });
        return;
      }
      if (result.kind === "refused") {
        setMessage({
          tone: "refused",
          text:
            result.reason === "budget"
              ? t("refusal.budget", { remaining: new Intl.NumberFormat(locale).format(result.remainingToday ?? 0) })
              : result.reason === "credit"
                ? t("refusal.credit", { remaining: new Intl.NumberFormat(locale).format(result.remainingCredit ?? 0) })
                : t(`refusal.${result.reason}`),
        });
        return;
      }
      const done = result.count === 1 ? t("done") : t("doneAll", { count: result.count });
      setMessage({ tone: "done", text: result.cut.length === 0 ? done : `${done} ${t("cut", { fields: result.cut.join(", ") })}` });
    } catch {
      setMessage({ tone: "refused", text: t("refusal.failed") });
    } finally {
      setPending(false);
    }
  }

  return { enabled: action !== null, pending, message, translate };
}
