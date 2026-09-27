import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { countForm } from "@/i18n/count-form";
import { translatedAllNotice } from "@/modules/translate/ui/use-translate-press";

/**
 * §NNN — the owner, 2026-09-27: «Am nevoie de un toast de confirmare că s-a tradus tot, și
 * toast-urile trebuie să apară în partea de sus».
 *
 * - «Copiază și tradu tot» that worked says so in a toast, counting the English boxes it filled
 *   through `countForm` (§341), with a second sentence when some texts were cut at their limit.
 * - Every toast — backoffice (§384) and public (§427), one `ToastRegion` — sits at the top.
 */
const ROOT = process.cwd();

describe("§NNN the translate-all press toasts its count", () => {
  it("builds a success notice keyed on whether anything was cut, the count as a string", () => {
    expect(translatedAllNotice(7, [])).toEqual({ kind: "success", key: "translatedAll", values: { count: "7" } });
    expect(translatedAllNotice(3, ["Titlu"])).toEqual({ kind: "success", key: "translatedAllCut", values: { count: "3" } });
  });

  it("has the three counted forms in both catalogues, each naming {count}", () => {
    for (const catalogue of [ro, en]) {
      const toast = catalogue.Feedback.toast as unknown as Record<string, Record<string, string>>;
      for (const key of ["translatedAll", "translatedAllCut"]) {
        for (const form of ["one", "few", "other"]) {
          expect(toast[key]?.[form], `${key}.${form}`).toContain("{count}");
        }
      }
    }
  });

  it("reads as Romanian and English for 1, 2 and 20 boxes", () => {
    const sentence = (locale: "ro" | "en", count: number) => {
      const t = createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Feedback" });
      return t(`toast.translatedAll.${countForm(count, locale)}` as never, { count: String(count) } as never) as string;
    };
    expect(sentence("ro", 1)).toContain("1 câmp în engleză");
    expect(sentence("ro", 2)).toContain("2 câmpuri în engleză");
    expect(sentence("ro", 20)).toContain("20 de câmpuri în engleză");
    expect(sentence("en", 1)).toContain("1 English box.");
    expect(sentence("en", 5)).toContain("5 English boxes.");
  });

  it("is shown only by the whole-record press, through the one toast door", () => {
    const hook = readFileSync(path.join(ROOT, "src/modules/translate/ui/use-translate-press.ts"), "utf8");
    expect(hook).toContain("useToast()");
    expect(hook).toMatch(/if \(options\.all\) toast\.show\(translatedAllNotice\(/);
  });
});

describe("§NNN toasts sit at the top", () => {
  it("anchors the one ToastRegion at the top, under the sticky header, and never at the bottom", () => {
    const region = readFileSync(path.join(ROOT, "src/shared/feedback/ToastRegion.tsx"), "utf8");
    expect(region).toContain('anchorOrigin={{ vertical: "top", horizontal: "center" }}');
    expect(region).not.toContain('vertical: "bottom"');
    expect(region).toMatch(/sx=\{\{ top: \{ xs: \d+, sm: \d+ \} \}\}/);
  });
});
