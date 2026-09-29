import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { RICH_TEXT_FILL_EVENT, type RichTextFillDetail } from "@/modules/content/rich-text/ui/fill-event";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "@/modules/translate/domain/fields";
import { englishBoxesToTranslate, planTranslateAll, translateBoxes } from "@/modules/translate/ui/form-fields";
import type { TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import { TRANSLATED_EVENT, type TranslatedDetail, translatedInto } from "@/modules/translate/ui/translated-event";
import { twinFoldKey } from "@/shared/ui/fold";
import LocaleTabPanels, { TranslatedTabWord, tabLabel, watchedBoxName } from "@/shared/ui/LocaleTabPanels";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN (amending §482, §524) — «Membri» → «Scrie zona membrilor»: the owner's screenshot of
 * 2026-09-29, «Salutare colegii!» in the Romanian editor, the English empty, and «Copiază și tradu
 * tot» answering «Nu e nimic de tradus: scrie întâi textele în română.»
 *
 * The press reads the form's boxes by name at the moment it is pressed (`form-fields.ts`, the
 * hidden box every rich text posts), and `zoneEnBody` / `benefitsEnBody` were not on the list of
 * English boxes it may fill — so it found none and said there was nothing to translate. Proven here:
 *
 * - the members' two texts are English boxes, rich texts, with their Romanian twin by name;
 * - the screenshot's form: the plan names `zoneEnBody`, and the press fills the English editor
 *   (the fill event, which the editor takes as content) and announces the English it filled;
 * - an empty Romanian editor is still «nimic de tradus»;
 * - the tabs «RO» | «EN»: the flags, the English tab's «gol» while empty and «tradus —
 *   verifică» after a press, the watched names the members' form posts, the folds twinned across
 *   the tabs, and only the strip holding the filled box answering the press.
 *
 * In Node with stand-ins for the few DOM shapes the press touches, as `one-press.test.ts`.
 */

class FakeInput extends EventTarget {
  name: string;
  type = "hidden";
  disabled = false;
  readOnly = true;
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
Object.defineProperty(FakeInput.prototype, "value", {
  configurable: true,
  get(this: FakeInput) {
    return this.current;
  },
  set(this: FakeInput, text: string) {
    this.current = text;
  },
});
class FakeTextArea extends FakeInput {}

class FakeForm {
  readonly elements: FakeInput[] & { namedItem: (name: string) => FakeInput | null };
  constructor(boxes: FakeInput[]) {
    const elements = [...boxes] as FakeInput[] & { namedItem: (name: string) => FakeInput | null };
    elements.namedItem = (name) => boxes.find((box) => box.name === name) ?? null;
    this.elements = elements;
    for (const box of boxes) box.form = this;
  }
  querySelector() {
    return null;
  }
}

const saved: Record<string, unknown> = {};
const GLOBALS = ["HTMLInputElement", "HTMLTextAreaElement", "CSS", "document", "window"] as const;
beforeAll(() => {
  for (const key of GLOBALS) saved[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    CSS: { escape: (text: string) => text },
    document: { querySelector: () => null },
    window: new EventTarget(),
  });
});
afterAll(() => {
  for (const key of GLOBALS) (globalThis as Record<string, unknown>)[key] = saved[key];
});

const doc = (text: string): RichTextDoc =>
  ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }) as RichTextDoc;
// What an editor nobody typed into posts (`RichTextEditor`'s hidden box).
const EMPTY = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
const asForm = (form: FakeForm) => form as unknown as HTMLFormElement;

/** The members' zone form as the screenshot had it: «Salutare colegii!» in Romanian, the English empty. */
function zoneForm(romanian: string | null = "Salutare colegii!") {
  return new FakeForm([
    new FakeInput("uiLocale", "ro"),
    new FakeInput("text", "zone"),
    new FakeInput("zoneRoBody", romanian === null ? EMPTY : JSON.stringify(doc(romanian))),
    new FakeInput("zoneEnBody", EMPTY),
  ]);
}

function fakeAction() {
  const calls: unknown[] = [];
  const action: TranslateAction = async (input) => {
    calls.push(input);
    const { items } = input as { items: { field: string; kind: "rich"; doc: RichTextDoc }[] };
    return { ok: true, characters: 0, remainingToday: 0, items: items.map((item) => ({ field: item.field, kind: "rich" as const, doc: doc("Hello, colleagues!") })) };
  };
  return { action, calls };
}

function capture<T>(type: string) {
  const seen: T[] = [];
  const listener = (event: Event) => seen.push((event as CustomEvent<T>).detail);
  const target = globalThis.window as unknown as EventTarget;
  target.addEventListener(type, listener);
  return { seen, stop: () => target.removeEventListener(type, listener) };
}

describe("§NNN «Copiază și tradu tot» on «Membri»", () => {
  it("knows the members' two texts as English rich texts with a Romanian twin", () => {
    for (const text of ["zone", "benefits"]) {
      expect(isTranslatableEnglishField(`${text}EnBody`), text).toBe(true);
      expect(isRichTextField(`${text}EnBody`), text).toBe(true);
      expect(romanianTwinCandidates(`${text}EnBody`), text).toEqual([`${text}RoBody`]);
    }
    // The Romanian box is never one the press fills.
    expect(isTranslatableEnglishField("zoneRoBody")).toBe(false);
  });

  it("the screenshot: Romanian written, English empty — the press has the English box to fill", () => {
    const form = zoneForm();
    expect(englishBoxesToTranslate(asForm(form))).toEqual(["zoneEnBody"]);
    const plan = planTranslateAll(asForm(form));
    expect(plan.names).toEqual(["zoneEnBody"]);
    expect(plan.empty).toEqual(["zoneEnBody"]);
    expect(plan.characters).toBeGreaterThanOrEqual("Salutare colegii!".length);
  });

  it("reads the Romanian as it is at the press, not as the page was loaded", () => {
    const form = zoneForm(null);
    expect(planTranslateAll(asForm(form)).names).toEqual([]);
    // Typed after the page loaded: the editor's hidden box moves, and the next press reads it.
    form.elements.namedItem("zoneRoBody")!.current = JSON.stringify(doc("Salutare colegii!"));
    expect(planTranslateAll(asForm(form)).names).toEqual(["zoneEnBody"]);
  });

  it("fills the English editor with the translation and tells the tabs which box it filled", async () => {
    const form = zoneForm();
    const { action, calls } = fakeAction();
    const fills = capture<RichTextFillDetail>(RICH_TEXT_FILL_EVENT);
    const announced = capture<TranslatedDetail>(TRANSLATED_EVENT);
    const result = await translateBoxes(asForm(form), planTranslateAll(asForm(form)).names, action);
    fills.stop();
    announced.stop();

    expect(calls).toEqual([{ items: [{ field: "zoneEnBody", kind: "rich", doc: doc("Salutare colegii!") }] }]);
    expect(result).toEqual({ kind: "done", count: 1, cut: [] });
    // The editor takes the document as content (`RichTextEditor`, `LazyRichTextEditor`), in this form only.
    expect(fills.seen).toEqual([{ name: "zoneEnBody", doc: doc("Hello, colleagues!"), form }]);
    expect(announced.seen).toEqual([{ names: ["zoneEnBody"], form }]);
  });

  it("announces only the boxes it filled: an answer for a box the form lacks moves no tab", async () => {
    const form = zoneForm();
    const action: TranslateAction = async () => ({
      ok: true,
      characters: 0,
      remainingToday: 0,
      items: [
        { field: "zoneEnBody", kind: "rich" as const, doc: doc("Hello, colleagues!") },
        // «Beneficiile» is another form: no box of that name here, so nothing is filled or announced.
        { field: "benefitsEnBody", kind: "rich" as const, doc: doc("Benefits") },
        { field: "translations.en.title", kind: "text" as const, text: "Title" },
      ],
    });
    const fills = capture<RichTextFillDetail>(RICH_TEXT_FILL_EVENT);
    const announced = capture<TranslatedDetail>(TRANSLATED_EVENT);
    await translateBoxes(asForm(form), ["zoneEnBody"], action);
    fills.stop();
    announced.stop();
    expect(fills.seen.map((fill) => fill.name)).toEqual(["zoneEnBody"]);
    expect(announced.seen).toEqual([{ names: ["zoneEnBody"], form }]);
  });

  it("an empty Romanian editor is still nothing to translate, and nothing is asked", async () => {
    const form = zoneForm(null);
    const { action, calls } = fakeAction();
    expect(await translateBoxes(asForm(form), englishBoxesToTranslate(asForm(form)), action)).toEqual({ kind: "nothing" });
    expect(calls).toEqual([]);
  });
});

describe("§NNN the tabs «RO» | «EN» of a bilingual text", () => {
  const panels = (enWritten: boolean) => [
    { locale: "ro", label: "RO", content: createElement("input", { type: "hidden", name: "zoneRoBody", value: "{}", readOnly: true }) },
    {
      locale: "en",
      label: "EN",
      incompleteLabel: enWritten ? undefined : ro.Admin.members.tabEmpty,
      content: createElement("input", { type: "hidden", name: "zoneEnBody", value: "{}", readOnly: true }),
    },
  ];
  const strip = (enWritten: boolean) =>
    renderToStaticMarkup(
      createElement(LocaleTabPanels, {
        idPrefix: "members-zone",
        watch: { names: ["zone{Locale}Body"], rule: "required" },
        markLabel: ro.Admin.members.tabEmpty,
        panels: panels(enWritten),
      }),
    );
  const tab = (html: string, locale: string) => new RegExp(`<button[^>]*id="members-zone-tab-${locale}"[^>]*>([\\s\\S]*?)</button>`).exec(html)?.[0] ?? "";

  it("draws one tab per language with the header's flag beside the code, the Romanian on top", () => {
    const html = strip(true);
    expect(tab(html, "ro")).toContain('src="/flags/ro.svg"');
    expect(tab(html, "en")).toContain('src="/flags/gb.svg"');
    // The flag is never the label: the code is.
    expect(tab(html, "ro")).toContain('alt=""');
    expect(tab(html, "ro")).toContain(">RO<");
    expect(tab(html, "en")).toContain(">EN<");
    expect(html).toMatch(/id="members-zone-panel-en"[^>]*hidden/);
    expect(html).not.toMatch(/id="members-zone-panel-ro"[^>]*hidden/);
    // Both editors' boxes are in the page, so the save posts both languages (§352).
    expect(html).toContain('name="zoneRoBody"');
    expect(html).toContain('name="zoneEnBody"');
  });

  it("marks the English tab «gol» while the English is empty — short, so «RO · gol» | «EN · gol» fits at 320 px", () => {
    expect(tab(strip(false), "en")).toContain(`EN · ${ro.Admin.members.tabEmpty}`);
    expect(tab(strip(true), "en")).not.toContain(ro.Admin.members.tabEmpty);
  });

  it("says each mark in both languages, «tradus — verifică» after a press", () => {
    expect(ro.Admin.members.tabEmpty).toBe("gol");
    expect(en.Admin.members.tabEmpty).toBe("empty");
    // The translated mark is the strip's own, one word for every strip (the event editor, a page, the FAQ…).
    expect(ro.Translate.tabTranslated).toBe("tradus — verifică");
    expect(en.Translate.tabTranslated).toBe("translated — check it");
    expect("tabTranslated" in ro.Admin.members).toBe(false);
    expect(tabLabel(["EN", null, false, ro.Translate.tabTranslated])).toBe("EN · tradus — verifică");
    expect(tabLabel(["EN", ro.Admin.members.tabEmpty])).toBe("EN · gol");
  });

  it("draws «tradus — verifică» from the catalogue on a strip given no word of its own", () => {
    // The provider's props with `children` optional, so the child goes in as `createElement`'s third argument.
    const Provider = NextIntlClientProvider as unknown as (props: { locale: string; messages: object; children?: ReactNode }) => ReactNode;
    for (const [locale, messages] of [["ro", ro], ["en", en]] as const) {
      const html = renderToStaticMarkup(
        createElement(Provider, { locale, messages: { Translate: messages.Translate } }, createElement(TranslatedTabWord)),
      );
      expect(html).toBe(messages.Translate.tabTranslated);
    }
  });

  it("watches the names the members' form posts, and the event editor's as before", () => {
    expect(watchedBoxName("zone{Locale}Body", "ro")).toBe("zoneRoBody");
    expect(watchedBoxName("zone{Locale}Body", "en")).toBe("zoneEnBody");
    expect(watchedBoxName("title", "en")).toBe("translations.en.title");
  });

  it("twins the Romanian and English folds of a `…RoBody` / `…EnBody` pair", () => {
    expect(twinFoldKey("zoneRoBody", "ro")).toBe(twinFoldKey("zoneEnBody", "en"));
    expect(twinFoldKey("benefitsRoBody", "ro")).toBe("benefits*Body");
    expect(twinFoldKey("faq[2].answerEnBody", "en")).toBe("faq[2].answer*Body");
    // A name without the language keeps its own key.
    expect(twinFoldKey("zoneEnBody", "ro")).toBe("zoneEnBody");
    expect(twinFoldKey("translations.en.body", "en")).toBe("translations.*.body");
  });

  it("brings the English forward only in the strip whose English panel holds a filled box, in the pressing form", () => {
    const form = {} as HTMLFormElement;
    const other = {} as HTMLFormElement;
    const panel = (names: string[], owner: HTMLFormElement | null) => (name: string) => (names.includes(name) ? { form: owner } : null);
    expect(translatedInto({ names: ["zoneEnBody"], form }, panel(["zoneEnBody"], form))).toBe(true);
    // «Beneficiile» is its own form and strip: the zone's press does not move it.
    expect(translatedInto({ names: ["zoneEnBody"], form }, panel(["benefitsEnBody"], other))).toBe(false);
    // «Echipa»: the same name in another card's form.
    expect(translatedInto({ names: ["bioEnBody"], form }, panel(["bioEnBody"], other))).toBe(false);
    expect(translatedInto({ names: [], form }, panel(["zoneEnBody"], form))).toBe(false);
    expect(translatedInto(null, panel(["zoneEnBody"], form))).toBe(false);
  });
});
