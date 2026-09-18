import { describe, expect, it } from "vitest";
import {
  CHECKIN_CODE_ALPHABET,
  isCheckinCode,
  newCheckinCode,
  normalizeCheckinCode,
} from "@/modules/registrations/checkin-code";

/**
 * BR-REQ-037-08: the desk code is ten characters from an alphabet a person can read out over a
 * counter, and whatever a scanner or a volunteer hands in — a whole URL, lower case, spaces —
 * normalizes to that shape or is refused.
 */
describe("BR-REQ-037-08 the desk code", () => {
  it("has no 0/O or 1/I to confuse at a counter, and is ten characters long", () => {
    expect(CHECKIN_CODE_ALPHABET).not.toMatch(/[01OI]/);
    for (let i = 0; i < 50; i += 1) {
      const code = newCheckinCode();
      expect(code).toHaveLength(10);
      expect(isCheckinCode(code)).toBe(true);
    }
    // Two mints do not collide: 50 bits, and the column is unique regardless.
    expect(newCheckinCode()).not.toBe(newCheckinCode());
  });

  it("normalizes a scanned URL, a lower-case typed code, and spaces to the bare code", () => {
    expect(normalizeCheckinCode("https://example.test/ro/admin/checkin/ABCDEFGH23")).toBe("ABCDEFGH23");
    expect(normalizeCheckinCode(" abcd efgh 23 ")).toBe("ABCDEFGH23");
    expect(normalizeCheckinCode("ABCDEFGH23/")).toBe("ABCDEFGH23");
  });

  it("refuses the wrong length and letters outside the alphabet", () => {
    expect(isCheckinCode("ABCDEFGH2")).toBe(false);
    expect(isCheckinCode("ABCDEFGH01")).toBe(false);
    expect(isCheckinCode("ABCDEFGHI2")).toBe(false);
  });
});
