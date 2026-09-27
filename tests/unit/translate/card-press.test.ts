import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TranslateOutcome } from "@/modules/translate/service";
import { cardOf, englishBoxesToTranslate, planTranslateAll, translateBoxes } from "@/modules/translate/ui/form-fields";
import TranslateProvider, { type TranslateAction, type TranslateOffer } from "@/modules/translate/ui/TranslateProvider";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — «Tradu cardul: RO → EN» in a card's Română | English tab row: the whole editor's press
 * (§482), narrowed to one card.
 *
 * - the plan and the press over a card: only the English boxes inside it that post in this form,
 *   their Romanian twins read from the form, the rest of the form untouched and nothing submitted;
 * - the card is the nearest `Panel` (`<details>` / `<section>`) around the strip, else the strip;
 * - the tab row draws the button only on a strip that asks for it, can be typed into and has both
 *   languages, and only where the page offers translation — no key, no role: no button.
 *
 * In Node with stand-ins for the few DOM shapes `form-fields.ts` touches, as `one-press.test.ts`.
 */

class FakeBox extends EventTarget {
  name: string;
  type = "text";
  disabled = false;
  readOnly = false;
  maxLength = -1;
  labels: { textContent: string }[] = [];
  form: FakeForm | null = null;
  current: string;
  constructor(name: string, value: string) {
    super();
    this.name = name;
    this.current = value;
  }
}
class FakeInput extends FakeBox {}
class FakeTextArea extends FakeBox {}
for (const prototype of [FakeInput.prototype, FakeTextArea.prototype]) {
  Object.defineProperty(prototype, "value", {
    configurable: true,
    get(this: FakeBox) {
      return this.current;
    },
    set(this: FakeBox, text: string) {
      this.current = text;
    },
  });
}

class FakeForm {
  submitted = 0;
  readonly elements: FakeBox[] & { namedItem: (name: string) => FakeBox | null };
  constructor(boxes: FakeBox[]) {
    const elements = [...boxes] as FakeBox[] & { namedItem: (name: string) => FakeBox | null };
    elements.namedItem = (name) => boxes.find((box) => box.name === name) ?? null;
    this.elements = elements;
    for (const box of boxes) box.form = this;
  }
  querySelector() {
    return null;
  }
  requestSubmit() {
    this.submitted += 1;
  }
}

/** A card: the boxes the browser would find inside it, in the document's order. */
const cardWith = (boxes: FakeBox[]) => ({ querySelectorAll: () => boxes }) as unknown as ParentNode;
const asForm = (form: FakeForm) => form as unknown as HTMLFormElement;

const saved: Record<string, unknown> = {};
const GLOBALS = ["HTMLInputElement", "HTMLTextAreaElement", "CSS", "document"] as const;
beforeAll(() => {
  for (const key of GLOBALS) saved[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    CSS: { escape: (text: string) => text },
    document: { querySelector: () => null },
  });
});
afterAll(() => {
  for (const key of GLOBALS) (globalThis as Record<string, unknown>)[key] = saved[key];
});

/** The editor: the title card and the SEO card, each a pair; the place's English name outside both. */
function editor() {
  const titleRo = new FakeInput("translations.ro.title", "Crosul Tâmpei");
  const titleEn = new FakeInput("translations.en.title", "");
  const seoRo = new FakeTextArea("translations.ro.seoDescription", "Alergare pe munte.");
  const seoEn = new FakeTextArea("translations.en.seoDescription", "");
  const placeRo = new FakeInput("event.locationName", "Poarta Schei");
  const placeEn = new FakeInput("event.locationNameEn", "");
  const form = new FakeForm([titleRo, titleEn, seoRo, seoEn, placeRo, placeEn]);
  return { form, titleCard: cardWith([titleRo, titleEn]), seoCard: cardWith([seoRo, seoEn]), titleEn, seoEn, placeEn };
}

function fakeAction(answer?: TranslateOutcome) {
  const calls: unknown[] = [];
  const action: TranslateAction = async (input) => {
    calls.push(input);
    if (answer) return answer;
    const { items } = input as { items: { field: string; kind: "text"; text: string }[] };
    return { ok: true, characters: 0, remainingToday: 0, items: items.map((item) => ({ ...item, text: `EN:${item.text}` })) };
  };
  return { action, calls };
}

describe("§NNN «Tradu cardul» reads and fills one card of the form", () => {
  it("lists only the card's English boxes; without a card, the whole form as before", () => {
    const { form, titleCard } = editor();
    expect(englishBoxesToTranslate(asForm(form), titleCard)).toEqual(["translations.en.title"]);
    expect(englishBoxesToTranslate(asForm(form))).toEqual(["translations.en.title", "translations.en.seoDescription", "event.locationNameEn"]);
  });

  it("ignores a box inside the card that posts in another form", () => {
    const { form } = editor();
    const stranger = new FakeInput("translations.en.title", "");
    new FakeForm([new FakeInput("translations.ro.title", "Alt titlu"), stranger]);
    expect(englishBoxesToTranslate(asForm(form), cardWith([stranger]))).toEqual([]);
  });

  it("plans the card's own question: only the card's written English counts as replaced", () => {
    const { form, seoCard, titleEn } = editor();
    titleEn.current = "Tampa Cross";
    const plan = planTranslateAll(asForm(form), seoCard);
    expect(plan.names).toEqual(["translations.en.seoDescription"]);
    expect(plan.replaced).toEqual([]);
  });

  it("fills the card's English boxes in one request, leaves the other cards alone and submits nothing", async () => {
    const { form, titleCard, titleEn, seoEn, placeEn } = editor();
    const { action, calls } = fakeAction();
    const result = await translateBoxes(asForm(form), planTranslateAll(asForm(form), titleCard).names, action);
    expect(result).toEqual({ kind: "done", count: 1, cut: [] });
    expect(calls).toHaveLength(1);
    expect(titleEn.current).toBe("EN:Crosul Tâmpei");
    expect(seoEn.current).toBe("");
    expect(placeEn.current).toBe("");
    expect(form.submitted).toBe(0);
  });

  it("takes the nearest card around the strip, else the strip itself", () => {
    const card = { tag: "details" };
    const strip = { closest: (selector: string) => (selector === "details, section" ? card : null) } as unknown as Element;
    expect(cardOf(strip)).toBe(card);
    const alone = { closest: () => null } as unknown as Element;
    expect(cardOf(alone)).toBe(alone);
  });
});

/** The markup without the `<style>` tags Emotion writes beside each element when rendering on a server. */
const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

function strip(offer: TranslateOffer | null, props: Partial<ComponentProps<typeof LocaleTabPanels>> = {}, messages: typeof ro = ro) {
  const tabs = createElement(LocaleTabPanels, {
    idPrefix: "title",
    panels: [
      { locale: "ro", label: "Română", content: "ro" },
      { locale: "en", label: "English", content: "en" },
    ],
    translateCard: true,
    ...props,
  });
  return markup(
    renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale: messages === ro ? "ro" : "en", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>,
        createElement(TranslateProvider, { offer } as ComponentProps<typeof TranslateProvider>, tabs),
      ),
    ),
  );
}

const WORKING: TranslateOffer = { action: async () => ({ ok: false, reason: "forbidden" }) as TranslateOutcome, setupHref: null };

describe("§NNN the button in the card's tab row", () => {
  it("is drawn where the page translates, in the reader's language", () => {
    const html = strip(WORKING);
    expect(html).toContain('data-testid="translate-card"');
    expect(html).toContain(ro.Translate.card);
    expect(html).toContain("data-locale-tabs");
    expect(strip(WORKING, {}, en as unknown as typeof ro)).toContain(en.Translate.card);
  });

  it("is absent with no key, a spent credit, a role that writes no words, or no provider", () => {
    expect(strip({ action: null, setupHref: "/ro/admin/tasks#task-translation" })).not.toContain("translate-card");
    expect(strip({ action: null, setupHref: null, spent: true })).not.toContain("translate-card");
    expect(strip(null)).not.toContain("translate-card");
  });

  it("is absent on a strip that does not ask for it, cannot be typed into, or lacks a language", () => {
    expect(strip(WORKING, { translateCard: false })).not.toContain("translate-card");
    expect(strip(WORKING, { live: false })).not.toContain("translate-card");
    expect(strip(WORKING, { panels: [{ locale: "ro", label: "Română", content: "ro" }] })).not.toContain("translate-card");
  });

  it("has its words in both catalogues", () => {
    for (const catalogue of [ro, en]) {
      expect(catalogue.Translate.card).toMatch(/RO → EN$/);
      expect(catalogue.Translate.confirm.cardBigTitle.length).toBeGreaterThan(0);
    }
  });
});
