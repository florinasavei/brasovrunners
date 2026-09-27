"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { countForm } from "@/i18n/count-form";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import { ASK_ABOVE_CHARACTERS } from "../domain/budget";
import { labelOfBox, planTranslateAll, type TranslateAllPlan } from "./form-fields";
import { useTranslatePress } from "./use-translate-press";

/**
 * Where a press reads and writes: the form the boxes post in, and — for one card — the card and
 * its name (`card`, for the toast «… traduse în „Descrierea completă”», §514).
 */
export type TranslateScope = { form: HTMLFormElement | null; within?: ParentNode | null; card?: string | null };

/**
 * What follows a press (§514): `onDone` only when boxes were filled — a refusal, a failure or a
 * form with no Romanian words leaves the reader where they are, reading the line and the toast.
 */
export function afterPress(result: { kind: string } | null, onDone?: () => void): void {
  if (result?.kind === "done") onDone?.();
}

/**
 * One press over many English boxes, with the one question it may ask first (§482): shared by
 * «Copiază și tradu tot: RO → EN» at the top of an editor (the whole form) and «Tradu cardul: RO →
 * EN» in a card's tab row (§514, the card's boxes only), so both ask the same question at the same
 * moments — English already written would be replaced («Înlocuiește tot» / «Doar cele goale»), or
 * the press would send more than `ASK_ABOVE_CHARACTERS` — and say what happened the same way
 * (`pressFeedback`: the line and the toast, §496).
 *
 * `scope` is read at the press, never at render: the boxes are the browser's, as typed now.
 * `bigTitle` is the question's title when only the size asks, in the press's own words.
 * `onDone` runs once the boxes were filled — a card's press brings its English tab forward (§514),
 * so the person reads the result rather than the unchanged Romanian.
 */
export function useTranslateAll(scope: () => TranslateScope, bigTitle: string, onDone?: () => void) {
  const t = useTranslations("Translate");
  const locale = useLocale();
  const [asking, setAsking] = useState<{ plan: TranslateAllPlan; labels: string[] } | null>(null);
  const { pending, message, translate } = useTranslatePress();

  const go = (form: HTMLFormElement | null, names: readonly string[], card: string | null | undefined) => {
    void translate(form, names, { all: true, card }).then((result) => afterPress(result, onDone));
  };
  const press = () => {
    const { form, within, card } = scope();
    const plan = planTranslateAll(form, within);
    // Empty English boxes and an ordinary amount of words: one press, no question.
    if (plan.replaced.length === 0 && plan.characters <= ASK_ABOVE_CHARACTERS) {
      go(form, plan.names, card);
      return;
    }
    setAsking({ plan, labels: plan.replaced.map((name) => labelOfBox(form, name)) });
  };
  const run = (names: readonly string[]) => {
    setAsking(null);
    const { form, card } = scope();
    go(form, names, card);
  };
  const figure = (count: number) => new Intl.NumberFormat(locale).format(count);

  const spec = ((): ConfirmSpec | null => {
    if (!asking) return null;
    const { plan, labels } = asking;
    const big = plan.characters > ASK_ABOVE_CHARACTERS;
    const budget = big
      ? [
          t("confirm.budget", { count: figure(plan.characters) }),
          plan.replaced.length > 0 && plan.empty.length > 0 ? t("confirm.budgetEmpty", { count: figure(plan.emptyCharacters) }) : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "";
    if (plan.replaced.length === 0) {
      return { title: bigTitle, body: `${budget} ${t("confirm.bigBody")}`, confirmLabel: t("confirm.go"), cancelLabel: t("confirm.cancel") };
    }
    const body = t("confirm.allBody", { count: plan.replaced.length, fields: labels.join(" · ") });
    return {
      // Counted through `countForm`, never an ICU plural (`docs/VIBECODING.md`, §341).
      title: t(`confirm.allTitle.${countForm(plan.replaced.length, locale)}`, { count: plan.replaced.length }),
      body: budget ? `${body} ${budget}` : body,
      confirmLabel: t("confirm.replaceAll"),
      cancelLabel: t("confirm.cancel"),
    };
  })();

  /** Everything `ConfirmDialog` takes, ready to spread. */
  const dialog = {
    open: asking !== null,
    spec,
    onCancel: () => setAsking(null),
    onConfirm: () => run(asking?.plan.names ?? []),
    alternative:
      asking && asking.plan.replaced.length > 0 && asking.plan.empty.length > 0
        ? { label: t("confirm.onlyEmpty"), onClick: () => run(asking.plan.empty) }
        : null,
  };

  return { pending, message, press, dialog };
}
