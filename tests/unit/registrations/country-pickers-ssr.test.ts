import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { countryOptions } from "@/modules/registrations/countries";
import { countryName } from "@/modules/registrations/names";
import { phoneCountryLabels, phoneCountryOrder } from "@/modules/registrations/phone";
import NationalityField from "@/modules/registrations/ui/NationalityField";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import { fieldId } from "@/shared/forms/outcome";

/**
 * BR-REQ-031-04 — the searchable country pickers (§463) post exactly what they posted before:
 * each is a native `<select>` in the server's HTML, with the current country chosen, for a reader
 * without JavaScript and before hydration. The search's button only arrives with the island.
 */
const words = { search: "Caută", noMatch: "Nimic", open: "Deschide", close: "Închide" };
const countries = countryOptions("ro", (code) => countryName(code, "ro"));

/** The opening `<select …>` tag carrying this name. */
function selectTag(html: string, name: string): string {
  const match = html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>`));
  expect(match, `a native <select name="${name}">`).not.toBeNull();
  return match![0];
}

describe("BR-REQ-031-04 the country pickers as the server renders them", () => {
  it("keeps the phone's native <select name=phoneCountry> with Romania chosen, no search button yet", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneField, {
        name: "phone",
        label: "Telefon",
        countryLabel: "Țara",
        countryOrder: phoneCountryOrder("ro"),
        countryNames: phoneCountryLabels("ro"),
        searchWords: words,
      }),
    );
    selectTag(html, "phoneCountry");
    expect(html).toMatch(/<option[^>]*value="RO"[^>]*selected/);
    expect(html).not.toContain('aria-haspopup="dialog"');
  });

  it("keeps a draft's phone country chosen (§142)", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneField, {
        name: "phone",
        label: "Telefon",
        countryLabel: "Țara",
        countryOrder: phoneCountryOrder("ro"),
        countryNames: phoneCountryLabels("ro"),
        searchWords: words,
        draft: { country: "DE", national: "1512345678" },
      }),
    );
    expect(html).toMatch(/<option[^>]*value="DE"[^>]*selected/);
  });

  it("draws citizenship as a native, required <select name=nationality> with the draft's country chosen", () => {
    const html = renderToStaticMarkup(
      createElement(NationalityField, {
        id: fieldId("nationality"),
        name: "nationality",
        label: "Cetățenie",
        defaultValue: "DE",
        countries,
        words,
      }),
    );
    const tag = selectTag(html, "nationality");
    expect(tag).toContain(`id="${fieldId("nationality")}"`);
    expect(tag).toContain("required");
    expect(html).toMatch(/<option[^>]*value="DE"[^>]*selected/);
    expect(html).not.toMatch(/<option[^>]*value="RO"[^>]*selected/);
    // §432: no empty answer to post, and nothing but the select posts it.
    expect(html).not.toContain('<option value=""');
    expect(html).not.toContain('type="hidden" name="nationality"');
    expect(html).not.toContain('aria-haspopup="dialog"');
  });

  it("starts citizenship at Romania with no draft, and on an unknown code (§432)", () => {
    for (const defaultValue of [undefined, "", "XX"]) {
      const html = renderToStaticMarkup(
        createElement(NationalityField, {
          id: fieldId("nationality"),
          name: "nationality",
          label: "Cetățenie",
          defaultValue,
          countries,
          words,
        }),
      );
      expect(html).toMatch(/<option[^>]*value="RO"[^>]*selected/);
      expect(html.match(/<option/g)?.length).toBe(countries.length);
    }
  });

  it("draws the country of residence as its own native, required select, on Romania without a draft (§NNN)", () => {
    const html = renderToStaticMarkup(
      createElement(NationalityField, {
        id: fieldId("country"),
        name: "country",
        label: "Țara de reședință",
        defaultValue: undefined,
        countries,
        words,
      }),
    );
    const tag = selectTag(html, "country");
    expect(tag).toContain(`id="${fieldId("country")}"`);
    expect(tag).toContain("required");
    expect(html).toMatch(/<option[^>]*value="RO"[^>]*selected/);
    expect(html).not.toContain('<option value=""');
  });

  it("has the same search words in both catalogues", () => {
    const keys = (catalogue: typeof ro) => Object.keys(catalogue.Registration.countrySearch).sort();
    expect(keys(ro)).toEqual(keys(en as typeof ro));
    expect(keys(ro)).toEqual(["close", "noMatch", "open", "search"]);
  });
});
