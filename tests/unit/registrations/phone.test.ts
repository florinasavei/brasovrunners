import { describe, expect, it } from "vitest";
import { composePhone, DIALING_CODES, formatPhone, PHONE_COUNTRY_CODES, splitPhone } from "@/modules/registrations/phone";
import { COUNTRY_CODES } from "@/modules/registrations/countries";

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
