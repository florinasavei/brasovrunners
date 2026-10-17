import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boxNamed, translateBoxes } from "@/modules/translate/ui/form-fields";
import type { TranslateAction } from "@/modules/translate/ui/TranslateProvider";

/**
 * §757 — a press of «Tradu din română» under a checkpoint's English box. The checkpoints card's boxes post in detached forms
 * (`checkpoints-form`, `checkpoints-gpx-form`), so the form the button stands in (the editor's own) owns none of them: the press
 * finds each box by its name on the page, and the preview's `gp[n]` and the list's `cp[n]` are two different boxes.
 *
 * In Node with stand-ins for the few DOM shapes `form-fields.ts` touches, as `one-press.test.ts`.
 */

class FakeBox extends EventTarget {
  type = "text";
  disabled = false;
  readOnly = false;
  maxLength = -1;
  labels: { textContent: string }[] = [];
  form: unknown = null;
  current: string;
  constructor(
    readonly name: string,
    value: string,
  ) {
    super();
    this.current = value;
  }
  closest() {
    return null;
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

/** The page: every box on it by name, and the editor's form, which owns none of them. */
const page: FakeBox[] = [];
const editorForm = { elements: Object.assign([] as FakeBox[], { namedItem: () => null }), querySelector: () => null } as unknown as HTMLFormElement;

const saved: Record<string, unknown> = {};
const GLOBALS = ["HTMLInputElement", "HTMLTextAreaElement", "CSS", "document", "window"] as const;
beforeAll(() => {
  for (const key of GLOBALS) saved[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    CSS: { escape: (text: string) => text },
    document: { querySelector: (selector: string) => page.find((box) => selector === `[name="${box.name}"]`) ?? null },
    window: new EventTarget(),
  });
});
afterAll(() => {
  for (const key of GLOBALS) (globalThis as Record<string, unknown>)[key] = saved[key];
});

const echo: TranslateAction = async (input) => {
  const { items } = input as { items: { field: string; kind: "text"; text: string }[] };
  return { ok: true, characters: 0, remainingToday: 0, items: items.map((item) => ({ ...item, text: `EN:${item.text}` })) };
};

describe("§757 the press under a checkpoint's English box, from a form that does not own it", () => {
  it("finds the box by name on the page and fills the one beside its own Romanian twin, the list's row apart from the preview's", async () => {
    page.length = 0;
    page.push(
      new FakeInput("cp[0].nameRo", "Punctul din listă"),
      new FakeInput("cp[0].nameEn", ""),
      new FakeInput("gp[0].nameRo", "Izvor"),
      new FakeInput("gp[0].nameEn", ""),
      new FakeTextArea("cp[0].noteRo", "Apă la izvor"),
      new FakeTextArea("cp[0].noteEn", ""),
    );
    expect(boxNamed(editorForm, "gp[0].nameEn")?.name).toBe("gp[0].nameEn");

    const result = await translateBoxes(editorForm, ["gp[0].nameEn"], echo);
    expect(result).toMatchObject({ kind: "done", count: 1 });
    const value = (name: string) => page.find((box) => box.name === name)!.current;
    expect(value("gp[0].nameEn")).toBe("EN:Izvor");
    // Nothing else was touched.
    expect(value("cp[0].nameEn")).toBe("");
    expect(value("cp[0].noteEn")).toBe("");

    await translateBoxes(editorForm, ["cp[0].noteEn"], echo);
    expect(value("cp[0].noteEn")).toBe("EN:Apă la izvor");
    expect(value("cp[0].nameEn")).toBe("");
  });
});
