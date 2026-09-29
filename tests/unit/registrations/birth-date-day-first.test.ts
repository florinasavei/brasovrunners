import { readFileSync } from "node:fs";
import path from "node:path";
import dayjs from "dayjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import BirthDateField, { birthDateValidity } from "@/modules/registrations/ui/BirthDateField";
import { birthDateEchoText } from "@/modules/registrations/ui/birth-date-echo";
import {
  DATE_DISPLAY_FORMAT,
  normalizeTypedDate,
  readTypedDate,
  shownTypedDate,
  TYPED_DATE_PATTERN,
} from "@/shared/forms/pickers/wall-values";
import { fieldId } from "@/shared/forms/outcome";

/**
 * §NNN (amending §467, applying §345's order to the public form) — the registration form's birth
 * date is typed and shown DAY FIRST, «11.05.1990», whatever language the browser speaks. The
 * owner's screenshot of 2026-09-29 showed the browser's own date box drawing «05/11/1990» for
 * 11 May, under a line that said «Vineri, 11 mai 1990», and that line drawn over the box's
 * bottom edge. BR-REQ-031-04 (the form's fields).
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

describe("§NNN a typed birth date is read day first", () => {
  it("reads «05/11/1990» as 5 November, whatever the separator", () => {
    for (const typed of ["05/11/1990", "05.11.1990", "5.11.1990", "05-11-1990", "05 11 1990", "5/11/1990", "05,11,1990", " 05.11.1990 "]) {
      expect(readTypedDate(typed), typed).toBe("1990-11-05");
    }
  });

  it("reads eight digits — a phone's numeric keypad has no dot — and the posted shape as itself", () => {
    expect(readTypedDate("11051990")).toBe("1990-05-11");
    expect(readTypedDate("1990-05-11")).toBe("1990-05-11");
  });

  it("reads nothing before a whole, real day is typed", () => {
    for (const typed of ["", "11", "11.05", "11.05.19", "31.02.1990", "32.01.1990", "11.13.1990", "1990", "1151990", "abc"]) {
      expect(readTypedDate(typed), typed).toBe("");
    }
  });

  it("shows a date as the backoffice's picker does (`DATE_DISPLAY_FORMAT`, §345)", () => {
    for (const value of ["1990-05-11", "1990-11-05", "2012-02-29", "1985-12-31"]) {
      expect(shownTypedDate(value)).toBe(dayjs(value).format(DATE_DISPLAY_FORMAT));
    }
    expect(shownTypedDate("05/11/1990")).toBe("05.11.1990");
    expect(shownTypedDate("11051990")).toBe("11.05.1990");
    // What is no date stays as typed, for the box to refuse.
    expect(shownTypedDate("11.05")).toBe("11.05");
    expect(shownTypedDate("")).toBe("");
  });

  it("gives the server the posted shape, or what was typed for the schema to refuse", () => {
    expect(normalizeTypedDate("05/11/1990")).toBe("1990-11-05");
    expect(normalizeTypedDate("1990-11-05")).toBe("1990-11-05");
    expect(normalizeTypedDate(" 31.02.1990 ")).toBe("31.02.1990");
    expect(normalizeTypedDate("")).toBe("");
  });

  it("the public form's mapping posts `YYYY-MM-DD` for a day-first date, and a browser without JavaScript is read the same", () => {
    const form = new FormData();
    form.set("birthDate", "05/11/1990");
    expect(readRegistrationForm(form, "ro").birthDate).toBe("1990-11-05");
    form.set("birthDate", "1990-05-17");
    expect(readRegistrationForm(form, "ro").birthDate).toBe("1990-05-17");
  });

  it("the box's `pattern`, compiled as a browser does (`v` flag, anchored), says the same", () => {
    const pattern = new RegExp(`^(?:${TYPED_DATE_PATTERN})$`, "v");
    for (const typed of ["05/11/1990", "5.11.1990", "11051990", "1990-05-11", "05 11 1990"]) {
      expect(pattern.test(typed), typed).toBe(true);
    }
    for (const typed of ["11.05", "1990", "abc", "11.05.90"]) {
      expect(pattern.test(typed), typed).toBe(false);
    }
  });
});

describe("§NNN the words under the box always name the day the box holds", () => {
  const template = ro.Registration.birthDateEcho;

  it("a day-first date echoes the same day, with the age on the event's day", () => {
    const line = birthDateEchoText(readTypedDate("05/11/1990"), "2026-11-21", "ro", template);
    expect(line).toBe("Luni, 5 noiembrie 1990 · 36 de ani în ziua evenimentului");
    const may = birthDateEchoText(readTypedDate("11.05.1990"), "2026-11-21", "en", en.Registration.birthDateEcho);
    expect(may).toBe("Friday, 11 May 1990 · 36 years on the event day");
  });

  it("refuses in the box itself a text that is no date, a date under the event's minimum and one before the oldest bound", () => {
    const words = { unreadable: "no date", tooYoung: "too young" };
    const min = "1906-09-29";
    const max = "2012-11-21";
    expect(birthDateValidity("", min, max, words)).toBe("");
    expect(birthDateValidity("11.05.1990", min, max, words)).toBe("");
    expect(birthDateValidity("11.05", min, max, words)).toBe("no date");
    expect(birthDateValidity("31.02.1990", min, max, words)).toBe("no date");
    expect(birthDateValidity("01.01.1900", min, max, words)).toBe("no date");
    expect(birthDateValidity("22.11.2012", min, max, words)).toBe("too young");
    expect(birthDateValidity("21.11.2012", min, max, words)).toBe("");
  });

  it("has its placeholder and its refusal in both catalogues", () => {
    expect(ro.Registration.birthDatePlaceholder).toBe("ZZ.LL.AAAA");
    expect(en.Registration.birthDatePlaceholder).toBe("DD.MM.YYYY");
    expect(ro.Registration.birthDateUnreadable).toContain("11.05.1990");
    expect(en.Registration.birthDateUnreadable).toContain("11.05.1990");
  });
});

describe("§NNN the box, rendered: day first, and the echo is its helper", () => {
  function render(props: Partial<Parameters<typeof BirthDateField>[0]> = {}) {
    return renderToStaticMarkup(
      createElement(BirthDateField, {
        id: fieldId("birthDate"),
        name: "birthDate",
        label: ro.Registration.birthDate,
        required: true,
        min: "1906-09-29",
        max: "2012-11-21",
        eventDay: "2026-11-21",
        locale: "ro",
        echoTemplate: ro.Registration.birthDateEcho,
        placeholder: ro.Registration.birthDatePlaceholder,
        unreadable: ro.Registration.birthDateUnreadable,
        tooYoung: "Prea tânăr",
        ...props,
      }),
    );
  }

  it("is a typed text box named `birthDate`, never the browser's date box, showing the date day first", () => {
    const html = render({ defaultValue: "1990-05-11" });
    const input = html.match(/<input[^>]*name="birthDate"[^>]*>/)?.[0] ?? "";
    expect(input).not.toBe("");
    expect(input).not.toContain('type="date"');
    expect(input).toContain('type="text"');
    expect(input).toContain('value="11.05.1990"');
    expect(input).toContain('placeholder="ZZ.LL.AAAA"');
    expect(input).toMatch(/inputmode="numeric"/i);
    expect(input).toContain(`id="${fieldId("birthDate")}"`);
    expect(input).toContain('data-max="2012-11-21"');
  });

  it("draws the date in words as the field's own helper — inside its FormControl, after the input — never a line of its own", () => {
    // Emotion writes its `<style>` tags inline on a bare server render; the elements are the rest.
    const html = render({ defaultValue: "1990-05-11" }).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    const input = html.indexOf('name="birthDate"');
    const helper = html.search(/<p[^>]*MuiFormHelperText-root[^>]*>Vineri, 11 mai 1990 · 36 de ani în ziua evenimentului<\/p>/);
    expect(input).toBeGreaterThan(0);
    expect(helper, "the echo is the FormHelperText").toBeGreaterThan(input);
    // One FormControl around it all, closed right after the helper: the echo is its child, not a sibling.
    expect(html).toMatch(/^<div class="MuiFormControl-root[^"]*"/);
    expect(html.endsWith("</p></div>")).toBe(true);
    // The helper points back at the box, as every helper does.
    expect(html).toMatch(new RegExp(`aria-describedby="${fieldId("birthDate")}-helper-text"`));
  });

  it("says nothing under the box at rest, and the refusal alone when the server named it", () => {
    expect(render()).not.toContain("MuiFormHelperText-root");
    const refused = render({ defaultValue: "2020-01-01", error: true, errorText: "Vârsta minimă…" });
    expect(refused).toContain(">Vârsta minimă…</p>");
    expect(refused).not.toContain("în ziua evenimentului");
  });

  it("keeps the desk's rule and adds the date in words under it", () => {
    const html = render({ defaultValue: "05/11/1990", help: "Opțional aici." });
    expect(html).toContain("Opțional aici.");
    expect(html).toContain("Luni, 5 noiembrie 1990 · 36 de ani în ziua evenimentului");
    expect(html).toContain('value="05.11.1990"');
  });

  it("the public form and the desk draw this box, and no separate echo line pulled over the outline", () => {
    const page = read("src/app/[locale]/events/[slug]/register/page.tsx");
    expect(page).toContain("<BirthDateField");
    expect(page).not.toMatch(/\{\.\.\.field\("birthDate"\)\}/);
    expect(page).not.toContain("BirthDateEcho");
    const desk = read("src/modules/registrations/ui/StaffEventBirthDate.tsx");
    expect(desk).toContain("<BirthDateField");
    expect(desk).not.toContain('type="date"');
    const field = read("src/modules/registrations/ui/BirthDateField.tsx");
    expect(field).not.toMatch(/mt:\s*-/);
  });
});
