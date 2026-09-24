import { existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { composePhone, DIALING_CODES, PHONE_COUNTRY_CODES, phoneCountryLabels, phoneCountryOrder } from "@/modules/registrations/phone";
import {
  capPhoneDigits,
  caretAfter,
  formatNationalNumber,
  PHONE_MASKS,
  phoneDigitCap,
  phoneMaxLength,
  phonePlaceholder,
  reformatPhoneInput,
} from "@/modules/registrations/phone-format";
import PhoneField from "@/modules/registrations/ui/PhoneField";

/**
 * BR-REQ-031-04 criterion 16, `DECISIONS.md` §NNN — the telephone box groups the digits as they
 * are typed, and nothing about what is stored or refused moves.
 */

const TABLE = Object.keys(PHONE_MASKS);

describe("§NNN the mask, per country", () => {
  it("groups each table country the way its own people write a mobile number", () => {
    const cases: Array<[string, string, string]> = [
      ["RO", "0752189098", "0752 189 098"],
      ["RO", "752189098", "752 189 098"],
      ["MD", "069123456", "069 123 456"],
      ["MD", "69123456", "69 123 456"],
      ["HU", "201234567", "20 123 4567"],
      ["BG", "0871234567", "087 123 4567"],
      ["DE", "015123456789", "0151 2345 6789"],
      ["AT", "06641234567", "0664 123 4567"],
      ["IT", "3123456789", "312 345 6789"],
      // Italy keeps its leading zero (§84), so a zero there is part of the number, not a trunk prefix.
      ["IT", "0612345678", "061 234 5678"],
      ["FR", "0612345678", "06 12 34 56 78"],
      ["ES", "612345678", "612 345 678"],
      ["GB", "07700900123", "07700 900123"],
      ["NL", "0612345678", "06 1234 5678"],
      ["BE", "0470123456", "0470 12 34 56"],
      ["PL", "512345678", "512 345 678"],
      ["UA", "0501234567", "050 123 45 67"],
      ["US", "2125550100", "212 555 0100"],
      ["CA", "4165550100", "416 555 0100"],
    ];
    for (const [country, typed, shown] of cases) expect(formatNationalNumber(country, typed), `${country} ${typed}`).toBe(shown);
    // Every country in the table has a case above.
    expect(new Set(cases.map(([country]) => country))).toEqual(new Set(TABLE));
  });

  it("lends a mask to the countries that share its dialling code", () => {
    // Antigua is where `splitPhone` puts a stored +1 (the first in ISO order); it is still the North American plan.
    expect(formatNationalNumber("AG", "2685550100")).toBe("268 555 0100");
    expect(formatNationalNumber("JE", "07700900123")).toBe("07700 900123");
  });

  it("falls back to threes, with a typed trunk zero riding on the first group", () => {
    expect(DIALING_CODES.JP).toBe("81");
    expect(PHONE_MASKS.JP).toBeUndefined();
    expect(formatNationalNumber("JP", "9012345678")).toBe("901 234 567 8");
    expect(formatNationalNumber("JP", "09012345678")).toBe("0901 234 567 8");
  });

  it("keeps a leading plus and formats the international form around the code (§226)", () => {
    expect(formatNationalNumber("RO", "+40752189098")).toBe("+40 752 189 098");
    // A French number pasted under Romania is shown as French — `composePhone` then refuses it,
    // which is the answer that makes somebody change the country (§226).
    expect(formatNationalNumber("RO", "+33612345678")).toBe("+33 6 12 34 56 78");
    expect(composePhone("RO", formatNationalNumber("RO", "+33612345678"))).toBeNull();
    // On the way to a code there is nothing to group around yet.
    expect(formatNationalNumber("RO", "+")).toBe("+");
    expect(formatNationalNumber("RO", "+4")).toBe("+4");
    expect(formatNationalNumber("RO", "+40")).toBe("+40");
    expect(formatNationalNumber("RO", "+407")).toBe("+40 7");
    // The same plus `composePhone` sees: after the separators it tolerates, and nowhere else.
    expect(formatNationalNumber("RO", " (+40) 752")).toBe("+40 752");
    expect(formatNationalNumber("RO", "0752+189")).toBe("0752 189");
  });

  it("shows the 00 prefix and the code typed without a plus the way composePhone reads them", () => {
    expect(formatNationalNumber("RO", "0040752189098")).toBe("00 40 752 189 098");
    expect(formatNationalNumber("RO", "00")).toBe("00");
    expect(formatNationalNumber("RO", "40752189098")).toBe("40 752 189 098");
    expect(formatNationalNumber("US", "12125550100")).toBe("1 212 555 0100");
  });

  it("formats a paste with dashes, dots or brackets", () => {
    expect(formatNationalNumber("RO", "+40 752-189-098")).toBe("+40 752 189 098");
    expect(formatNationalNumber("RO", "0752.189.098")).toBe("0752 189 098");
    expect(formatNationalNumber("RO", "(0752) 189 098")).toBe("0752 189 098");
    expect(formatNationalNumber("RO", "")).toBe("");
  });

  it("is idempotent: formatting a formatted value changes nothing", () => {
    const typed = ["0752189098", "752189098", "+40752189098", "0040752189098", "40752189098", "12", "0", "+", "07123456789999", "(0752) 189-098"];
    for (const country of [...TABLE, "JP", "AG", "JE"]) {
      for (const value of typed) {
        const once = formatNationalNumber(country, value);
        expect(formatNationalNumber(country, once), `${country} ${value}`).toBe(once);
      }
    }
  });

  it("shows the mask before the first digit: a placeholder per table country", () => {
    expect(phonePlaceholder("RO")).toBe("0712 345 678");
    expect(phonePlaceholder("US")).toBe("212 555 0100");
    for (const country of TABLE) {
      const placeholder = phonePlaceholder(country);
      expect(placeholder, country).toBeDefined();
      // A placeholder that `composePhone` refused would be teaching a wrong number.
      expect(composePhone(country, placeholder ?? ""), country).not.toBeNull();
    }
    // No mask, no invented example.
    expect(phonePlaceholder("JP")).toBeUndefined();
  });
});

describe("§NNN the mask changes nothing composePhone decides (§84, §231, §283)", () => {
  /*
    Only what the box can hold: digits, the separators `composePhone` tolerates, a leading plus.
    (A letter is stripped as it is typed since §223 — that is the filter's behaviour, not the mask's.)
  */
  const typed = [
    "0752189098",
    "752189098",
    "+40752189098",
    "0040752189098",
    "40752189098",
    "12",
    "123",
    "0712345678901234",
    "+33612345678",
    "(0752) 189-098",
    "0 0 40 752 189 098",
  ];

  it("composes a formatted value to the same E.164 as the bare digits, for every table country", () => {
    for (const country of TABLE) {
      const example = PHONE_MASKS[country].example;
      const international = `+${DIALING_CODES[country]}${example.replace(/^0/, country === "IT" ? "0" : "")}`;
      for (const value of [example, example.replace(/\D/g, ""), international, ...typed]) {
        const formatted = formatNationalNumber(country, value);
        expect(composePhone(country, formatted), `${country} ${value} → ${formatted}`).toBe(composePhone(country, value));
      }
      // And the example is a real number there, so the equality above is not null === null.
      expect(composePhone(country, formatNationalNumber(country, example)), country).not.toBeNull();
    }
  });

  it("keeps the digit count the §283 answers read, and the equality the §231 check compares", () => {
    for (const country of TABLE) {
      for (const value of typed) {
        expect(formatNationalNumber(country, value).replace(/\D/g, ""), `${country} ${value}`).toBe(value.replace(/\D/g, ""));
      }
    }
    // The emergency contact typed with the mask and the runner's number without it are the same number.
    expect(composePhone("RO", "0711 111 111")).toBe(composePhone("RO", "711111111"));
    expect(composePhone("RO", "+40 711 111 111")).toBe(composePhone("RO", "0711111111"));
  });
});

describe("§NNN the cap counts digits, never characters (§283)", () => {
  it("leaves the stored number at fifteen digits in every form composePhone reads", () => {
    expect(phoneDigitCap("RO", "712")).toBe(13);
    // A trunk zero is dropped before storing, so it is not charged against the ceiling.
    expect(phoneDigitCap("RO", "0712")).toBe(14);
    // Except where it is kept.
    expect(phoneDigitCap("IT", "06")).toBe(13);
    // The international form carries its code; 00 two digits more.
    expect(phoneDigitCap("RO", "+40")).toBe(15);
    expect(phoneDigitCap("RO", "0040")).toBe(17);
    expect(phoneDigitCap("RO", "40712345678")).toBe(15);
    expect(phoneDigitCap("US", "212")).toBe(14);
    expect(phoneDigitCap("MD", "69")).toBe(12);
  });

  it("cuts at the cap however many spaces the value carries", () => {
    expect(capPhoneDigits("RO", "0712345678999999")).toBe("07123456789999");
    expect(capPhoneDigits("RO", "0712 345 678 999 999")).toBe("07123456789999");
    expect(capPhoneDigits("RO", "+40 712 345 678 999 999")).toBe("+407123456789999");
    // At the cap `composePhone` still takes it — the ceiling is E.164's own, not a stricter one.
    expect(composePhone("RO", capPhoneDigits("RO", "0712345678999999"))).toBe("+407123456789999");
    expect(composePhone("RO", capPhoneDigits("RO", "+40712345678999999"))).toBe("+407123456789999");
  });

  it("sets maxLength to the longest value the mask makes within the cap, spaces and plus included", () => {
    // "00 40 999 999 999 999 9": the 00 form is the longest for Romania.
    expect(phoneMaxLength("RO")).toBe(23);
    for (const country of [...TABLE, "JP", "AG", "CZ"]) {
      const max = phoneMaxLength(country);
      const dialing = DIALING_CODES[country];
      for (const form of ["9".repeat(20), `0${"9".repeat(20)}`, `+${dialing}${"9".repeat(20)}`, `00${dialing}${"9".repeat(20)}`]) {
        expect(formatNationalNumber(country, capPhoneDigits(country, form)).length, `${country} ${form}`).toBeLessThanOrEqual(max);
      }
      // And a correctly copied number with punctuation is never truncated by the browser.
      expect("+40 (752) 189-098".length).toBeLessThanOrEqual(max);
    }
  });
});

describe("§NNN the caret stays with its digit", () => {
  it("maps a count of digits to a place in the formatted value", () => {
    expect(caretAfter("0752 189 098", 0)).toBe(0);
    expect(caretAfter("0752 189 098", 4)).toBe(4);
    expect(caretAfter("0752 189 098", 5)).toBe(6);
    expect(caretAfter("+40 7", 4)).toBe(5);
    expect(caretAfter("0752 189 098", 99)).toBe(12);
  });

  it("follows the typing at the end, across a space the mask adds", () => {
    expect(reformatPhoneInput({ country: "RO", raw: "0752", caret: 4, previous: "075", inputType: "insertText" })).toEqual({ value: "0752", caret: 4 });
    expect(reformatPhoneInput({ country: "RO", raw: "07521", caret: 5, previous: "0752", inputType: "insertText" })).toEqual({ value: "0752 1", caret: 6 });
  });

  it("stays after a digit typed in the middle rather than jumping to the end", () => {
    // "07|52 189 098", a 3 typed.
    expect(reformatPhoneInput({ country: "RO", raw: "07352 189 098", caret: 3, previous: "0752 189 098", inputType: "insertText" })).toEqual({
      value: "0735 218 909 8",
      caret: 3,
    });
  });

  it("deletes the digit before a space on Backspace, not only the space", () => {
    // "0752 |189 098": the browser removes the space and leaves the caret at 4.
    expect(
      reformatPhoneInput({ country: "RO", raw: "0752189 098", caret: 4, previous: "0752 189 098", inputType: "deleteContentBackward" }),
    ).toEqual({ value: "0751 890 98", caret: 3 });
  });

  it("deletes the digit after a space on Delete", () => {
    // "0752| 189 098": the browser removes the space and the caret stays at 4.
    expect(
      reformatPhoneInput({ country: "RO", raw: "0752189 098", caret: 4, previous: "0752 189 098", inputType: "deleteContentForward" }),
    ).toEqual({ value: "0752 890 98", caret: 4 });
  });

  it("deletes an ordinary digit as the browser did", () => {
    // "0752 1|89 098", Backspace: the 1 goes.
    expect(
      reformatPhoneInput({ country: "RO", raw: "0752 89 098", caret: 5, previous: "0752 189 098", inputType: "deleteContentBackward" }),
    ).toEqual({ value: "0752 890 98", caret: 4 });
  });

  it("ends a paste formatted, with the caret after it", () => {
    expect(reformatPhoneInput({ country: "RO", raw: "+40 752-189-098", caret: 15, previous: "", inputType: "insertFromPaste" })).toEqual({
      value: "+40 752 189 098",
      caret: 15,
    });
    expect(reformatPhoneInput({ country: "RO", raw: "0752.189.098", caret: 12, previous: "", inputType: "insertFromPaste" })).toEqual({
      value: "0752 189 098",
      caret: 12,
    });
  });

  it("refuses a digit past the cap and leaves the caret at the end", () => {
    const full = formatNationalNumber("RO", "07123456789999");
    expect(full).toBe("0712 345 678 999 9");
    expect(reformatPhoneInput({ country: "RO", raw: `${full}9`, caret: full.length + 1, previous: full, inputType: "insertText" })).toEqual({
      value: full,
      caret: full.length,
    });
  });

  it("types the international form a character at a time", () => {
    let value = "";
    for (const key of "+40752189098") {
      value = reformatPhoneInput({ country: "RO", raw: value + key, caret: value.length + 1, previous: value, inputType: "insertText" }).value;
    }
    expect(value).toBe("+40 752 189 098");
  });
});

describe("§NNN one box, rendered on the server", () => {
  const countryOrder = phoneCountryOrder("ro");
  const countryNames = phoneCountryLabels("ro");
  const render = (props: Partial<Parameters<typeof PhoneField>[0]>) =>
    renderToStaticMarkup(
      createElement(PhoneField, { name: "phone", label: "Telefon", countryLabel: "Țara", countryOrder, countryNames, ...props }),
    );

  it("prefills a stored number masked, without the trunk zero splitPhone does not carry", () => {
    const html = render({ value: "+40752189098" });
    expect(html).toContain('value="752 189 098"');
    // The flag is the prefilled country's, a picture, and decorative.
    expect(html).toContain('src="/flags/ro.svg"');
    expect(html).toMatch(/<span aria-hidden="true"><img src="\/flags\/ro\.svg" alt=""/);
    // The select posts under the same name, named for a screen reader, Romania chosen and first.
    expect(html).toMatch(/<select name="phoneCountry" aria-label="Țara"/);
    expect(html).toMatch(/<option value="RO" selected="">🇷🇴 România \(\+40\)<\/option>/);
    expect(html.indexOf('value="RO"')).toBeLessThan(html.indexOf('value="AF"'));
    // The mask's placeholder and the ceiling the mask needs, in characters.
    expect(html).toContain('placeholder="0712 345 678"');
    expect(html).toMatch(/maxLength="23"/i);
    expect(html).toMatch(/inputMode="numeric"/i);
  });

  it("brings a refused draft back masked, every digit kept", () => {
    expect(render({ draft: { country: "RO", national: "0752189098" } })).toContain('value="0752 189 098"');
    // Too many digits comes back with all of them: cutting one could make a refused number pass.
    expect(render({ draft: { country: "RO", national: "07123456789999999" } })).toContain('value="0712 345 678 999 999 9"');
    expect(render({ draft: { country: "RO", national: "12" } })).toContain('value="12"');
  });

  it("masks a shared-code prefill with the plan it belongs to", () => {
    const html = render({ value: "+12125550100" });
    expect(html).toContain('value="212 555 0100"');
    expect(html).toContain('src="/flags/ag.svg"');
  });

  it("has a local flag picture for every country a prefix can be chosen for", () => {
    const missing = PHONE_COUNTRY_CODES.filter((code) => !existsSync(path.join(process.cwd(), "public", "flags", `${code.toLowerCase()}.svg`)));
    expect(missing).toEqual([]);
  });

  it("carries a pattern the browser can compile under the v flag, and it admits the mask", () => {
    const html = render({ value: "+40752189098" });
    const pattern = /pattern="([^"]+)"/.exec(html)?.[1];
    expect(pattern).toBeDefined();
    // Browsers compile `pattern` as `^(?:…)$` with the `v` flag; an invalid one is silently ignored.
    const compiled = new RegExp(`^(?:${pattern})$`, "v");
    for (const value of ["752 189 098", "+40 752 189 098", "00 40 752 189 098", "0752-189-098", "(0752) 189.098"]) {
      expect(compiled.test(value), value).toBe(true);
    }
    expect(compiled.test("12a4")).toBe(false);
    expect(compiled.test("12")).toBe(false);
  });
});
