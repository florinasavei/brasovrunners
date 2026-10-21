import { readFileSync } from "node:fs";
import path from "node:path";
import { Maskito } from "@maskito/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import BirthDateField, { birthDateHelper } from "@/modules/registrations/ui/BirthDateField";
import BirthDatePicker from "@/modules/registrations/ui/BirthDatePicker";
import { birthDateMaskOptions } from "@/modules/registrations/ui/birth-date-mask";
import { openNativePicker, pickerValue, typedFromPicked, writePickedDay } from "@/modules/registrations/ui/birth-date-picker";
import { fieldId } from "@/shared/forms/outcome";

/**
 * §561 amended, §773 — the volunteers' birth-date box gains a calendar button that opens the browser's own date picker and
 * writes the chosen day into the typed box (the owner, 2026-10-16: «la formularul de voluntari aș vrea datepicker la data
 * nașterii»). §345 stands: no MUI X on a public page (`tests/unit/shared/pickers-backoffice-only.test.ts` still walks the
 * imports). The suite runs in Node with no DOM: the button and its hidden input are drawn on their own (`BirthDatePicker`,
 * which `BirthDateField` mounts after hydration), the rules are the pure functions of `birth-date-picker.ts`, and the road
 * from the picker into the box goes through Maskito itself on a stand-in input.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const MIN = "1906-09-29";
const MAX = "2008-11-21";

const field = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(BirthDateField, {
      id: fieldId("birthDate"),
      name: "birthDate",
      label: ro.Registration.birthDate,
      required: true,
      defaultValue: "1990-05-11",
      min: MIN,
      max: MAX,
      eventDay: "2026-11-21",
      locale: "ro",
      echoTemplate: ro.Registration.birthDateEcho,
      placeholder: ro.Registration.birthDatePlaceholder,
      unreadable: ro.Registration.birthDateUnreadable,
      tooYoung: "Prea tânăr",
      autoComplete: "bday",
      ...extra,
    }),
  );

describe("the words", () => {
  it("name the button in both languages, in the registration form's namespace beside the other birth-date words", () => {
    expect(ro.Registration.birthDatePicker).toBe("Alege data din calendar");
    expect(en.Registration.birthDatePicker).toBe("Pick the date from a calendar");
  });
});

describe("off by default — the registration form's box is the box it always was", () => {
  it("draws no button and no date input, with or without the prop named", () => {
    const html = field();
    expect(html).not.toContain("<button");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("-native");
    expect(field({ picker: undefined })).toBe(html);
  });

  it("with the picker asked for, the server's (and a scripts-off page's) markup is the same box: no button that does nothing", () => {
    expect(field({ picker: { label: ro.Registration.birthDatePicker } })).toBe(field());
  });

  it("keeps the typed value and the server's words after a refusal, picker or not (§315)", () => {
    const refused = field({ picker: { label: "x" }, defaultValue: "11.05", error: true, errorText: "Data nu e bună." });
    expect(refused).toContain('value="11.05"');
    expect(refused).toContain("Data nu e bună.");
  });

  it("only the volunteers' two places ask for it", () => {
    expect(read("src/modules/volunteers/ui/VolunteerBox.tsx")).toContain('picker={{ label: tForm("birthDatePicker") }}');
    expect(read("src/modules/volunteers/ui/VolunteerBirthDateField.tsx")).toContain("picker={{ label: words.pickerLabel }}");
    expect(read("src/modules/volunteers/ui/VolunteerPerson.tsx")).toContain('pickerLabel: tReg("birthDatePicker")');
    for (const file of [
      "src/modules/registrations/ui/registration-form.tsx",
      "src/modules/registrations/ui/StaffEventBirthDate.tsx",
      "src/app/[locale]/events/[slug]/declaration/page.tsx",
      "src/app/[locale]/admin/registrations/new/page.tsx",
    ]) {
      expect(read(file), file).not.toMatch(/\bpicker[=:]/);
    }
  });
});

describe("the button and the hidden date input", () => {
  const html = (text: string) => renderToStaticMarkup(createElement(BirthDatePicker, { id: "vol-birth", label: ro.Registration.birthDatePicker, text, min: MIN, max: MAX, onPick: () => {} }));

  it("is a button of its own that submits nothing, named in words, with a calendar glyph", () => {
    const markup = html("");
    const button = markup.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-label="Alege data din calendar"');
    // The tooltip a mouse user reads: the button has a glyph and no words.
    expect(button).toContain('title="Alege data din calendar"');
    expect(markup).toContain('data-testid="CalendarMonthIcon"');
  });

  it("owns a date input that posts nothing, is out of the tab order and hidden from a screen reader, bounded as the box is", () => {
    const input = html("").match(/<input[^>]*>/)?.[0] ?? "";
    expect(input).toContain('type="date"');
    // Derived from the box's id: the organizers' card draws one box per volunteer and one to add, so no two share a test id.
    expect(input).toContain('data-testid="vol-birth-native"');
    expect(input).toContain(`min="${MIN}"`);
    expect(input).toContain(`max="${MAX}"`);
    expect(input).toContain('tabindex="-1"');
    expect(input).toContain('aria-hidden="true"');
    expect(input).not.toContain("name=");
    expect(input).not.toContain("required");
  });

  it("holds the box's day while it is inside the bounds, and nothing otherwise", () => {
    expect(html("11.05.1990").match(/<input[^>]*>/)?.[0]).toContain('value="1990-05-11"');
    expect(html("11.05").match(/<input[^>]*>/)?.[0]).toContain('value=""');
    expect(html("11.05.2020").match(/<input[^>]*>/)?.[0]).toContain('value=""');
    expect(pickerValue("11.05.1990", MIN, MAX)).toBe("1990-05-11");
    expect(pickerValue("1990-05-11", MIN, MAX)).toBe("1990-05-11");
    expect(pickerValue("11.05.1800", MIN, MAX)).toBe("");
    expect(pickerValue("31.02.1990", MIN, MAX)).toBe("");
    expect(pickerValue("", MIN, MAX)).toBe("");
  });
});

describe("opening the browser's picker", () => {
  it("asks showPicker first", () => {
    const showPicker = vi.fn();
    const focus = vi.fn();
    const click = vi.fn();
    expect(openNativePicker({ showPicker, focus, click })).toBe("picker");
    expect(showPicker).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("falls back to focusing and clicking the input where showPicker is missing", () => {
    const focus = vi.fn();
    const click = vi.fn();
    expect(openNativePicker({ focus, click })).toBe("focused");
    expect(focus).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it("falls back the same way where showPicker throws (an insecure context, a refusal)", () => {
    const showPicker = vi.fn(() => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    const focus = vi.fn();
    const click = vi.fn();
    expect(openNativePicker({ showPicker, focus, click })).toBe("focused");
    expect(focus).toHaveBeenCalledOnce();
  });

  it("never throws, even when the input cannot be focused", () => {
    const boom = () => {
      throw new Error("detached");
    };
    expect(() => openNativePicker({ showPicker: boom, focus: boom, click: boom })).not.toThrow();
  });
});

/** As much of an `<input>` as Maskito touches. */
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
}

describe("choosing a day writes the typed box", () => {
  it("turns the picker's 1990-05-11 into 11.05.1990", () => {
    expect(typedFromPicked("1990-05-11")).toBe("11.05.1990");
    expect(typedFromPicked("2000-02-29")).toBe("29.02.2000");
    expect(typedFromPicked("")).toBe("");
    expect(typedFromPicked("1990-5-11")).toBe("");
    expect(typedFromPicked("11.05.1990")).toBe("");
    expect(typedFromPicked("2001-02-29")).toBe("");
  });

  it("sets the value and sends an input event that bubbles, after Maskito's own listener — the road a keystroke takes", () => {
    const box = new StandInBox();
    new Maskito(box as unknown as HTMLInputElement, birthDateMaskOptions);
    const heard: string[] = [];
    let bubbles = false;
    box.addEventListener("input", (event) => {
      heard.push(box.value);
      bubbles = event.bubbles;
    });
    expect(writePickedDay(box as unknown as HTMLInputElement, "1990-05-11")).toBe("11.05.1990");
    expect(box.value).toBe("11.05.1990");
    expect(heard).toEqual(["11.05.1990"]);
    expect(bubbles).toBe(true);
    // A second choice replaces the first whole; the mask leaves a masked value as it is.
    expect(writePickedDay(box as unknown as HTMLInputElement, "1985-12-03")).toBe("03.12.1985");
    expect(box.value).toBe("03.12.1985");
  });

  it("leaves the box alone when the picker was cleared or gave no day", () => {
    const box = new StandInBox();
    box.value = "11.05.1990";
    const heard = vi.fn();
    box.addEventListener("input", heard);
    expect(writePickedDay(box as unknown as HTMLInputElement, "")).toBe("");
    expect(box.value).toBe("11.05.1990");
    expect(heard).not.toHaveBeenCalled();
  });

  it("the echo and the minimum-age helper follow the written text; a typed-again box drops the server's old refusal", () => {
    const words = { min: MIN, max: MAX, error: true, errorText: "Data nu e bună.", echo: "Vineri, 11 mai 1990 · 36 de ani în ziua evenimentului", tooYoung: "Prea tânăr" };
    expect(birthDateHelper({ ...words, text: "11.05.1990", typedAgain: true })).toEqual({ lines: [words.echo], error: false });
    expect(birthDateHelper({ ...words, text: "11.05.2020", typedAgain: true, echo: "" })).toEqual({ lines: ["Prea tânăr"], error: true });
    expect(birthDateHelper({ ...words, text: "11.05.2020", typedAgain: false, echo: "" }).lines).toEqual(["Prea tânăr"]);
    expect(birthDateHelper({ ...words, text: "11.05.1990", typedAgain: false }).lines).toEqual(["Data nu e bună.", words.echo]);
  });
});

describe("§345 stands", () => {
  it("the picker files import no MUI X and no date library", () => {
    for (const file of ["src/modules/registrations/ui/BirthDatePicker.tsx", "src/modules/registrations/ui/birth-date-picker.ts", "src/modules/registrations/ui/BirthDateField.tsx"]) {
      const text = read(file);
      expect(text, file).not.toMatch(/@mui\/x-date-pickers|dayjs|shared\/forms\/pickers\/(DateField|PickerProvider|TimeField)/);
    }
  });
});
