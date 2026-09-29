import { readFileSync } from "node:fs";
import path from "node:path";
import dayjs from "dayjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import BirthDateField, { birthDateHelper, birthDateValidity } from "@/modules/registrations/ui/BirthDateField";
import { missingControls } from "@/shared/ui/missing-controls";
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
 * §561 (amending §467, applying §345's order to the public form) — the registration form's birth
 * date is typed and shown DAY FIRST, «11.05.1990», whatever language the browser speaks. The
 * owner's screenshot of 2026-09-29 showed the browser's own date box drawing «05/11/1990» for
 * 11 May, under a line that said «Vineri, 11 mai 1990», and that line drawn over the box's
 * bottom edge. BR-REQ-031-04 (the form's fields).
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

describe("§561 a typed birth date is read day first", () => {
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

describe("§561 the words under the box always name the day the box holds", () => {
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

describe("§561 the box, rendered: day first, and the echo is its helper", () => {
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

  it("says nothing under the box at rest, and the server's refusal first, the date in words under it", () => {
    expect(render()).not.toContain("MuiFormHelperText-root");
    const refused = render({ defaultValue: "1990-05-11", error: true, errorText: "Completează acest câmp corect." });
    expect(refused).toMatch(/Mui-error[^>]*>.*Completează acest câmp corect\..*Vineri, 11 mai 1990 · 36 de ani în ziua evenimentului/);
    expect(refused).toContain('aria-invalid="true"');
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

/**
 * Round 2 (the owner, 2026-09-29 13:50): a birth date under the event's minimum age turned the box
 * red and said only «Luni, 11 mai 2020 · 6 ani în ziua evenimentului» — «ar trebui să văd și
 * mesajul de eroare că nu am vârsta minimă». The rule's sentence, the summary's own for this box
 * (§47, §329), now comes first under it, live, with the event's own minimum.
 */
describe("§561 under the minimum age, the box says the rule", () => {
  const words = {
    ro: { catalogue: ro.Registration, years: "14 ani", echo: "Luni, 11 mai 2020 · 6 ani în ziua evenimentului" },
    en: { catalogue: en.Registration, years: "14 years", echo: "Monday, 11 May 2020 · 6 years on the event day" },
  } as const;

  for (const locale of ["ro", "en"] as const) {
    const { catalogue, years, echo } = words[locale];
    const tooYoung = catalogue.errors.tooYoung.replace("{age}", years);

    it(`${locale}: a whole date under the minimum shows the rule in red, then the date in words`, () => {
      const html = renderToStaticMarkup(
        createElement(BirthDateField, {
          id: fieldId("birthDate"),
          name: "birthDate",
          label: catalogue.birthDate,
          required: true,
          defaultValue: "11.05.2020",
          min: "1906-09-29",
          max: "2012-11-21",
          eventDay: "2026-11-21",
          locale,
          echoTemplate: catalogue.birthDateEcho,
          placeholder: catalogue.birthDatePlaceholder,
          unreadable: catalogue.birthDateUnreadable,
          tooYoung,
        }),
      ).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
      const helper = html.match(/<p[^>]*MuiFormHelperText-root[^>]*>([\s\S]*?)<\/p>/);
      expect(helper, "the helper is drawn").not.toBeNull();
      expect(helper?.[0]).toContain("Mui-error");
      const text = (helper?.[1] ?? "").replace(/<[^>]+>/g, "|");
      expect(text.indexOf(tooYoung), "the rule first").toBeGreaterThanOrEqual(0);
      expect(text.indexOf(echo)).toBeGreaterThan(text.indexOf(tooYoung));
      expect(tooYoung).toContain(years);
      expect(html).toContain('aria-invalid="true"');
    });
  }

  it("says it only once a whole date is typed, and yields the server's refusal to what is typed again", () => {
    const base = { max: "2012-11-21", error: false, echo: "", tooYoung: "too young" };
    expect(birthDateHelper({ ...base, text: "11.05", typedAgain: true })).toEqual({ lines: [], error: false });
    expect(birthDateHelper({ ...base, text: "11.05.2020", typedAgain: true, echo: "six" })).toEqual({ lines: ["too young", "six"], error: true });
    // The last allowed day is no refusal.
    expect(birthDateHelper({ ...base, text: "21.11.2012", typedAgain: true, echo: "fourteen" })).toEqual({ lines: ["fourteen"], error: false });
    // The server's refusal stands on the drawn value, and gives way once the person types a good date.
    const server = { ...base, error: true, errorText: "server says", echo: "age" };
    expect(birthDateHelper({ ...server, text: "11.05.1990", typedAgain: false })).toEqual({ lines: ["server says", "age"], error: true });
    expect(birthDateHelper({ ...server, text: "12.05.1990", typedAgain: true })).toEqual({ lines: ["age"], error: false });
    // The desk's help line steps aside for the refusal.
    expect(birthDateHelper({ ...base, text: "11.05.2020", typedAgain: true, help: "help", echo: "six" }).lines).toEqual(["too young", "six"]);
  });

  it("the «Mai lipsesc:» list (§422) names the box the browser refuses for age", () => {
    const control = {
      id: fieldId("birthDate"),
      willValidate: true,
      validity: { valid: false, customError: true } as ValidityState,
      labels: [{ textContent: `${ro.Registration.birthDate} *` }],
      getAttribute: (name: string) => (name === "name" ? "birthDate" : null),
      closest: () => null,
    };
    expect(missingControls([control], {})).toEqual([{ key: "birthDate", label: ro.Registration.birthDate, id: fieldId("birthDate") }]);
    expect(birthDateValidity("11.05.2020", "1906-09-29", "2012-11-21", { unreadable: "u", tooYoung: "t" })).toBe("t");
  });

  it("the public form hands the box the summary's own sentence, with this event's minimum", () => {
    const page = read("src/app/[locale]/events/[slug]/register/page.tsx");
    expect(page).toMatch(/tooYoung=\{t\("errors\.tooYoung", minimumAge\)\}/);
    const desk = read("src/modules/registrations/ui/StaffEventBirthDate.tsx");
    expect(desk).toMatch(/tooYoung=\{words\.tooYoung\.replace\("\{age\}", yearsPhrase\(minAge, locale\)\)\}/);
  });
});
