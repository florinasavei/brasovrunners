import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ro from "../../../messages/ro.json";
import BirthDateField from "@/modules/registrations/ui/BirthDateField";
import {
  applyBirthDateMask,
  birthDateDigits,
  birthDateMasked,
  maskBirthDate,
  type MaskedBox,
} from "@/modules/registrations/ui/birth-date-mask";
import { fieldId } from "@/shared/forms/outcome";
import { readTypedDate } from "@/shared/forms/pickers/wall-values";

/**
 * §NNN (amending §561) — the owner, 2026-09-30: «la ziua nașterii ar trebui să am input mask, în
 * timp ce scriu data nașterii». The birth-date box takes digits and puts the dots in itself.
 * BR-REQ-031-04 (the form's fields).
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

/** A stand-in for the input: the browser's own edit, then the mask, as the `input` event's handler runs it. */
function box(value = "", caret = value.length) {
  const events: string[] = [];
  const state: MaskedBox & { caret: number; events: string[] } = {
    value,
    selectionEnd: caret,
    caret,
    events,
    setSelectionRange(start: number) {
      state.caret = start;
      state.selectionEnd = start;
    },
    dispatchEvent(event: Event) {
      events.push(event.type);
      return true;
    },
  };
  /** Types one character at the caret (what the browser does before the `input` event). */
  const type = (text: string) => {
    for (const char of text) {
      const previous = state.value;
      state.value = previous.slice(0, state.caret) + char + previous.slice(state.caret);
      state.selectionEnd = state.caret + 1;
      applyBirthDateMask(state, previous, "insertText");
    }
  };
  /** Backspace (or Delete) at the caret. */
  const erase = (forward = false) => {
    const previous = state.value;
    const at = forward ? state.caret : state.caret - 1;
    if (at < 0 || at >= previous.length) return;
    state.value = previous.slice(0, at) + previous.slice(at + 1);
    state.selectionEnd = at;
    applyBirthDateMask(state, previous, forward ? "deleteContentForward" : "deleteContentBackward");
  };
  /** A paste replacing the whole box. */
  const paste = (text: string) => {
    const previous = state.value;
    state.value = text;
    state.selectionEnd = text.length;
    applyBirthDateMask(state, previous, "insertFromPaste");
  };
  const moveTo = (at: number) => state.setSelectionRange(at, at);
  return { state, type, erase, paste, moveTo };
}

describe("§NNN the box puts the dots in as the digits are typed", () => {
  it("«11» is «11.», «1105» is «11.05.», and eight digits are the whole date", () => {
    const steps: Array<[string, string]> = [
      ["1", "1"],
      ["1", "11."],
      ["0", "11.0"],
      ["5", "11.05."],
      ["1", "11.05.1"],
      ["9", "11.05.19"],
      ["9", "11.05.199"],
      ["0", "11.05.1990"],
    ];
    const { state, type } = box();
    for (const [char, shown] of steps) {
      type(char);
      expect(state.value, `after «${char}»`).toBe(shown);
      expect(state.caret, "the caret is at the end").toBe(shown.length);
    }
  });

  it("takes no more than eight digits and no letters", () => {
    const { state, type } = box();
    type("110519901");
    expect(state.value).toBe("11.05.1990");
    const letters = box();
    letters.type("1a1b0");
    expect(letters.state.value).toBe("11.0");
  });

  it("a dot the person types is no second dot, and after a lone digit it closes the day or the month", () => {
    const { state, type } = box();
    type("11.05.1990");
    expect(state.value).toBe("11.05.1990");
    const short = box();
    short.type("5.");
    expect(short.state.value).toBe("05.");
    short.type("3/");
    expect(short.state.value).toBe("05.03.");
    short.type("1990");
    expect(short.state.value).toBe("05.03.1990");
  });

  it("the caret stays after the digit it followed when a digit is typed in the middle", () => {
    const { state, type, moveTo } = box("11.05.199");
    moveTo(4); // after «11.0»
    type("7");
    expect(state.value).toBe("11.07.5199");
    expect(state.caret).toBe(5); // after «11.07», the digit just typed
    const early = box("11.05.1990");
    early.moveTo(1);
    early.erase(); // backspace over the first «1»
    expect(early.state.value).toBe("10.51.990");
    expect(early.state.caret).toBe(0);
  });
});

describe("§NNN a backspace over a dot takes the digit before it", () => {
  it("«11.» and a backspace is «1», not «11.» again", () => {
    const { state, type, erase } = box();
    type("11");
    expect(state.value).toBe("11.");
    erase();
    expect(state.value).toBe("1");
    expect(state.caret).toBe(1);
  });

  it("from the whole date down to nothing, one digit at a time", () => {
    const { state, erase } = box("11.05.1990");
    const seen: string[] = [];
    while (state.value !== "") {
      erase();
      seen.push(state.value);
    }
    expect(seen).toEqual(["11.05.199", "11.05.19", "11.05.1", "11.05.", "11.0", "11.", "1", ""]);
  });

  it("a dot in the middle: the digit before it goes, the caret stays where it was", () => {
    const { state, erase, moveTo } = box("11.05.1990");
    moveTo(6); // after «11.05.»
    erase();
    expect(state.value).toBe("11.01.990");
    expect(state.caret).toBe(4);
  });

  it("the Delete key over a dot takes the digit after it", () => {
    const { state, erase, moveTo } = box("11.05.1990");
    moveTo(2); // before the first dot
    erase(true);
    expect(state.value).toBe("11.51.990");
    expect(state.caret).toBe(2);
  });

  it("Android sends no key: the removed dot is found from the text alone", () => {
    expect(maskBirthDate("11.05", 5, "11.05.", "")).toEqual({ text: "11.0", caret: 4 });
    expect(maskBirthDate("11", 2, "11.", "")).toEqual({ text: "1", caret: 1 });
  });
});

describe("§NNN a pasted date is read whole and shown in the mask", () => {
  for (const [pasted, shown] of [
    ["11/05/1990", "11.05.1990"],
    ["11-05-1990", "11.05.1990"],
    ["11051990", "11.05.1990"],
    ["1990-05-11", "11.05.1990"],
    ["5.11.1990", "05.11.1990"],
    [" 11 05 1990 ", "11.05.1990"],
    ["11.05.1990", "11.05.1990"],
  ] as const) {
    it(`«${pasted}» is «${shown}», read as the date it names`, () => {
      const { state, paste } = box("11.0");
      paste(pasted);
      expect(state.value).toBe(shown);
      expect(state.caret).toBe(shown.length);
      expect(readTypedDate(state.value)).toBe(readTypedDate(pasted));
    });
  }

  it("a shorter date pasted over the whole box is read whole, not as a deletion", () => {
    const { state, paste } = box("11.05.1990");
    paste("5/11/1990");
    expect(state.value).toBe("05.11.1990");
  });

  it("a shorter date pasted with no inputType (a keyboard that sends none) is still a paste", () => {
    const state: MaskedBox = { value: "5.6.1990", selectionEnd: 8, setSelectionRange() {} };
    expect(applyBirthDateMask(state, "11.05.1990", "")).toBe("05.06.1990");
    expect(state.value).toBe("05.06.1990");
  });

  it("with no inputType, a digit cut from the middle is still a deletion, not a whole date", () => {
    expect(maskBirthDate("1.05.1990", 0, "11.05.1990", "").text).toBe("10.51.990");
    expect(maskBirthDate("11.05.199", 9, "11.05.1990", "").text).toBe("11.05.199");
  });

  it("the digits and the mask on their own", () => {
    expect(birthDateDigits("1990-5-1")).toBe("01051990");
    expect(birthDateDigits("abc")).toBe("");
    expect(birthDateMasked("")).toBe("");
    expect(birthDateMasked("1")).toBe("1");
    expect(birthDateMasked("110")).toBe("11.0");
  });

  it("tells the islands reading the box by its id that the text changed under them", () => {
    const { state, paste } = box();
    paste("1990-05-11");
    expect(state.events).toEqual(["change"]);
    const unchanged = box("11.05.", 6);
    unchanged.type("1");
    expect(unchanged.state.events).toEqual([]);
  });
});

describe("§NNN the box, rendered after the digits are typed", () => {
  it("shows «11.05.1990» after «11051990», and the date it posts is 1990-05-11", () => {
    const { state, type } = box();
    type("11051990");
    const html = renderToStaticMarkup(
      createElement(BirthDateField, {
        id: fieldId("birthDate"),
        name: "birthDate",
        label: ro.Registration.birthDate,
        required: true,
        defaultValue: state.value,
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
    expect(readTypedDate(state.value)).toBe("1990-05-11");
    expect(html).toContain("Vineri, 11 mai 1990 · 36 de ani în ziua evenimentului");
  });

  it("the mask lives in the one field every form draws, with no mask library", () => {
    const field = read("src/modules/registrations/ui/BirthDateField.tsx");
    expect(field).toContain("applyBirthDateMask");
    const pkg = read("package.json");
    expect(pkg).not.toMatch(/imask|inputmask|input-mask|number-format|text-mask/i);
    expect(read("src/app/[locale]/events/[slug]/register/page.tsx")).toMatch(/<BirthDateField[\s\S]*?autoComplete="bday"/);
  });
});
