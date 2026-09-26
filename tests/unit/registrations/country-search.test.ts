import { describe, expect, it } from "vitest";
import { countryOptions } from "@/modules/registrations/countries";
import { foldForSearch, searchCountries } from "@/modules/registrations/country-search";
import { countryName } from "@/modules/registrations/names";
import { DIALING_CODES, phoneCountryLabels, phoneCountryOrder } from "@/modules/registrations/phone";

/**
 * BR-REQ-031-04 — the telephone prefix and the citizenship are found by typing (§NNN; the owner:
 * "vreau searchbox să pot găsi țara"). One rule for both pickers, held here.
 */
const citizenship = countryOptions("ro", (code) => countryName(code, "ro"));
const names = phoneCountryLabels("ro");
const prefixes = phoneCountryOrder("ro").map((code) => ({ code, label: names[code], dialingCode: DIALING_CODES[code] }));
const codes = (list: { code: string }[]) => list.map((country) => country.code);

describe("BR-REQ-031-04 a country is found by typing part of it", () => {
  it("keeps the server's order on an empty search, Romania first", () => {
    expect(codes(searchCountries(citizenship, ""))).toEqual(codes(citizenship));
    expect(searchCountries(citizenship, "  ")[0].code).toBe("RO");
  });

  it("ignores accents and case, which a phone keyboard does not offer", () => {
    expect(foldForSearch("România")).toBe("romania");
    expect(codes(searchCountries(citizenship, "romania"))[0]).toBe("RO");
    expect(codes(searchCountries(citizenship, "ROMÂNIA"))[0]).toBe("RO");
  });

  it("puts the start of a word before a match inside one", () => {
    const found = codes(searchCountries(citizenship, "ger"));
    expect(found[0]).toBe("DE"); // Germania
    expect(found).toContain("DZ"); // Algeria, later
    expect(found.indexOf("DE")).toBeLessThan(found.indexOf("DZ"));
  });

  it("finds a country by its ISO code typed whole", () => {
    expect(codes(searchCountries(citizenship, "gb"))[0]).toBe("GB");
    expect(codes(searchCountries(citizenship, "MD"))[0]).toBe("MD");
  });

  it("finds a telephone prefix by its dialling code, in every way it is written", () => {
    for (const typed of ["40", "+40", "0040", "+ 40"]) {
      expect(codes(searchCountries(prefixes, typed))[0], typed).toBe("RO");
    }
    // A prefix of the digits narrows: +37 is Moldova's +373 among others, never Romania.
    const narrowed = codes(searchCountries(prefixes, "+37"));
    expect(narrowed).toContain("MD");
    expect(narrowed).not.toContain("RO");
  });

  it("never reads digits as part of a name, and says nothing for nonsense", () => {
    expect(searchCountries(citizenship, "40")).toEqual([]);
    expect(searchCountries(citizenship, "qqqq")).toEqual([]);
  });

  it("finds every country the list offers by its own name", () => {
    for (const country of citizenship) {
      expect(codes(searchCountries(citizenship, country.label)), country.label).toContain(country.code);
    }
  });
});
