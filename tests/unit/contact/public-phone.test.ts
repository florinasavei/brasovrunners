import { describe, expect, it } from "vitest";
import { publicPhoneSchema, telHref } from "@/modules/contact/domain/public-phone";

/**
 * §565 — «Telefon public»: one optional number, shown as the club typed it, dialled by its digits.
 * Every number here is made up: the club's is a setting, never a value in the repository.
 */
const SAMPLE = "+40 123 456 789";

describe("§565 the public phone's value", () => {
  it("keeps a number as typed, trimmed, its inner spaces made one", () => {
    expect(publicPhoneSchema.parse({ phone: `  ${SAMPLE} ` })).toEqual({ phone: SAMPLE });
    expect(publicPhoneSchema.parse({ phone: "+40  123   456 789" })).toEqual({ phone: SAMPLE });
    expect(publicPhoneSchema.parse({ phone: "(0123) 456-789" })).toEqual({ phone: "(0123) 456-789" });
  });

  it("reads an empty box or no value as no number", () => {
    expect(publicPhoneSchema.parse({ phone: "" })).toEqual({ phone: null });
    expect(publicPhoneSchema.parse({ phone: "   " })).toEqual({ phone: null });
    expect(publicPhoneSchema.parse({ phone: null })).toEqual({ phone: null });
    expect(publicPhoneSchema.parse({})).toEqual({ phone: null });
  });

  it("refuses what is not a telephone number", () => {
    for (const phone of ["call us", "12345", "+40 123 456 789 012 345", "0123 456 789 ext", "+", "++40 123 456 789"]) {
      expect(publicPhoneSchema.safeParse({ phone }).success, phone).toBe(false);
    }
    expect(publicPhoneSchema.safeParse({ phone: "x".repeat(31) }).success).toBe(false);
    expect(publicPhoneSchema.safeParse({ phone: SAMPLE, extra: 1 }).success).toBe(false);
  });

  it("dials the digits, with the leading plus when there is one", () => {
    expect(telHref(SAMPLE)).toBe("tel:+40123456789");
    expect(telHref("(0123) 456-789")).toBe("tel:0123456789");
  });
});
