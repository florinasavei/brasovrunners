import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wholeDigits } from "@/shared/forms/whole-digits";

/**
 * §553 (the review of §548) — a number typed into a plain text box counts only as digits: the race
 * number typed at the desk (a free number with the paper, or a number set by hand) reads by this one
 * rule, so «1e3» is never race number 1000 and «0x10» never 16. The service keeps the range.
 */
describe("§553 wholeDigits — digits only, never rounded, never read as another number", () => {
  it("reads an empty box, or no box, as nothing typed", () => {
    expect(wholeDigits("")).toBeNull();
    expect(wholeDigits("   ")).toBeNull();
    expect(wholeDigits(null)).toBeNull();
    expect(wholeDigits(undefined)).toBeNull();
  });

  it("reads digits, trimmed, leading zeros dropped", () => {
    expect(wholeDigits("12")).toBe(12);
    expect(wholeDigits(" 12 ")).toBe(12);
    expect(wholeDigits("007")).toBe(7);
    expect(wholeDigits("0")).toBe(0);
  });

  it.each(["12.7", "1e3", "0x10", "-5", "+3", "1 000", "12a", "١٢", "Infinity"])("refuses «%s» as NaN, for the service to name the box", (typed) => {
    expect(wholeDigits(typed)).toBeNaN();
  });

  it("is the rule both desk boxes read", () => {
    const actions = readFileSync("src/app/[locale]/admin/registrations/actions.ts", "utf8");
    expect(actions.match(/wholeDigits\(text\(form, "bibNumber"\)\)/g)).toHaveLength(2);
    expect(actions).not.toMatch(/Number\(raw\)/);
  });

  it("is the rule the Mailgun plan's typed ceilings read, one function and not a second regex", () => {
    const actions = readFileSync("src/app/[locale]/admin/settings/emails/actions.ts", "utf8");
    expect(actions).toContain("const number = (name: string): number | null => wholeDigits(form.get(name));");
    expect(actions).not.toContain("/^\\d+$/");
  });
});
