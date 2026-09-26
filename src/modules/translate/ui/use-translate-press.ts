"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { TranslateItemInput } from "../service";
import { fillBox, isEmptyValue, readBox, romanianBoxOf } from "./form-fields";
import { useTranslateAction } from "./TranslateProvider";

export type PressMessage = { tone: "done" | "refused"; text: string };

/**
 * One press of «Tradu din română», for one box or for all of them (`DECISIONS.md` §NNN): read the
 * Romanian twins as they are now, ask the action, put each answer in its English box, and say in
 * words what happened. The pressed state first (§371): the label turns to «Se traduce…» before
 * the request leaves. Nothing is saved — the sentence says so, and the ordinary save stores the
 * draft under the both-languages rule (§352).
 */
export function useTranslatePress() {
  const t = useTranslations("Translate");
  const action = useTranslateAction();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<PressMessage | null>(null);

  async function translate(form: HTMLFormElement | null, englishNames: readonly string[]): Promise<void> {
    if (!action) return;
    const items: TranslateItemInput[] = [];
    for (const name of englishNames) {
      const romanian = romanianBoxOf(form, name);
      if (!romanian) continue;
      const value = readBox(name, romanian);
      if (isEmptyValue(value)) continue;
      items.push(value.kind === "text" ? { field: name, kind: "text", text: value.text } : { field: name, kind: "rich", doc: value.doc });
    }
    if (items.length === 0) {
      setMessage({ tone: "refused", text: t("refusal.nothing") });
      return;
    }

    setPending(true);
    setMessage(null);
    try {
      const outcome = await action({ items });
      if (!outcome.ok) {
        setMessage({
          tone: "refused",
          text: outcome.reason === "budget" ? t("refusal.budget", { remaining: outcome.remainingToday ?? 0 }) : t(`refusal.${outcome.reason}`),
        });
        return;
      }
      for (const item of outcome.items) fillBox(form, item.field, item.kind === "text" ? { kind: "text", text: item.text } : { kind: "rich", doc: item.doc });
      setMessage({ tone: "done", text: items.length === 1 ? t("done") : t("doneAll", { count: items.length }) });
    } catch {
      setMessage({ tone: "refused", text: t("refusal.failed") });
    } finally {
      setPending(false);
    }
  }

  return { enabled: action !== null, pending, message, translate };
}
