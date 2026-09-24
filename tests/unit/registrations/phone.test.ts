import { describe, expect, it } from "vitest";
import { composePhone, DIALING_CODES, formatPhone, PHONE_COUNTRY_CODES, phoneCountryOrder, splitPhone } from "@/modules/registrations/phone";
import { COUNTRY_CODES } from "@/modules/registrations/countries";

/**
 * §324 — the prefix select's order is decided on the server and only drawn in the browser, so
 * a browser whose ICU names countries differently cannot disagree with the server's markup.
 */
describe("the phone prefixes' order", () => {
  it("puts Romania first and offers every prefix exactly once, in either language", () => {
    for (const locale of ["ro", "en"]) {
      const order = phoneCountryOrder(locale);
      expect(order[0]).toBe("RO");
      expect([...order].sort()).toEqual([...PHONE_COUNTRY_CODES].sort());
    }
  });
});

/** `DECISIONS.md` §84 — a telephone number is stored as one thing a phone can dial. */
describe("telephone numbers", () => {
  it("composes E.164 from the country and what people actually type", () => {
    expect(composePhone("RO", "0712 345 678")).toBe("+40712345678");
    expect(composePhone("RO", "712345678")).toBe("+40712345678");
    expect(composePhone("RO", "+40 712-345-678")).toBe("+40712345678");
    expect(composePhone("RO", "0040712345678")).toBe("+40712345678");
    expect(composePhone("ro", "(0712) 345.678")).toBe("+40712345678");
    expect(composePhone("GB", "07700 900123")).toBe("+447700900123");
    expect(composePhone("US", "(212) 555-0100")).toBe("+12125550100");
    // Italy keeps its leading zero.
    expect(composePhone("IT", "06 1234 5678")).toBe("+390612345678");
  });

  it("refuses what cannot be a number", () => {
    expect(composePhone("RO", "asdasdasdas")).toBeNull();
    expect(composePhone("RO", "12")).toBeNull();
    expect(composePhone("RO", "0712345678901234")).toBeNull();
    expect(composePhone("XX", "0712345678")).toBeNull();
    // The international form typed for another country than the one chosen.
    expect(composePhone("RO", "+44 7700 900123")).toBeNull();
  });

  it("splits a stored number back for the form, Romania first among shared codes", () => {
    expect(splitPhone("+40712345678")).toEqual({ countryCode: "RO", national: "712345678" });
    expect(splitPhone("+12125550100").countryCode).toBe("AG"); // +1 is shared; the person corrects it
    expect(splitPhone(null)).toEqual({ countryCode: "RO", national: "" });
    expect(formatPhone("+40712345678")).toBe("+40 712 345 678");
  });

  it("offers a prefix for every nationality that has one", () => {
    expect(PHONE_COUNTRY_CODES.length).toBe(COUNTRY_CODES.length - COUNTRY_CODES.filter((c) => !(c in DIALING_CODES)).length);
    expect(PHONE_COUNTRY_CODES).toContain("RO");
    // The three uninhabited territories have no code and are left out.
    for (const code of ["BV", "HM", "TF"]) expect(PHONE_COUNTRY_CODES).not.toContain(code);
    for (const [, dialing] of Object.entries(DIALING_CODES)) expect(dialing).toMatch(/^[1-9]\d{0,3}$/);
  });
});

/**
 * §226 — what the box lets through, and why the plus is the one character that must survive.
 *
 * The digit filter was written to strip everything that is not a number, and stripping the
 * leading `+` turned a refusal into a wrong number: `composePhone` reads the plus as "this is
 * the international form" and then insists on the selected country's dialing code, so a French
 * number entered under Romania was refused and the person fixed the country. Without it the
 * same digits fall into the national branch, which prefixes the chosen country blindly.
 *
 * A wrong telephone number is worse than a rejected one: nothing ever tells the club.
 */
describe("§226 the digits the box keeps", () => {
  it("keeps a leading plus, so an international number is still judged against the country", () => {
    // Romania selected, a French number pasted in. Refused — which is the answer that makes
    // somebody change the country, rather than a number nobody can ring.
    expect(composePhone("RO", "+33712345678")).toBeNull();
  });

  it("would have stored a number belonging to nobody without it", () => {
    // The same digits with the plus gone: this is what the first version of the filter
    // produced, and it is accepted. Kept as a test so the regression is named rather than
    // rediscovered — `composePhone` is doing the right thing for a national number here.
    expect(composePhone("RO", "33712345678")).toBe("+4033712345678");
  });

  it("is unchanged for every ordinary way a Romanian number is written", () => {
    // The plus surviving costs nothing: each of these still composes to the same number.
    for (const typed of ["+40711111111", "0711111111", "0040711111111", "40711111111", "711111111"]) {
      expect(composePhone("RO", typed), typed).toBe("+40711111111");
    }
  });
});
