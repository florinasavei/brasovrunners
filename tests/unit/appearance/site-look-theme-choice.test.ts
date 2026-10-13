import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §708 (amended): the setting is «Tema», a choice of two — «Tema v1» (the site as it has been) and
 * «Tema v2» (the facelift) — in both languages. The stored value and the form's field name are
 * unchanged (`look` = off | on); only the words moved, and «Aspectul nou» is read nowhere.
 */
let locale: "ro" | "en" = "ro";
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  const translator = (namespace: string) => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" });
  return {
    getLocale: async () => locale,
    getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => translator(typeof arg === "string" ? arg : arg.namespace),
  };
});
vi.mock("@/app/[locale]/admin/settings/appearance/actions", () => ({ updateSiteLookAction: async () => ({}) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", {}, children),
  getPathname: () => "/ro/admin/design",
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/admin/settings/appearance",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { default: SiteLookPanel } = await import("@/modules/appearance/ui/SiteLookPanel");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

const draw = async (on: boolean) => renderToStaticMarkup(await SiteLookPanel({ locale, state: { setting: { on }, updatedAt: null }, mayEdit: true, openWhen: { primary: true } }));
const radio = (html: string, value: string) => html.match(new RegExp(`<input[^>]*name="look"[^>]*value="${value}"[^>]*>`))?.[0] ?? "";

describe("§708 «Tema»: Tema v1 or Tema v2", () => {
  it("draws two radios named «Tema v1» and «Tema v2», the legend «Tema», in Romanian and in English", async () => {
    const names = { ro: ["Tema v1", "Tema v2"], en: ["Theme v1", "Theme v2"] } as const;
    for (const language of ["ro", "en"] as const) {
      locale = language;
      const html = await draw(false);
      expect(radio(html, "off")).not.toBe("");
      expect(radio(html, "on")).not.toBe("");
      for (const name of names[language]) expect(html).toContain(name);
      expect(html).toContain(language === "ro" ? ">Tema<" : ">Theme<");
      expect(html).not.toMatch(/Aspectul nou|new look/i);
    }
    locale = "ro";
  });

  it("ticks Tema v2 when the setting is on, Tema v1 when it is off, and says what each is", async () => {
    expect(radio(await draw(true), "on")).toContain("checked");
    expect(radio(await draw(false), "off")).toContain("checked");
    expect(radio(await draw(false), "on")).not.toContain("checked");
    expect(ro.Admin.look.choices.off.help).toContain("Site-ul așa cum a fost");
    expect(en.Admin.look.choices.on.help).toMatch(/accent/i);
  });

  it("leaves no «Aspectul nou» / «the new look» in either catalogue", () => {
    for (const [name, catalogue] of [["ro", ro], ["en", en]] as const) {
      expect(JSON.stringify(catalogue), name).not.toMatch(/[Aa]spectul nou|[Tt]he new look/);
    }
  });
});
