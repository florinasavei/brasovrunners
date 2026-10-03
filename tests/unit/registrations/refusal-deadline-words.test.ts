import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §654, amending the words of §348 after §513 — the confirmation page's two refusals («the places and the
 * waiting list are full», «no waiting list») say how long the link stays good. Since §513 the link's
 * deadline runs from the departure of the first email that carried it, not from the form: a person who
 * confirms late was told a deadline that had already moved. The sentence now counts from the email, as
 * the resend page's `fullResend` does, and each stays under 200 characters (§511), a placeholder counted as one.
 */
const KEYS = ["waitlistFull", "noWaitlist"] as const;
const length = (text: string) => text.replace(/\{\w+\}/g, "X").length;

describe("§654 the confirmation page's refusals count the deadline from the first email", () => {
  it("says the email's departure, never the form's, in both languages", () => {
    for (const key of KEYS) {
      expect(ro.Registrations.confirm[key]).toContain("{confirmation} de când a plecat primul email");
      expect(en.Registrations.confirm[key]).toContain("{confirmation} from when the first email left");
      expect(ro.Registrations.confirm[key]).not.toMatch(/formular/);
      expect(en.Registrations.confirm[key]).not.toMatch(/form\b/);
    }
  });

  it("keeps each sentence under 200 characters", () => {
    for (const key of KEYS) {
      expect(length(ro.Registrations.confirm[key])).toBeLessThan(200);
      expect(length(en.Registrations.confirm[key])).toBeLessThan(200);
    }
  });

  it("the resend page's sentence says the same thing", () => {
    expect(findFullResend(ro)).toMatch(/primul tău email curge de când a plecat/);
    expect(findFullResend(en)).toMatch(/first email runs from when that one left/);
  });
});

/** `fullResend`, wherever the catalogue keeps it: the test pins the words, not the key's path. */
function findFullResend(catalogue: unknown): string {
  const stack: unknown[] = [catalogue];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "fullResend" && typeof value === "string") return value;
        stack.push(value);
      }
    }
  }
  return "";
}
