import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §717 — «Pagina principală»'s panel as the Administrator opens it: one fold per part of the page,
 * every fold closed on arrival (§336) with a line that says what is in it — «5 din 8 arătate»,
 * «Cu fotografie» / «Fără fotografie», «Textele clubului» / «Textele implicite», «1 din 2 completate»
 * and the strip's picture count — drawn from the real catalogue.
 */
// The dialogs' road line (§841) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
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

describe("§717 the home page panel's folds", () => {
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

describe("§842 «Prima dată»'s steps and «De ce»'s reasons as the house's row folds", () => {
  /** Every row of a kind: its `<details>` up to its summary's end. */
  const rows = (html: string, kind: "step" | "reason") => [...html.matchAll(new RegExp(`<details[^>]*data-testid="home-page-${kind}"[^>]*>[\\s\\S]*?</summary>`, "g"))].map((match) => match[0]);

  it("draws five steps and four reasons, closed, each line its title in words and the default's mark", async () => {
    const html = await draw(DEFAULT_HOME_PAGE_SETTING);
    const steps = rows(html, "step");
    const reasons = rows(html, "reason");
    expect(steps).toHaveLength(5);
    expect(reasons).toHaveLength(4);
    for (const row of [...steps, ...reasons]) {
      expect(row).not.toMatch(/<details[^>]*\sopen/);
      expect(row).toContain("Textul implicit");
    }
    expect(steps[2]).toContain("Pasul 3");
    expect(steps[2]).toContain("Salută-ne");
    expect(reasons[0]).toContain("Motivul 1");
    expect(reasons[0]).toContain("Împreună");
    // The row's boxes are inside it, and the heading's boxes stay outside every row.
    const stepsFold = html.slice(html.indexOf('id="home-page-steps"'));
    expect(stepsFold).toContain('name="step3TitleRo"');
    expect(html.slice(html.indexOf('data-testid="home-page-step"'))).toContain('name="step1BodyEn"');
    expect(html.indexOf('name="stepsTitleRo"')).toBeLessThan(html.indexOf('data-testid="home-page-step"'));
    expect(html.indexOf('name="stepsLinkRo"')).toBeGreaterThan(html.lastIndexOf('data-testid="home-page-step"'));
  });

  it("names the club's own title on its row and drops the default's mark there", async () => {
    const own = DEFAULT_HOME_PAGE_SETTING.steps.steps.map((step, index) => (index === 1 ? { ...step, title: { ro: "Vino la parc", en: "Come to the park" } } : step));
    const steps = { ...DEFAULT_HOME_PAGE_SETTING.steps, steps: own };
    const html = await draw({ ...DEFAULT_HOME_PAGE_SETTING, steps });
    const row = rows(html, "step")[1]!;
    expect(row).toContain("Pasul 2");
    expect(row).toContain("Vino la parc");
    expect(row).not.toContain("Textul implicit");
  });

  it("puts no required box in a closed row, so the save is never held back by a box nobody can see", async () => {
    const html = await draw(DEFAULT_HOME_PAGE_SETTING);
    const start = html.indexOf('id="home-page-steps"');
    const end = html.indexOf('id="home-page-strip"');
    expect(html.slice(start, end)).not.toMatch(/<(input|textarea|select)[^>]*\srequired/);
  });
});

describe("§NNN the pairs are the backoffice's one Română | English strip", () => {
  it("draws every pair of boxes as tabs over two panels — the hero's, each step's and reason's, the heading's and the strip's", async () => {
    const html = await draw(DEFAULT_HOME_PAGE_SETTING);
    for (const strip of ["home-hero", "home-steps-head", "home-step-1", "home-steps-foot", "home-why-head", "home-reason-4", "home-why-foot", "home-strip-words"]) {
      expect(html, strip).toContain(`id="${strip}-tab-ro"`);
      expect(html, strip).toContain(`id="${strip}-tab-en"`);
      expect(html, strip).toMatch(new RegExp(`<div[^>]*id="${strip}-panel-en"[^>]*hidden`));
    }
  });

  it("puts each language's boxes in its own panel, the hidden one still in the one form", async () => {
    const html = await draw(DEFAULT_HOME_PAGE_SETTING);
    const panel = (id: string) => {
      const start = html.indexOf(`id="${id}"`);
      return html.slice(start, html.indexOf('role="tabpanel"', start + 1));
    };
    expect(panel("home-hero-panel-ro")).toContain('name="headlineRo"');
    expect(panel("home-hero-panel-ro")).not.toContain('name="headlineEn"');
    expect(panel("home-hero-panel-en")).toContain('name="buttonHowEn"');
    expect(panel("home-step-3-panel-en")).toContain('name="step3TitleEn"');
    // The page «Cum funcționează» opens is one in both languages: under the strip, in no tab.
    expect(html.indexOf('name="buttonHowPageId"')).toBeGreaterThan(html.indexOf('name="buttonHowEn"'));
    const form = html.slice(html.indexOf('data-testid="home-page-form"'), html.indexOf("</form>", html.indexOf('data-testid="home-page-form"')));
    for (const name of ["headlineRo", "headlineEn", "sublineEn", "buttonJoinEn", "stepsTitleEn", "why1BodyEn", "quoteEn", "stripTitleEn"]) expect(form, name).toContain(`name="${name}"`);
  });
});

describe("§732 the special-events-first checkbox", () => {
  it("renders with its saved state, off by default", async () => {
    const off = await draw(DEFAULT_HOME_PAGE_SETTING);
    expect(off).toContain("Evenimentele speciale înaintea alergărilor săptămânale");
    const box = (markup: string) => markup.match(/<input[^>]*name="specialFirst"[^>]*>/)?.[0] ?? "";
    expect(box(off)).toContain('name="specialFirst"');
    expect(box(off)).not.toContain("checked");
    expect(box(await draw({ ...DEFAULT_HOME_PAGE_SETTING, specialFirst: true }))).toContain("checked");
  });
});
