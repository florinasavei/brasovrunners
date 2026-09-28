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
 * Counted through `countForm`, never an ICU plural (§341, §496); the cut boxes' names stay in the
 * status line. Long auto-hide: it asks for a check before Save.
 */
export function translatedAllNotice(count: number, cut: readonly string[]): FormNotice {
  return {
    kind: "success",
    key: cut.length === 0 ? "translatedAll" : "translatedAllCut",
    values: { count: String(count) },
    autoHideMs: LONG_TOAST_AUTO_HIDE_MS,
  };
}

/** The whole-record toast with the card's name (§514). */
export function translatedCardNotice(count: number, cut: readonly string[], card: string): FormNotice {
  return {
    kind: "success",
    key: cut.length === 0 ? "translatedCard" : "translatedCardCut",
    values: { count: String(count), card },
    autoHideMs: LONG_TOAST_AUTO_HIDE_MS,
  };
}

export function translatedOneNotice(): FormNotice {
  return { kind: "success", key: "translatedOne" };
}

/** The status line's sentence as a toast (§496): a limit that will lift is a `warning`, anything else an `error`. */
export function translateRefusalNotice(reason: TranslateRefusal | "failed", sentence: string): FormNotice {
  const warning =
    reason === "budget" || reason === "quota" || reason === "credit" || reason === "rateLimited" || reason === "nothing";
  return { kind: warning ? "warning" : "error", key: "translateRefused", sentence, autoHideMs: LONG_TOAST_AUTO_HIDE_MS };
}

export type PressWords = (key: string, values?: Record<string, string | number>) => string;

/**
 * The status line and the toast, without React (§464, §496). A whole-record or card press (§514)
 * toasts every outcome, since its button sits far from the boxes; one box's button toasts only
 * success, its refusal read beside the box.
 */
export function pressFeedback(
  result: TranslateBoxesResult | { kind: "failed" },
  all: boolean,
  t: PressWords,
  locale: string,
  card?: string | null,
): { message: PressMessage; notice: FormNotice | null } {
  if (result.kind === "done") {
    const done = result.count === 1 ? t("done") : t("doneAll", { count: result.count });
    const text = result.cut.length === 0 ? done : `${done} ${t("cut", { fields: result.cut.join(", ") })}`;
    const notice = !all
      ? translatedOneNotice()
      : card
        ? translatedCardNotice(result.count, result.cut, card)
        : translatedAllNotice(result.count, result.cut);
    return { message: { tone: "done", text }, notice };
  }
  let text: string;
  let reason: TranslateRefusal | "failed";
  if (result.kind === "nothing") {
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

/** One press for one box or many (`DECISIONS.md` §464); the pending label paints first (§371). Nothing is saved (§352). */
export function useTranslatePress() {
  const t = useTranslations("Translate");
  const locale = useLocale();
  const action = useTranslateAction();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<PressMessage | null>(null);

  /** Null where the page cannot translate and nothing was asked. */
  async function translate(
    form: HTMLFormElement | null,
    englishNames: readonly string[],
    options: { all?: boolean; card?: string | null } = {},
  ): Promise<TranslateBoxesResult | { kind: "failed" } | null> {
    if (!action) return null;
    setPending(true);
    setMessage(null);
    let result: TranslateBoxesResult | { kind: "failed" };
    try {
      result = await translateBoxes(form, englishNames, action);
    } catch {
      result = { kind: "failed" };
    }
    const feedback = pressFeedback(result, options.all === true, t as PressWords, locale, options.card);
    setMessage(feedback.message);
    if (feedback.notice) toast.show(feedback.notice);
    setPending(false);
    return result;
  }

  return { enabled: action !== null, pending, message, translate };
}
