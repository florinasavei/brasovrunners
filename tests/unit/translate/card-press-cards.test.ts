import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countForm } from "@/i18n/count-form";
import { isRichTextField, isTranslatableEnglishField } from "@/modules/translate/domain/fields";
import { cardTitleOf, englishBoxesToTranslate } from "@/modules/translate/ui/form-fields";
import { afterPress } from "@/modules/translate/ui/use-translate-all";
import { type PressWords, pressFeedback, translatedAllNotice, translatedCardNotice } from "@/modules/translate/ui/use-translate-press";
import { LONG_TOAST_AUTO_HIDE_MS } from "@/shared/feedback/notice";
import { englishPanelIndex } from "@/shared/ui/LocaleTabPanels";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §514 — «Tradu cardul: RO → EN», the parts `card-press.test.ts` does not hold:
 *
 * - the toast names the card — «Gata: 3 câmpuri traduse în „Descrierea completă”» — counted
 *   through `countForm` (§341), in both catalogues, and the card's name is its Panel's heading
 *   without the closed line;
 * - after a press that filled something, the English tab is brought forward;
 * - per real card of the event editor, read from the source that draws it: the press plans every
 *   English box of the card that is the club's words and nothing outside the card;
 * - every translatable tab row carries the button: the event editor's cards, a standing page, an
 *   album; «Echipa» has no tab row, and its own per-card button is the whole form's.
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
Object.defineProperty(FakeInput.prototype, "value", {
  configurable: true,
  get(this: FakeBox) {
    return this.current;
  },
  set(this: FakeBox, text: string) {
    this.current = text;
  },
});

class FakeForm {
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
}

const cardWith = (boxes: FakeBox[]) => ({ querySelectorAll: () => boxes }) as unknown as ParentNode;
const asForm = (form: FakeForm) => form as unknown as HTMLFormElement;

const saved: Record<string, unknown> = {};
const GLOBALS = ["HTMLInputElement", "HTMLTextAreaElement", "CSS", "document"] as const;
beforeAll(() => {
  for (const key of GLOBALS) saved[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: class {},
    CSS: { escape: (text: string) => text },
    document: { querySelector: () => null },
  });
});
afterAll(() => {
  for (const key of GLOBALS) (globalThis as Record<string, unknown>)[key] = saved[key];
});

/** A toast's sentence as the provider draws it: the three counted keys through `countForm`. */
function toastSentence(locale: "ro" | "en", key: string, values: Record<string, string>): string {
  const t = createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Feedback" });
  return t(`toast.${key}.${countForm(Number(values.count), locale)}` as never, values as never) as string;
}

function words(locale: "ro" | "en"): PressWords {
  const t = createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: "Translate" });
  return (key, values) => t(key as never, values as never) as string;
}

describe("§514 the card's press says what it did, naming the card", () => {
  it("toasts «Gata: 3 câmpuri traduse în „Descrierea completă”» — counted, both languages, 8 s", () => {
    const feedback = pressFeedback({ kind: "done", count: 3, cut: [] }, true, words("ro"), "ro", "Descrierea completă");
    expect(feedback.notice).toEqual(translatedCardNotice(3, [], "Descrierea completă"));
    expect(feedback.notice).toEqual({
      kind: "success",
      key: "translatedCard",
      values: { count: "3", card: "Descrierea completă" },
      autoHideMs: LONG_TOAST_AUTO_HIDE_MS,
    });
    expect(toastSentence("ro", "translatedCard", { count: "3", card: "Descrierea completă" })).toMatch(/^Gata: 3 câmpuri traduse în „Descrierea completă”\./);
    expect(toastSentence("ro", "translatedCard", { count: "1", card: "Traseul" })).toMatch(/^Gata: 1 câmp tradus în „Traseul”\./);
    expect(toastSentence("ro", "translatedCard", { count: "20", card: "Traseul" })).toMatch(/^Gata: 20 de câmpuri traduse în „Traseul”\./);
    expect(toastSentence("en", "translatedCard", { count: "3", card: "Full description" })).toMatch(/^Done: 3 boxes translated in “Full description”\./);
  });

  it("says a text was cut in its own wording, still naming the card", () => {
    const feedback = pressFeedback({ kind: "done", count: 2, cut: ["Rules"] }, true, words("en"), "en", "Rules");
    expect(feedback.notice).toMatchObject({ key: "translatedCardCut", values: { count: "2", card: "Rules" } });
    expect(toastSentence("en", "translatedCardCut", { count: "2", card: "Rules" })).toContain("cut at their box's limit");
    expect(toastSentence("ro", "translatedCardCut", { count: "2", card: "Regulament" })).toContain("„Regulament”");
  });

  it("without a card's name (a strip in no card), says the whole editor's sentence", () => {
    expect(pressFeedback({ kind: "done", count: 3, cut: [] }, true, words("ro"), "ro", null).notice).toEqual(translatedAllNotice(3, []));
  });

  it("has the counted keys in both catalogues, the same three forms, each with the count and the card", () => {
    for (const catalogue of [ro, en]) {
      const toast = catalogue.Feedback.toast as unknown as Record<string, Record<string, string>>;
      for (const key of ["translatedCard", "translatedCardCut"]) {
        expect(Object.keys(toast[key] ?? {}).sort()).toEqual(["few", "one", "other"]);
        for (const form of Object.values(toast[key] ?? {})) {
          expect(form).toContain("{count}");
          expect(form).toContain("{card}");
        }
      }
    }
  });
});

describe("§514 after the press, the English tab is on top", () => {
  it("brings the English panel forward only when boxes were filled", () => {
    let shown = 0;
    const show = () => {
      shown += 1;
    };
    afterPress({ kind: "done" }, show);
    expect(shown).toBe(1);
    for (const result of [{ kind: "nothing" }, { kind: "refused" }, { kind: "failed" }, null]) afterPress(result, show);
    expect(shown).toBe(1);
  });

  it("finds the English panel in the strip, whatever its place", () => {
    expect(englishPanelIndex([{ locale: "ro" }, { locale: "en" }])).toBe(1);
    expect(englishPanelIndex([{ locale: "en" }, { locale: "ro" }])).toBe(0);
    expect(englishPanelIndex([{ locale: "ro" }])).toBe(-1);
  });

  it("is wired: the strip hands the button the swap to English, by hand and in state", () => {
    const strip = source("src/shared/ui/LocaleTabPanels.tsx");
    expect(strip).toContain("<TranslateCardButton onTranslated={() => showEnglish()} />");
    expect(strip).toMatch(/const showEnglish = \(\) => \{[\s\S]{0,200}showOnly\(panelRefs\.current, index\);\s+setActive\(index\);/);
    expect(source("src/modules/translate/ui/TranslateCardButton.tsx")).toMatch(/t\("confirm\.cardBigTitle"\),\s+onTranslated,/);
  });
});

describe("§514 the card's name is its Panel's heading, without the closed line", () => {
  const text = (value: string) => ({ nodeType: 3, textContent: value });
  const element = (value: string) => ({ nodeType: 1, textContent: value });
  const card = (tagName: string, heading: unknown) =>
    ({
      tagName,
      querySelector: (selector: string) => (selector.includes(tagName === "DETAILS" ? "summary" : ":scope > h2") ? heading : null),
    }) as unknown as Element;

  it("reads a fold's heading inside its summary, leaving the aside out", () => {
    const heading = { childNodes: [text("Descrierea completă"), element("RO: completat · EN: gol")] };
    expect(cardTitleOf(card("DETAILS", heading))).toBe("Descrierea completă");
  });

  it("reads an open section's heading", () => {
    expect(cardTitleOf(card("SECTION", { childNodes: [text(" Titlu și rezumat ")] }))).toBe("Titlu și rezumat");
  });

  it("is null for a strip in no card, or a heading with no words of its own", () => {
    expect(cardTitleOf({ tagName: "DIV", querySelector: () => null } as unknown as Element)).toBeNull();
    expect(cardTitleOf(card("DETAILS", { childNodes: [element("x")] }))).toBeNull();
  });

  it("matches what Panel draws: the title as the heading's own text, the aside a span inside it", () => {
    const panel = source("src/shared/ui/Panel.tsx");
    expect(panel).toMatch(/const heading = \(\s*<>\s*\{title\}\s*\{aside \? \(\s*<Typography component="span"/);
    expect(panel).toContain('<Box component="summary">');
    expect(panel).toContain('<Box component="section"');
  });
});

/*
  The real cards, read from their source (as `programme-notes.test.ts` and `editor-order.test.ts`
  do): which boxes each card of the event editor posts, so the press is checked over the boxes the
  editor really draws, not boxes made up for the test.
*/
function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

/** The `translations.<locale>.x` names one `TranslationFields` piece posts, each once. */
function piecePosts(piece: string): string[] {
  const fields = source("src/modules/content/events/ui/TranslationFields.tsx");
  const start = fields.indexOf(`export async function ${piece}(`);
  if (start < 0) throw new Error(`${piece} is not in TranslationFields.tsx`);
  const end = fields.indexOf("\nexport ", start + 1);
  const body = fields.slice(start, end < 0 ? undefined : end);
  return [...new Set([...body.matchAll(/name\("(\w+)"\)/g)].map((match) => match[1] as string))];
}

/** Each card kind: its strip's piece, the rows it holds outside its tabs, and what its press must plan. */
const CARDS: readonly { card: string; piece: string; rows: readonly string[]; expected: readonly string[] }[] = [
  { card: "Titlu și rezumat", piece: "TitleSummaryFields", rows: [], expected: ["translations.en.title", "translations.en.excerptBody"] },
  { card: "Descrierea completă", piece: "DescriptionFields", rows: [], expected: ["translations.en.body"] },
  { card: "Regulament", piece: "RulesFields", rows: [], expected: ["translations.en.rules"] },
  { card: "Traseul", piece: "RouteDescriptionFields", rows: [], expected: ["translations.en.routeDescription"] },
  {
    card: "Programul zilei",
    piece: "ProgrammeTextFields",
    // The timed rows (`ScheduleRowsEditor`), in the same card above the tabs: each row's English words.
    rows: ["event.schedule[0]", "event.schedule[1]"],
    expected: ["event.schedule[0].en", "event.schedule[1].en", "translations.en.schedule", "translations.en.checklist"],
  },
  { card: "Adresa paginii", piece: "AddressFields", rows: [], expected: ["translations.en.seoTitle", "translations.en.seoDescription"] },
  { card: "Cost", piece: "DiscountNoteFields", rows: [], expected: ["translations.en.discountNote"] },
];

/** The whole editor as one form: every card's Romanian written, every English box empty. */
function realEditor() {
  const cards = CARDS.map((kind) => {
    const boxes: FakeBox[] = [];
    for (const row of kind.rows) {
      boxes.push(new FakeInput(`${row}.time`, "09:00"), new FakeInput(`${row}.ro`, "Start"), new FakeInput(`${row}.en`, ""), new FakeInput(`${row}.place`, "Tâmpa"));
    }
    for (const field of piecePosts(kind.piece)) {
      // A rich text posts its Tiptap document as JSON in a hidden box; a plain box its words.
      const rich = isRichTextField(`translations.en.${field}`);
      const written = rich ? JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Text ${field}` }] }] }) : `Text ${field}`;
      const empty = rich ? JSON.stringify({ type: "doc", content: [] }) : "";
      boxes.push(new FakeInput(`translations.ro.${field}`, written), new FakeInput(`translations.en.${field}`, empty));
    }
    return { kind, boxes };
  });
  // The meeting place, in «Când și unde», a card with no language tabs (below).
  const place = [new FakeInput("event.locationName", "Poarta Schei"), new FakeInput("event.locationNameEn", "")];
  return { form: new FakeForm([...cards.flatMap((entry) => entry.boxes), ...place]), cards };
}

describe("§514 each real card's press: every English box of the card, nothing outside it", () => {
  for (const kind of CARDS) {
    it(`«${kind.card}» (${kind.piece})`, () => {
      const { form, cards } = realEditor();
      const entry = cards.find((candidate) => candidate.kind === kind);
      if (!entry) throw new Error(kind.card);
      const planned = englishBoxesToTranslate(asForm(form), cardWith(entry.boxes)).sort();
      // Every English box the card draws that is the club's words — none left out…
      const englishInCard = entry.boxes.map((box) => box.name).filter((name) => name.startsWith("translations.en.") || name.endsWith(".en"));
      expect(planned).toEqual(englishInCard.filter(isTranslatableEnglishField).sort());
      expect(planned).toEqual([...kind.expected].sort());
      // …and nothing of another card, nor the meeting place.
      const others = cards.filter((candidate) => candidate !== entry).flatMap((candidate) => candidate.boxes.map((box) => box.name));
      expect(planned.filter((name) => others.includes(name))).toEqual([]);
      expect(planned).not.toContain("event.locationNameEn");
    });
  }

  it("the address card's page address is an address, not words: never planned", () => {
    expect(piecePosts("AddressFields")).toContain("slug");
    expect(isTranslatableEnglishField("translations.en.slug")).toBe(false);
  });

  it("the programme's rows sit in the programme card itself, not in its help fold", () => {
    const box = source("src/modules/content/events/ui/boxes/ProgrammeBox.tsx");
    const help = box.indexOf('variant="help"');
    expect(help).toBeGreaterThan(-1);
    expect(box.indexOf("</Panel>", help)).toBeLessThan(box.indexOf("<ScheduleRowsEditor"));
    expect(box.indexOf("<ScheduleRowsEditor")).toBeLessThan(box.indexOf("<LanguageTabs"));
    expect(source("src/modules/content/events/ui/ScheduleRowsEditor.tsx")).toContain("`event.schedule[${index}].${box}`");
  });

  it("the meeting place has no tab row, so no card press: its own «Tradu din română» stays (§464)", () => {
    const when = source("src/modules/content/events/ui/boxes/WhenBox.tsx");
    expect(when).not.toContain("LanguageTabs");
    expect(when).not.toContain("LocaleTabPanels");
    expect(source("src/modules/content/events/ui/PlaceToBeAnnounced.tsx")).toContain("<TranslateFieldButton en={EN_NAME} />");
  });
});

describe("§514 every translatable tab row carries the card's button", () => {
  it("the event editor's cards, the discount note, a standing page and an album", () => {
    expect(source("src/modules/content/events/ui/boxes/TextBoxes.tsx")).toMatch(/<LocaleTabPanels[\s\S]{0,700}\n\s+translateCard\r?\n/);
    expect(source("src/modules/content/events/ui/boxes/CostBox.tsx")).toMatch(/<LocaleTabPanels\s+idPrefix="discount-note"\s+translateCard/);
    for (const file of ["src/modules/content/pages/ui/PageFieldsForm.tsx", "src/modules/content/gallery/ui/AlbumFieldsForm.tsx"]) {
      expect(source(file), file).toMatch(/<LocaleTabPanels\s+idPrefix="locale"[\s\S]{0,200}translateCard\r?\n/);
    }
  });

  it("«Echipa»'s cards have no tab row: each card is its own form, and its button translates that card alone (§482)", () => {
    const team = source("src/app/[locale]/admin/pages/team/page.tsx");
    expect(team).not.toContain("LocaleTabPanels");
    const fields = team.slice(team.indexOf("function MemberFields("));
    expect(fields).toContain("<TranslateAllButton />");
  });
});
