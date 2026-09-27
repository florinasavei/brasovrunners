import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateAllButton from "@/modules/translate/ui/TranslateAllButton";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";

/**
 * §464 — the buttons exist only where the page offers translation: no action from the layout (no
 * DeepL key, or a role that may not) and nothing is drawn — no button, no catalogue lookup — so a
 * deployment without the key shows every editor exactly as before. With one, the button says its
 * verb in the reader's language. Every word is in both catalogues.
 */

const action: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });

function render(node: ReturnType<typeof createElement>, withAction: boolean) {
  const intl = { locale: "ro", messages: { Translate: ro.Translate } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  // No action: the role may not translate (§482 draws the whole-record button greyed only for a
  // role that may, on a deployment without a key — `one-button.test.ts`).
  const provider = { offer: withAction ? { action, setupHref: null } : null } as ComponentProps<typeof TranslateProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, provider, node)));
}

describe("§464 «Tradu din română» buttons", () => {
  it("draws nothing without a translator, even with no catalogue at all", () => {
    expect(renderToStaticMarkup(createElement(TranslateFieldButton, { en: "translations.en.title" }))).toBe("");
    expect(renderToStaticMarkup(createElement(TranslateAllButton))).toBe("");
    expect(render(createElement(TranslateFieldButton, { en: "translations.en.title" }), false)).toBe("");
  });

  it("draws the per-box and the whole-record button when the page offers translation", () => {
    const one = render(createElement(TranslateFieldButton, { en: "translations.en.title" }), true);
    expect(one).toContain("Tradu din română");
    expect(one).toContain('data-translate-for="translations.en.title"');
    expect(one).toContain('role="status"');
    const all = render(createElement(TranslateAllButton), true);
    expect(all).toContain(ro.Translate.all);
    expect(all).toContain(ro.Translate.allHelp);
  });

  it("has every word in both catalogues", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];
    expect(keys(en.Translate)).toEqual(keys(ro.Translate));
    expect(keys(en.Admin.tasks.translationBudget)).toEqual(keys(ro.Admin.tasks.translationBudget));
  });
});
