import { readFileSync } from "node:fs";
import path from "node:path";
import { Maskito, maskitoTransform, type MaskitoPreprocessor } from "@maskito/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import BirthDateField from "@/modules/registrations/ui/BirthDateField";
import {
  birthDateMaskOptions,
  dotAfterWholePartPostprocessor,
  dotTakesDigitPreprocessor,
  postedShapePreprocessor,
} from "@/modules/registrations/ui/birth-date-mask";
import { fieldId } from "@/shared/forms/outcome";
import { readTypedDate } from "@/shared/forms/pickers/wall-values";

/**
 * §578 (amending §561) — the owner, 2026-09-30: «la ziua nașterii ar trebui să am input mask, în
 * timp ce scriu data nașterii», and then «we need libraries for this, for the mask». The
 * birth-date box takes digits and puts the dots in itself, through Maskito's date mask with three
 * preprocessors and two postprocessors of ours. BR-REQ-031-04 (the form's fields).
 *
 * Maskito works from `beforeinput` and `input`. The tests run in Node with no DOM, so the
 * keystrokes go through Maskito itself on a stand-in input (an `EventTarget` with a value and a
 * selection) that does what a browser does between the two events; a real browser does the same
 * in `tests/e2e/registration-form.spec.ts`. Here too: what the mask does with a whole text
 * (autofill, `maskitoTransform`), and what each piece of ours decides.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const state = (value: string, from = value.length, to = from) => ({ value, selection: [from, to] as const });
const run = (processor: MaskitoPreprocessor, value: string, selection: [number, number], data: string, action: Parameters<MaskitoPreprocessor>[1]) =>
  processor({ elementState: { value, selection }, data }, action);

describe("§578 a whole text in the box — autofill, a value set before the mask — is shown in the mask", () => {
  for (const [whole, shown] of [
    ["1990-05-11", "11.05.1990"],
    ["1990-5-1", "01.05.1990"],
    ["11051990", "11.05.1990"],
    ["11.05.1990", "11.05.1990"],
    ["11.05.1990x", "11.05.1990"],
    ["1105199012", "11.05.1990"],
  ] as const) {
    it(`«${whole}» is «${shown}»`, () => {
      expect(maskitoTransform(whole, birthDateMaskOptions)).toBe(shown);
      expect(readTypedDate(shown)).toBe(readTypedDate(whole) || readTypedDate(shown));
    });
  }

  it("a date that does not exist stays as typed, never another day: the box's check calls it no date", () => {
    expect(maskitoTransform("29.02.2001", birthDateMaskOptions)).toBe("29.02.2001");
    expect(maskitoTransform("31.04.1990", birthDateMaskOptions)).toBe("31.04.1990");
    expect(readTypedDate("29.02.2001")).toBe("");
    expect(maskitoTransform("29.02.2000", birthDateMaskOptions)).toBe("29.02.2000");
  });

  it("no min or max goes to the kit: a too-young date is not moved to the youngest allowed", () => {
    const young = `11.05.${new Date().getFullYear() - 3}`;
    expect(maskitoTransform(young, birthDateMaskOptions)).toBe(young);
  });
});

/** Node has `Event` but no `InputEvent`, which Maskito reads and sends. */
class StandInInputEvent extends Event {
  readonly inputType: string;
  readonly data: string | null;
  constructor(type: string, init: EventInit & { inputType?: string; data?: string | null } = {}) {
    super(type, init);
    this.inputType = init.inputType ?? "";
    this.data = init.data ?? null;
  }
}

/** As much of an `<input>` as Maskito touches, focused. */
class StandInBox extends EventTarget {
  value = "";
  selectionStart = 0;
  selectionEnd = 0;
  readonly nodeName = "INPUT";
  readonly isContentEditable = false;
  readonly maxLength = -1;
  matches() {
    return true;
  }
  setSelectionRange(from: number, to: number) {
    this.selectionStart = from;
    this.selectionEnd = to;
  }
  /** What the browser does: `beforeinput`, then — unless Maskito refused it — the edit and `input`. */
  private edit(inputType: string, data: string | null, apply: () => void) {
    const before = new StandInInputEvent("beforeinput", { inputType, data, cancelable: true });
    this.dispatchEvent(before);
    if (before.defaultPrevented) return;
    apply();
    this.dispatchEvent(new StandInInputEvent("input", { inputType, data }));
  }
  insert(data: string, inputType = "insertText") {
    this.edit(inputType, data, () => {
      this.value = this.value.slice(0, this.selectionStart) + data + this.value.slice(this.selectionEnd);
      this.selectionStart = this.selectionEnd = this.selectionStart + data.length;
    });
  }
  type(keys: string) {
    for (const key of keys) this.insert(key);
  }
  paste(text: string) {
    this.setSelectionRange(0, this.value.length);
    this.insert(text, "insertFromPaste");
  }
  press(key: "Backspace" | "Delete") {
    const forward = key === "Delete";
    this.edit(forward ? "deleteContentForward" : "deleteContentBackward", null, () => {
      let [from, to] = [this.selectionStart, this.selectionEnd];
      if (from === to) {
        if (forward) to += 1;
        else from = Math.max(0, from - 1);
      }
      this.value = this.value.slice(0, from) + this.value.slice(to);
      this.selectionStart = this.selectionEnd = from;
    });
  }
  /** Chrome's autofill: a new value and an `input` event with no `beforeinput`. */
  autofill(value: string) {
    this.value = value;
    this.selectionStart = this.selectionEnd = value.length;
    this.dispatchEvent(new StandInInputEvent("input", {}));
  }
}

describe("§578 the keystrokes, through Maskito itself", () => {
  beforeAll(() => vi.stubGlobal("InputEvent", StandInInputEvent));
  afterAll(() => vi.unstubAllGlobals());
  const masked = () => {
    const box = new StandInBox();
    new Maskito(box as unknown as HTMLInputElement, birthDateMaskOptions);
    return box;
  };

  it("digits only: the box puts the dots in, refuses a letter and a ninth digit", () => {
    const box = masked();
    box.type("1");
    expect(box.value).toBe("1");
    box.type("1");
    expect(box.value).toBe("11.");
    box.type("05");
    expect(box.value).toBe("11.05.");
    box.type("1990");
    expect(box.value).toBe("11.05.1990");
    box.type("7a");
    expect(box.value).toBe("11.05.1990");
    expect(box.selectionEnd).toBe(10);
  });

  it("a dot or another separator after a lone digit pads it; a day over 31 cannot start", () => {
    const box = masked();
    box.type("5.");
    expect(box.value).toBe("05.");
    box.type("3/");
    expect(box.value).toBe("05.03.");
    const other = masked();
    other.type("35");
    expect(other.value).toBe("03.05.");
  });

  it("backspace from the end: the digits go, and a dot goes with the digit before it", () => {
    const box = masked();
    box.type("11051990");
    for (let key = 0; key < 4; key += 1) box.press("Backspace");
    expect(box.value).toBe("11.05");
    box.press("Backspace");
    expect(box.value).toBe("11.0");
    box.type("51990");
    expect(box.value).toBe("11.05.1990");
    box.setSelectionRange(6, 6);
    box.press("Backspace");
    expect(box.value).toBe("11.00.1990");
    expect(box.selectionEnd).toBe(4);
  });

  it("in the middle a digit takes the place of the one there, and Delete over a dot the digit after it", () => {
    const box = masked();
    box.type("29122001");
    box.setSelectionRange(1, 1);
    box.type("8");
    expect(box.value).toBe("28.12.2001");
    box.setSelectionRange(2, 2);
    box.press("Delete");
    expect(box.value).toBe("28.02.2001");
    expect(box.selectionEnd).toBe(4);
  });

  it("a pasted date is read whole, day first, whatever its separator — the posted shape too", () => {
    const box = masked();
    for (const [pasted, shown] of [
      ["5/11/1990", "05.11.1990"],
      ["1990-11-05", "05.11.1990"],
      ["11 05 1990", "11.05.1990"],
      ["11-05-1990", "11.05.1990"],
      ["5.6.1990", "05.06.1990"],
      ["11051990", "11.05.1990"],
    ] as const) {
      box.paste(pasted);
      expect(box.value, pasted).toBe(shown);
    }
  });

  it("autofill's `1990-05-11`, which sends no `beforeinput`, is shown day first", () => {
    const box = masked();
    box.autofill("1990-05-11");
    expect(box.value).toBe("11.05.1990");
  });

  it("an impossible date typed stays as typed, never moved to another day", () => {
    const box = masked();
    box.type("29022001");
    expect(box.value).toBe("29.02.2001");
  });
});

describe("§578 the posted shape and the other separators", () => {
  it("`1990-05-11` pasted, autofilled or filled is read day first, never «19» for the day", () => {
    expect(run(postedShapePreprocessor, "11.0", [0, 4], "1990-05-11", "insert").data).toBe("11.05.1990");
    expect(run(postedShapePreprocessor, "", [0, 0], " 1990-5-1 ", "insert").data).toBe("01.05.1990");
    const autofilled = run(postedShapePreprocessor, "1990-05-11", [10, 10], "", "validation");
    expect(autofilled.elementState).toEqual(state("11.05.1990"));
  });

  it("a typed «/», «-», «,» or space is the dot; a digit or a day-first paste is left to the kit", () => {
    for (const separator of ["/", "-", ",", " "]) {
      expect(run(postedShapePreprocessor, "5", [1, 1], separator, "insert").data).toBe(".");
    }
    expect(run(postedShapePreprocessor, "5", [1, 1], "3", "insert").data).toBe("3");
    expect(run(postedShapePreprocessor, "", [0, 0], "11/05/1990", "insert").data).toBe("11/05/1990");
  });
});

describe("§578 a backspace over a dot takes the digit before it", () => {
  it("Backspace over the dot of «11.» selects «1.», so «1» is left", () => {
    expect(run(dotTakesDigitPreprocessor, "11.", [2, 3], "", "deleteBackward").elementState.selection).toEqual([1, 3]);
    expect(run(dotTakesDigitPreprocessor, "11.05.1990", [5, 6], "", "deleteBackward").elementState.selection).toEqual([4, 6]);
  });

  it("Delete over a dot takes the digit after it", () => {
    expect(run(dotTakesDigitPreprocessor, "11.05.1990", [2, 3], "", "deleteForward").elementState.selection).toEqual([2, 4]);
  });

  it("a digit deleted, a selection, or a dot with no digit beside it is left to the kit", () => {
    expect(run(dotTakesDigitPreprocessor, "11.05", [4, 5], "", "deleteBackward").elementState.selection).toEqual([4, 5]);
    expect(run(dotTakesDigitPreprocessor, "11.05", [0, 5], "", "deleteBackward").elementState.selection).toEqual([0, 5]);
    expect(run(dotTakesDigitPreprocessor, "11.", [2, 3], "", "deleteForward").elementState.selection).toEqual([2, 3]);
    expect(run(dotTakesDigitPreprocessor, "11.", [2, 3], "1", "insert").elementState.selection).toEqual([2, 3]);
  });
});

describe("§578 the dot comes as soon as the day or the month is whole", () => {
  it("«11» typed is «11.», «11.05» is «11.05.», with the caret after the dot", () => {
    expect(dotAfterWholePartPostprocessor(state("11"), state("1"))).toEqual(state("11."));
    expect(dotAfterWholePartPostprocessor(state("11.05"), state("11.0"))).toEqual(state("11.05."));
  });

  it("not while deleting, not in the middle, not in the year", () => {
    expect(dotAfterWholePartPostprocessor(state("11"), state("11.0"))).toEqual(state("11"));
    expect(dotAfterWholePartPostprocessor(state("11.05", 1), state("1.05"))).toEqual(state("11.05", 1));
    expect(dotAfterWholePartPostprocessor(state("11.05.19"), state("11.05.1"))).toEqual(state("11.05.19"));
  });

  it("our pieces run before the kit's preprocessors and after its postprocessors", () => {
    const pre = birthDateMaskOptions.preprocessors ?? [];
    expect(pre.slice(0, 2)).toEqual([postedShapePreprocessor, dotTakesDigitPreprocessor]);
    expect(birthDateMaskOptions.postprocessors?.at(-1)).toBe(dotAfterWholePartPostprocessor);
  });
});

describe("§578 the box, rendered", () => {
  it("shows «11.05.1990» for a posted 1990-05-11, keeps the number pad and the placeholder, and has no maxlength", () => {
    const html = renderToStaticMarkup(
      createElement(BirthDateField, {
        id: fieldId("birthDate"),
        name: "birthDate",
        label: ro.Registration.birthDate,
        required: true,
        defaultValue: "1990-05-11",
        min: "1906-09-29",
        max: "2012-11-21",
        eventDay: "2026-11-21",
        locale: "ro",
        echoTemplate: ro.Registration.birthDateEcho,
        placeholder: ro.Registration.birthDatePlaceholder,
        unreadable: ro.Registration.birthDateUnreadable,
        tooYoung: "Prea tânăr",
        autoComplete: "bday",
      }),
    );
    const input = html.match(/<input[^>]*name="birthDate"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('value="11.05.1990"');
    expect(input).toMatch(/inputmode="numeric"/i);
    expect(input).toMatch(/autocomplete="bday"/i);
    expect(input).toContain('placeholder="ZZ.LL.AAAA"');
    expect(input).not.toMatch(/maxlength/i);
    expect(html).toContain("Vineri, 11 mai 1990 · 36 de ani în ziua evenimentului");
  });

  it("the mask is Maskito's, pinned, in the one field every form draws; the public form alone asks for autofill", () => {
    const field = read("src/modules/registrations/ui/BirthDateField.tsx");
    expect(field).toContain('from "@maskito/react"');
    expect(field).toContain("useMaskito({ options: birthDateMaskOptions })");
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    const maskito = ["@maskito/core", "@maskito/kit", "@maskito/react"].map((name) => pkg.dependencies[name]);
    expect(maskito.every((version) => /^\d+\.\d+\.\d+$/.test(version ?? "")), "exact pins").toBe(true);
    expect(new Set(maskito).size, "one version for the three").toBe(1);
    expect(JSON.stringify(pkg.dependencies)).not.toMatch(/imask|inputmask|"input-mask|number-format|text-mask/i);
    expect(read("src/modules/registrations/ui/registration-form.tsx")).toMatch(/<BirthDateField[\s\S]*?autoComplete="bday"/);
    expect(read("src/modules/registrations/ui/StaffEventBirthDate.tsx")).not.toMatch(/autoComplete="bday"/);
  });
});
