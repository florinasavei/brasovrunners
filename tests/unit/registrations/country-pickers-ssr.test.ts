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
 * BR-REQ-031-04 — the searchable country pickers (§NNN) post exactly what they posted before,
 * and the telephone prefix keeps its native select in the server's HTML for a reader without
 * JavaScript. Rendered as the server renders them, before hydration.
 */
const words = { search: "Caută", noMatch: "Nimic", clear: "Șterge", open: "Deschide", close: "Închide" };
const countries = countryOptions("ro", (code) => countryName(code, "ro"));

describe("BR-REQ-031-04 the country pickers as the server renders them", () => {
  it("keeps the phone's native <select name=phoneCountry> with Romania chosen", () => {
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
    expect(html).toMatch(/<select[^>]*name="phoneCountry"/);
    expect(html).toMatch(/<option[^>]*value="RO"[^>]*selected/);
  });

  it("posts the draft's citizenship as nationality=<ISO> through a hidden input (§142)", () => {
    const html = renderToStaticMarkup(
      createElement(NationalityField, {
        id: fieldId("nationality"),
        name: "nationality",
        label: "Cetățenie",
        noneLabel: "Nu spun",
        defaultValue: "DE",
        countries,
        words,
      }),
    );
    expect(html).toContain('<input type="hidden" name="nationality" value="DE"/>');
    expect(html).toContain(`id="${fieldId("nationality")}"`);
  });

  it("starts a required citizenship at Romania, the visible box required", () => {
    const html = renderToStaticMarkup(
      createElement(NationalityField, {
        id: fieldId("nationality"),
        name: "nationality",
        label: "Cetățenie",
        noneLabel: "Nu spun",
        countries,
        words,
        required: true,
      }),
    );
    expect(html).toContain('<input type="hidden" name="nationality" value="RO"/>');
    expect(html).toMatch(new RegExp(`<input[^>]*id="${fieldId("nationality")}"[^>]*required`));
    expect(html).not.toContain("Nu spun");
  });

  it("has the same search words in both catalogues", () => {
    const keys = (catalogue: typeof ro) => Object.keys(catalogue.Registration.countrySearch).sort();
    expect(keys(ro)).toEqual(keys(en as typeof ro));
    expect(keys(ro)).toEqual(["clear", "close", "noMatch", "open", "search"]);
  });
});
