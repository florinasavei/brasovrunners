"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { countForm } from "@/i18n/count-form";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import { ASK_ABOVE_CHARACTERS } from "../domain/budget";
import { labelOfBox, planTranslateAll, type TranslateAllPlan } from "./form-fields";
import { useTranslatePress } from "./use-translate-press";

/** `card` names the card for its toast (§514). */
export type TranslateScope = { form: HTMLFormElement | null; within?: ParentNode | null; card?: string | null };

/** `onDone` only when boxes were filled (§514). */
export function afterPress(result: { kind: string } | null, onDone?: () => void): void {
  if (result?.kind === "done") onDone?.();
}

/**
 * The many-box press shared by «Copiază și tradu tot» (§482) and «Tradu cardul» (§514), so both
 * ask first on the same conditions and report the same way (§496).
 *
 * `scope` is read at the press, never at render. `bigTitle` titles the question when only the
 * size asks.
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
