import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { RICH_TEXT_FILL_EVENT, type RichTextFillDetail } from "@/modules/content/rich-text/ui/fill-event";
import { ASK_ABOVE_CHARACTERS, charactersToSend } from "@/modules/translate/domain/budget";
import type { TranslateOutcome } from "@/modules/translate/service";
import {
  collectItems,
  englishBoxesToTranslate,
  englishBoxesWithWords,
  labelOfBox,
  planTranslateAll,
  translateBoxes,
} from "@/modules/translate/ui/form-fields";
import type { TranslateAction } from "@/modules/translate/ui/TranslateProvider";

/**
 * §482 — one press of «Copiază și tradu tot: RO → EN», read and run the way the button runs it.
 *
 * The suite runs in Node, with no browser (and no DOM library: the platform over a dependency), so
 * the few DOM shapes `form-fields.ts` touches are stood in for here — an input and a textarea with
 * the element's own `value` setter on their prototypes, a form's `elements` with `namedItem`, and
 * `window` as the target of the rich-text fill event. What is proven:
 *
 * - the plan: every English box whose Romanian twin has words, in the form's order; the ones that
 *   already hold English (the only reason the press asks); the empty ones «Doar cele goale» fills;
 *   and the characters named before the press, by the service's own count;
 * - the press with a fake action: the empty boxes are filled — a plain box through its value
 *   setter, a rich text through the fill event naming its form — the others untouched, and nothing
 *   is submitted;
 * - «Echipa»: two cards posting the same names — the press reads, fills and labels its own card's.
 */

class FakeBox extends EventTarget {
  name: string;
  type: string;
  disabled = false;
  readOnly = false;
  maxLength = -1;
  labels: { textContent: string }[];
  form: FakeForm | null = null;
  current: string;
  constructor(name: string, value: string, options: { type?: string; label?: string } = {}) {
    super();
    this.name = name;
    this.type = options.type ?? "text";
    this.current = value;
    this.labels = options.label ? [{ textContent: options.label }] : [];
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
  submit() {
    this.submitted += 1;
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
const EMPTY = JSON.stringify({ type: "doc", content: [] });
const rich = (name: string, text: string | null, label?: string) =>
  new FakeInput(name, text === null ? EMPTY : JSON.stringify(doc(text)), { type: "hidden", label });
const asForm = (form: FakeForm) => form as unknown as HTMLFormElement;

/** An event's editor: a filled English title, empty English elsewhere, one pair with no Romanian. */
function eventForm() {
  return new FakeForm([
    new FakeInput("translations.ro.title", "Crosul Tâmpei", { label: "Titlu (RO)" }),
    new FakeInput("translations.en.title", "Tampa Cross", { label: "Title (EN) *" }),
    rich("translations.ro.body", "Traseul urcă pe Tâmpa."),
    rich("translations.en.body", null, "Descriere (EN)"),
    new FakeTextArea("translations.ro.seoDescription", "Alergare pe munte, {eventTitle}."),
    new FakeTextArea("translations.en.seoDescription", "", { label: "SEO (EN)" }),
    new FakeInput("translations.ro.seoTitle", ""),
    new FakeInput("translations.en.seoTitle", ""),
    new FakeInput("event.locationName", "Poarta Schei"),
    new FakeInput("event.locationNameEn", ""),
  ]);
}

/** A fake DeepL: «EN:» before every plain text, a rich text answered as one paragraph. */
function fakeAction(answer?: TranslateOutcome) {
  const calls: unknown[] = [];
  const action: TranslateAction = async (input) => {
    calls.push(input);
    if (answer) return answer;
    const { items } = input as { items: ({ field: string; kind: "text"; text: string } | { field: string; kind: "rich"; doc: RichTextDoc })[] };
    return {
      ok: true,
      characters: 0,
      remainingToday: 0,
      items: items.map((item) => (item.kind === "text" ? { ...item, text: `EN:${item.text}` } : { field: item.field, kind: "rich" as const, doc: doc("EN rich") })),
    };
  };
  return { action, calls };
}

function captureFills() {
  const fills: RichTextFillDetail[] = [];
  const listener = (event: Event) => fills.push((event as CustomEvent<RichTextFillDetail>).detail);
  (globalThis.window as unknown as EventTarget).addEventListener(RICH_TEXT_FILL_EVENT, listener);
  return { fills, stop: () => (globalThis.window as unknown as EventTarget).removeEventListener(RICH_TEXT_FILL_EVENT, listener) };
}

const valueOf = (form: FakeForm, name: string) => form.elements.namedItem(name)?.current;

describe("§482 «Copiază și tradu tot» reads the form before it runs", () => {
  it("lists every English box whose Romanian has words, in the form's order, and the filled ones apart", () => {
    const form = eventForm();
    const names = englishBoxesToTranslate(asForm(form));
    expect(names).toEqual(["translations.en.title", "translations.en.body", "translations.en.seoDescription", "event.locationNameEn"]);
    expect(englishBoxesWithWords(asForm(form), names)).toEqual(["translations.en.title"]);
  });

  it("plans the question: what would be replaced, what «Doar cele goale» fills, and the characters of each", () => {
    const form = eventForm();
    const plan = planTranslateAll(asForm(form));
    expect(plan.replaced).toEqual(["translations.en.title"]);
    expect(plan.empty).toEqual(["translations.en.body", "translations.en.seoDescription", "event.locationNameEn"]);
    expect(plan.characters).toBe(charactersToSend(collectItems(asForm(form), plan.names)));
    expect(plan.emptyCharacters).toBe(charactersToSend(collectItems(asForm(form), plan.empty)));
    expect(plan.emptyCharacters).toBeLessThan(plan.characters);
    expect(plan.characters).toBeLessThanOrEqual(ASK_ABOVE_CHARACTERS);
  });

  it("has nothing to ask on an editor whose English is empty", () => {
    const form = eventForm();
    form.elements.namedItem("translations.en.title")!.current = "";
    expect(planTranslateAll(asForm(form)).replaced).toEqual([]);
  });

  it("names a box by its label, the required mark dropped", () => {
    expect(labelOfBox(asForm(eventForm()), "translations.en.title")).toBe("Title (EN)");
  });

  it("names the characters above the threshold, counted as the service counts them", () => {
    const long = "a".repeat(ASK_ABOVE_CHARACTERS + 1);
    const form = new FakeForm([new FakeInput("translations.ro.title", long), new FakeInput("translations.en.title", "")]);
    expect(planTranslateAll(asForm(form)).characters).toBe(ASK_ABOVE_CHARACTERS + 1);
    // A placeholder travels as its numbered marker; a blank box sends nothing.
    expect(charactersToSend([{ kind: "text", text: "Salut {participantName}" }])).toBe("Salut {0}".length);
    expect(charactersToSend([{ kind: "text", text: "   " }])).toBe(0);
    expect(charactersToSend([{ kind: "rich", doc: doc("Unu") }])).toBeGreaterThanOrEqual("Unu".length);
  });
});

describe("§482 one press fills the English and submits nothing", () => {
  it("«Doar cele goale»: fills the empty boxes, leaves the written title, posts one request", async () => {
    const form = eventForm();
    const { action, calls } = fakeAction();
    const capture = captureFills();
    const plan = planTranslateAll(asForm(form));
    const result = await translateBoxes(asForm(form), plan.empty, action);
    capture.stop();

    expect(calls).toHaveLength(1);
    expect(result).toEqual({ kind: "done", count: 3, cut: [] });
    expect(valueOf(form, "translations.en.title")).toBe("Tampa Cross");
    expect(valueOf(form, "translations.en.seoDescription")).toBe("EN:Alergare pe munte, {eventTitle}.");
    expect(valueOf(form, "event.locationNameEn")).toBe("EN:Poarta Schei");
    // The rich text goes through the editor's fill event, naming the form that pressed.
    expect(capture.fills).toHaveLength(1);
    expect(capture.fills[0]?.name).toBe("translations.en.body");
    expect(capture.fills[0]?.form).toBe(form);
    expect(form.submitted).toBe(0);
  });

  it("«Înlocuiește tot»: the written title is replaced too", async () => {
    const form = eventForm();
    const { action } = fakeAction();
    await translateBoxes(asForm(form), planTranslateAll(asForm(form)).names, action);
    expect(valueOf(form, "translations.en.title")).toBe("EN:Crosul Tâmpei");
    expect(form.submitted).toBe(0);
  });

  it("a refusal (the budget, the month's quota) fills nothing: the provider answers a request whole", async () => {
    const form = eventForm();
    const { action } = fakeAction({ ok: false, reason: "budget", remainingToday: 12 });
    const result = await translateBoxes(asForm(form), planTranslateAll(asForm(form)).names, action);
    expect(result).toEqual({ kind: "refused", reason: "budget", remainingToday: 12 });
    expect(valueOf(form, "translations.en.seoDescription")).toBe("");
    expect(valueOf(form, "translations.en.title")).toBe("Tampa Cross");
  });

  it("says «nothing» and asks nobody when no Romanian box has words", async () => {
    const form = new FakeForm([new FakeInput("translations.ro.title", ""), new FakeInput("translations.en.title", "")]);
    const { action, calls } = fakeAction();
    expect(await translateBoxes(asForm(form), ["translations.en.title"], action)).toEqual({ kind: "nothing" });
    expect(calls).toHaveLength(0);
  });
});

describe("§482 «Echipa»: the press works on its own card", () => {
  function card(role: string, bio: string, roleLabel: string) {
    return new FakeForm([
      new FakeInput("roleRo", role),
      new FakeInput("roleEn", "", { label: roleLabel }),
      rich("bioRoBody", bio),
      rich("bioEnBody", null),
      new FakeInput("links[0].labelRo", "Profil Strava"),
      new FakeInput("links[0].labelEn", "Strava profile"),
    ]);
  }

  it("reads and fills the card that pressed, never the other one", async () => {
    const ana = card("Antrenoare", "Aleargă din 2010.", "Rol (EN) — Ana");
    const dan = card("Voluntar", "Ține masa.", "Rol (EN) — Dan");
    const plan = planTranslateAll(asForm(dan));
    expect(plan.names).toEqual(["roleEn", "bioEnBody", "links[0].labelEn"]);
    expect(plan.replaced).toEqual(["links[0].labelEn"]);
    expect(labelOfBox(asForm(dan), "roleEn")).toBe("Rol (EN) — Dan");

    const { action, calls } = fakeAction();
    const capture = captureFills();
    await translateBoxes(asForm(dan), plan.empty, action);
    capture.stop();

    expect(JSON.stringify(calls[0])).toContain("Voluntar");
    expect(JSON.stringify(calls[0])).not.toContain("Antrenoare");
    expect(valueOf(dan, "roleEn")).toBe("EN:Voluntar");
    expect(valueOf(ana, "roleEn")).toBe("");
    expect(valueOf(dan, "links[0].labelEn")).toBe("Strava profile");
    expect(capture.fills.map((fill) => [fill.name, fill.form])).toEqual([["bioEnBody", dan]]);
  });
});
