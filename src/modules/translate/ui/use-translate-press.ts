"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { type FormNotice, LONG_TOAST_AUTO_HIDE_MS } from "@/shared/feedback/notice";
import { useToast } from "@/shared/feedback/toast-context";
import type { TranslateRefusal } from "../service";
import { type TranslateBoxesResult, translateBoxes } from "./form-fields";
import { useTranslateAction } from "./TranslateProvider";

export type PressMessage = { tone: "done" | "refused"; text: string };

/**
 * The toast after «Copiază și tradu tot» worked (§496; the owner, 2026-09-27: «Am nevoie de un
 * toast de confirmare că s-a tradus tot»): how many English boxes were filled, counted through
 * `countForm` by the provider (`Feedback.toast.translatedAll.one|few|other`, never an ICU plural,
 * §341), and a second sentence when some were cut at their box's limit — the names stay in the
 * status line under the button, where they can be read at leisure. It stays 8 s, not 5.5: it
 * names a count and asks for a check before Save.
 */
export function translatedAllNotice(count: number, cut: readonly string[]): FormNotice {
  return {
    kind: "success",
    key: cut.length === 0 ? "translatedAll" : "translatedAllCut",
    values: { count: String(count) },
    autoHideMs: LONG_TOAST_AUTO_HIDE_MS,
  };
}

/** One box's «Tradu din română» that worked: a short «Tradus. Verifică și apasă Salvează.» (§496). */
export function translatedOneNotice(): FormNotice {
  return { kind: "success", key: "translatedOne" };
}

/**
 * The whole-record press that did not translate says why in a toast too (§496), with the status
 * line's own sentence (`Translate.refusal.*`, already in the reader's language): a limit that
 * will lift — today's budget, DeepL's month or a credit too small for this text, the hourly
 * rate, nothing written yet — is a `warning`; anything else an `error`.
 */
export function translateRefusalNotice(reason: TranslateRefusal | "failed", sentence: string): FormNotice {
  const warning =
    reason === "budget" || reason === "quota" || reason === "credit" || reason === "rateLimited" || reason === "nothing";
  return { kind: warning ? "warning" : "error", key: "translateRefused", sentence, autoHideMs: LONG_TOAST_AUTO_HIDE_MS };
}

/** The catalogue as `pressFeedback` reads it: `Translate`'s own translator, or a test's. */
export type PressWords = (key: string, values?: Record<string, string | number>) => string;

/**
 * What one press says, without React (§464, §496): the status line under the button, and the
 * toast at the top, or none. The whole-record press toasts every outcome — the count when it
 * worked, the status line's own reason when it did not (today's budget, DeepL's month or the
 * credit left, nothing written yet, a failed request) — because its button sits far from the
 * boxes it filled. One box's button toasts only the short «Tradus»: its refusal is read beside
 * the box.
 */
export function pressFeedback(
  result: TranslateBoxesResult | { kind: "failed" },
  all: boolean,
  t: PressWords,
  locale: string,
): { message: PressMessage; notice: FormNotice | null } {
  if (result.kind === "done") {
    const done = result.count === 1 ? t("done") : t("doneAll", { count: result.count });
    const text = result.cut.length === 0 ? done : `${done} ${t("cut", { fields: result.cut.join(", ") })}`;
    return { message: { tone: "done", text }, notice: all ? translatedAllNotice(result.count, result.cut) : translatedOneNotice() };
  }
  let text: string;
  let reason: TranslateRefusal | "failed";
  if (result.kind === "nothing") {
    // «Copiază și tradu tot» on a form with no Romanian words yet says so for the whole form.
    text = all ? t("refusal.nothingAll") : t("refusal.nothing");
    reason = "nothing";
  } else if (result.kind === "refused") {
    text =
      result.reason === "budget"
        ? t("refusal.budget", { remaining: new Intl.NumberFormat(locale).format(result.remainingToday ?? 0) })
        : result.reason === "credit"
          ? t("refusal.credit", { remaining: new Intl.NumberFormat(locale).format(result.remainingCredit ?? 0) })
          : t(`refusal.${result.reason}`);
    reason = result.reason;
  } else {
    text = t("refusal.failed");
    reason = "failed";
  }
  return { message: { tone: "refused", text }, notice: all ? translateRefusalNotice(reason, text) : null };
}

/**
 * One press of «Tradu din română», for one box or for all of them (`DECISIONS.md` §464): read the
 * Romanian twins as they are now, ask the action, put each answer in its English box, and say in
 * words what happened — under the button, and in a toast at the top (`pressFeedback`, §496). The
 * pressed state first (§371): the label turns to «Se traduce…» before the request leaves. Nothing
 * is saved — the sentence says so, and the ordinary save stores the draft under the
 * both-languages rule (§352).
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
    let result: TranslateBoxesResult | { kind: "failed" };
    try {
      result = await translateBoxes(form, englishNames, action);
    } catch {
      result = { kind: "failed" };
    }
    const feedback = pressFeedback(result, options.all === true, t as PressWords, locale);
    setMessage(feedback.message);
    if (feedback.notice) toast.show(feedback.notice);
    setPending(false);
  }

  return { enabled: action !== null, pending, message, translate };
}
