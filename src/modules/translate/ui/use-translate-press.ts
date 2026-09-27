"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { FormNotice } from "@/shared/feedback/notice";
import { useToast } from "@/shared/feedback/toast-context";
import { translateBoxes } from "./form-fields";
import { useTranslateAction } from "./TranslateProvider";

export type PressMessage = { tone: "done" | "refused"; text: string };

/**
 * The toast after «Copiază și tradu tot» worked (§NNN; the owner, 2026-09-27: «Am nevoie de un
 * toast de confirmare că s-a tradus tot»): how many English boxes were filled, counted through
 * `countForm` by the provider (`Feedback.toast.translatedAll.one|few|other`, never an ICU plural,
 * §341), and a second sentence when some were cut at their box's limit — the names stay in the
 * status line under the button, where they can be read at leisure.
 */
export function translatedAllNotice(count: number, cut: readonly string[]): FormNotice {
  return { kind: "success", key: cut.length === 0 ? "translatedAll" : "translatedAllCut", values: { count: String(count) } };
}

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
  const toast = useToast();
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
              : t(`refusal.${result.reason}`),
        });
        return;
      }
      const done = result.count === 1 ? t("done") : t("doneAll", { count: result.count });
      setMessage({ tone: "done", text: result.cut.length === 0 ? done : `${done} ${t("cut", { fields: result.cut.join(", ") })}` });
      // The whole-record press also says so in a toast at the top (§384, §NNN): the status line
      // sits under the button, easily out of sight on a long editor.
      if (options.all) toast.show(translatedAllNotice(result.count, result.cut));
    } catch {
      setMessage({ tone: "refused", text: t("refusal.failed") });
    } finally {
      setPending(false);
    }
  }

  return { enabled: action !== null, pending, message, translate };
}
