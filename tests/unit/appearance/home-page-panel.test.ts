import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §NNN — «Pagina principală»'s panel as the Administrator opens it: one fold per part of the page,
 * every fold closed on arrival (§336) with a line that says what is in it — «5 din 8 arătate»,
 * «Cu fotografie» / «Fără fotografie», «Textele clubului» / «Textele implicite», «1 din 2 completate»
 * and the strip's picture count — drawn from the real catalogue.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  const translator = (locale: "ro" | "en", namespace: string) => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" });
  return {
    getLocale: async () => "ro",
    getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => (typeof arg === "string" ? translator("ro", arg) : translator(arg.locale, arg.namespace)),
  };
});
vi.mock("@/app/[locale]/admin/settings/appearance/actions", () => ({
  addStripPictureAction: async () => ({}),
  moveStripPictureAction: async () => ({}),
  removeStripPictureAction: async () => ({}),
  updateHomePageAction: async () => ({}),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", {}, children),
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/admin/settings/appearance",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/modules/media/storage", () => ({ isStorageConfigured: () => false, getStorage: () => null, objectKey: () => "" }));

const { default: HomePagePanel } = await import("@/modules/appearance/ui/HomePagePanel");
const { DEFAULT_HOME_PAGE_SETTING } = await import("@/modules/appearance/domain/home-page");

const draw = async (setting: typeof DEFAULT_HOME_PAGE_SETTING) => {
  const element = await HomePagePanel({ locale: "ro", state: { setting, updatedAt: null }, mayEdit: true, pages: [], openWhen: { primary: true } });
  return renderToStaticMarkup(element);
};

/** The fold with this id: its opening tag up to its first closing `</summary>`. */
const fold = (html: string, id: string) => {
  const start = html.indexOf(`id="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  return html.slice(Math.max(0, html.lastIndexOf("<details", start)), html.indexOf("</summary>", start) + 10);
};

describe("§NNN the home page panel's folds", () => {
  it("says «Cu fotografie» for a chosen hero photograph and counts the strip's pictures", async () => {
    const picture = (n: number) => ({ assetId: `00000000-0000-4000-8000-00000000000${n}`, keyPrefix: `gallery/p${n}`, width: 1600, height: 900 });
    const html = await draw({
      ...DEFAULT_HOME_PAGE_SETTING,
      hero: { ...picture(9), crop: null },
      strip: { ...DEFAULT_HOME_PAGE_SETTING.strip, pictures: [picture(1), picture(2), picture(3)] },
    });
    expect(html).toContain("Cu fotografie");
    expect(html).not.toContain("Fără fotografie");
    expect(html).toContain("3 fotografii");
  });

  it("closes every fold on arrival and says what is in it, the platform's words and no photograph by default", async () => {
    const html = await draw(DEFAULT_HOME_PAGE_SETTING);
    for (const id of ["home-page-steps", "home-page-why", "home-page-strip", "home-page-numbers"]) {
      const head = fold(html, id);
      expect(head, id).toContain("<details");
      expect(head, id).not.toMatch(/<details[^>]*\sopen/);
    }
    expect(html).toContain("4 din 8 arătate");
    expect(html).toContain("Fără fotografie");
    expect(fold(html, "home-page-steps")).toContain("Textele implicite");
    expect(fold(html, "home-page-why")).toContain("Textele implicite");
    expect(fold(html, "home-page-numbers")).toContain("0 din 2 completate");
    expect(html).toContain("0 fotografii");
  });

  it("reads the club's words, its figures and its sections off the setting", async () => {
    const setting = {
      ...DEFAULT_HOME_PAGE_SETTING,
      sections: { ...DEFAULT_HOME_PAGE_SETTING.sections, steps: true },
      steps: { ...DEFAULT_HOME_PAGE_SETTING.steps, title: { ro: "Nou aici?", en: "New here?" } },
      numbers: { foundedOn: "2016-05-01", activeRunners: null },
    };
    const html = await draw(setting);
    expect(html).toContain("5 din 8 arătate");
    expect(fold(html, "home-page-steps")).toContain("Textele clubului");
    expect(fold(html, "home-page-why")).toContain("Textele implicite");
    expect(fold(html, "home-page-numbers")).toContain("1 din 2 completate");
  });
});
