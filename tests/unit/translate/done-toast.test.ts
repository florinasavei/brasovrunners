import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { countForm } from "@/i18n/count-form";
import {
  type PressWords,
  pressFeedback,
  translatedAllNotice,
  translatedOneNotice,
  translateRefusalNotice,
} from "@/modules/translate/ui/use-translate-press";
import { LONG_TOAST_AUTO_HIDE_MS, TOAST_AUTO_HIDE_MS } from "@/shared/feedback/notice";
import { TOAST_ANCHOR, TOAST_TOP_PX } from "@/shared/feedback/ToastRegion";
import { HEADER_CLEARANCE_PX } from "@/theme/brand";

/**
 * §NNN — the owner, 2026-09-27: «Am nevoie de un toast de confirmare că s-a tradus tot, și
 * toast-urile trebuie să apară în partea de sus».
 *
 * - «Copiază și tradu tot» says what happened in a toast: the count of English boxes it filled
 *   (`countForm`, §341), a second wording when some texts were cut, and — when it did not
 *   translate — the status line's own reason (today's budget, DeepL's month, nothing written).
 * - One box's «Tradu din română» that worked toasts a short «Tradus»; its refusal stays beside the box.
 * - Every toast — backoffice (§384) and public (§427), one `ToastRegion` — sits at the top.
 */
type Locale = "ro" | "en";
const catalogue = (locale: Locale) => (locale === "ro" ? ro : en);

function words(locale: Locale): PressWords {
  const t = createTranslator({ locale, messages: catalogue(locale), namespace: "Translate" });
  return (key, values) => t(key as never, values as never) as string;
}

/** A toast's sentence as the provider draws it: counted keys through `countForm`, plain ones as they are. */
function toastSentence(locale: Locale, key: string, count?: number): string {
  const t = createTranslator({ locale, messages: catalogue(locale), namespace: "Feedback" });
  if (count === undefined) return t(`toast.${key}` as never) as string;
  return t(`toast.${key}.${countForm(count, locale)}` as never, { count: String(count) } as never) as string;
}

describe("§NNN the translate press toasts its outcome", () => {
  it("the whole-record press that worked: a success notice keyed on whether anything was cut, for 8 s", () => {
    expect(translatedAllNotice(7, [])).toEqual({ kind: "success", key: "translatedAll", values: { count: "7" }, autoHideMs: LONG_TOAST_AUTO_HIDE_MS });
    expect(translatedAllNotice(3, ["Titlu"])).toMatchObject({ kind: "success", key: "translatedAllCut", values: { count: "3" } });
    expect(LONG_TOAST_AUTO_HIDE_MS).toBe(8000);
    expect(LONG_TOAST_AUTO_HIDE_MS).toBeGreaterThan(TOAST_AUTO_HIDE_MS);
    const feedback = pressFeedback({ kind: "done", count: 4, cut: [] }, true, words("ro"), "ro");
    expect(feedback.message.tone).toBe("done");
    expect(feedback.notice).toEqual(translatedAllNotice(4, []));
  });

  it("one box's press that worked: the short «Tradus» toast, the ordinary duration", () => {
    const feedback = pressFeedback({ kind: "done", count: 1, cut: [] }, false, words("ro"), "ro");
    expect(feedback.notice).toEqual(translatedOneNotice());
    expect(feedback.notice?.autoHideMs).toBeUndefined();
    expect(toastSentence("ro", "translatedOne")).toBe("Tradus. Verifică și apasă Salvează.");
    expect(toastSentence("en", "translatedOne")).toBe("Translated. Check it and press Save.");
  });

  it("the whole-record press stopped by today's budget toasts the budget sentence as a warning", () => {
    for (const locale of ["ro", "en"] as const) {
      const feedback = pressFeedback({ kind: "refused", reason: "budget", remainingToday: 1200 }, true, words(locale), locale);
      expect(feedback.message.tone).toBe("refused");
      expect(feedback.notice).toMatchObject({ kind: "warning", sentence: feedback.message.text, autoHideMs: LONG_TOAST_AUTO_HIDE_MS });
      expect(feedback.notice?.sentence).toContain(locale === "ro" ? "bugetul de azi" : "today's budget");
      expect(feedback.notice?.sentence).toMatch(/1[.,]200/);
    }
  });

  it("the whole-record press stopped by DeepL's credit toasts the quota sentence as a warning", () => {
    const feedback = pressFeedback({ kind: "refused", reason: "quota" }, true, words("ro"), "ro");
    expect(feedback.notice).toMatchObject({ kind: "warning", sentence: ro.Translate.refusal.quota });
  });

  it("the whole-record press asking more than the credit left toasts the credit sentence, with what is left, as a warning", () => {
    for (const locale of ["ro", "en"] as const) {
      const feedback = pressFeedback({ kind: "refused", reason: "credit", remainingCredit: 3400 }, true, words(locale), locale);
      expect(feedback.message.tone).toBe("refused");
      expect(feedback.notice).toMatchObject({ kind: "warning", sentence: feedback.message.text, autoHideMs: LONG_TOAST_AUTO_HIDE_MS });
      expect(feedback.notice?.sentence).toContain(locale === "ro" ? "creditul DeepL" : "the DeepL credit");
      expect(feedback.notice?.sentence).toMatch(/3[.,]400/);
    }
  });

  it("a refused key, nothing to translate and a failed request are toasted too — an error, a warning, an error", () => {
    expect(pressFeedback({ kind: "refused", reason: "refused" }, true, words("en"), "en").notice).toMatchObject({ kind: "error", sentence: en.Translate.refusal.refused });
    expect(pressFeedback({ kind: "nothing" }, true, words("ro"), "ro").notice).toMatchObject({ kind: "warning", sentence: ro.Translate.refusal.nothingAll });
    expect(pressFeedback({ kind: "failed" }, true, words("ro"), "ro").notice).toMatchObject({ kind: "error", sentence: ro.Translate.refusal.failed });
    expect(translateRefusalNotice("rateLimited", "x").kind).toBe("warning");
  });

  it("one box's refusal stays beside the box: a status line, no toast", () => {
    for (const result of [{ kind: "nothing" } as const, { kind: "refused", reason: "budget", remainingToday: 0 } as const, { kind: "failed" } as const]) {
      const feedback = pressFeedback(result, false, words("ro"), "ro");
      expect(feedback.message.tone).toBe("refused");
      expect(feedback.notice).toBeNull();
    }
  });

  it("says the count and the Save button in Romanian and English for 1, 2 and 20 boxes, cut or not", () => {
    expect(toastSentence("ro", "translatedAll", 1)).toBe("Gata: 1 câmp tradus din română în engleză. Verifică textul și apasă Salvează.");
    expect(toastSentence("ro", "translatedAll", 2)).toContain("2 câmpuri traduse din română în engleză");
    expect(toastSentence("ro", "translatedAll", 20)).toContain("20 de câmpuri traduse");
    expect(toastSentence("en", "translatedAll", 1)).toBe("Done: 1 box translated from Romanian into English. Check it and press Save.");
    expect(toastSentence("en", "translatedAll", 5)).toContain("5 boxes translated");
    for (const count of [1, 2, 20]) {
      for (const locale of ["ro", "en"] as const) {
        const cut = toastSentence(locale, "translatedAllCut", count);
        expect(cut).toContain(String(count));
        expect(cut).toContain(locale === "ro" ? "apasă Salvează" : "press Save");
        expect(cut).toContain(locale === "ro" ? "scurtat" : "cut");
      }
    }
    expect(toastSentence("ro", "translatedAllCut", 20)).toContain("20 de câmpuri");
  });

  it("has the new keys in both catalogues, the same shape in each", () => {
    const toast = (locale: Locale) => catalogue(locale).Feedback.toast as unknown as Record<string, unknown>;
    for (const key of ["translatedAll", "translatedAllCut", "translatedOne", "translateRefused"]) {
      const shape = (value: unknown) => (typeof value === "string" ? "string" : Object.keys(value as object).sort().join(","));
      expect(toast("ro")[key], key).toBeDefined();
      expect(shape(toast("ro")[key]), key).toBe(shape(toast("en")[key]));
    }
  });
});

describe("§NNN toasts sit at the top", () => {
  it("anchors the one ToastRegion top centre, at the header clearance the theme's scroll padding also reads", () => {
    expect(TOAST_ANCHOR).toEqual({ vertical: "top", horizontal: "center" });
    expect(TOAST_TOP_PX).toBe(HEADER_CLEARANCE_PX);
    expect(HEADER_CLEARANCE_PX).toEqual({ xs: 72, sm: 76 });
  });
});
