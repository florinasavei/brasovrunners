import { describe, expect, it } from "vitest";
import { raceDayDecisionFrom, VOLUNTEER_DECISION_MAX, VOLUNTEER_MESSAGE_MAX } from "@/modules/volunteers/domain/volunteer";

/**
 * §NNN, BR-REQ-050-02 — «Decizie pentru ziua cursei» as the organizers type it (the owner, 2026-11-16: «si la voluntar trebuie
 * sa am si decizie pt ziua cursei»): one short line. `raceDayDecisionFrom` is the one reading of the box — the service's and the
 * action's — so what is kept is one paragraph, trimmed, at most as long as a person's own message; nothing left is no decision,
 * and what is no such line is the box's refusal.
 */
describe("§NNN the race-day decision as typed", () => {
  it("is as long as a person's message at most", () => {
    expect(VOLUNTEER_DECISION_MAX).toBe(300);
    expect(VOLUNTEER_DECISION_MAX).toBe(VOLUNTEER_MESSAGE_MAX);
  });

  it("keeps the words as one paragraph: the ends trimmed, every line break and tab a space, a run of them one", () => {
    expect(raceDayDecisionFrom("vine la 8:00 la start")).toBe("vine la 8:00 la start");
    expect(raceDayDecisionFrom("  rezervă \n")).toBe("rezervă");
    expect(raceDayDecisionFrom("vine la 8:00\r\nla start\n\n\tcu mașina")).toBe("vine la 8:00 la start cu mașina");
    expect(raceDayDecisionFrom("vine   la  8:00")).toBe("vine la 8:00");
    // The separators a paste carries: a no-break space, a line separator, a paragraph separator.
    expect(raceDayDecisionFrom("vine la 8:00 la start")).toBe("vine la 8:00 la start");
  });

  it("reads a control character as a space — a NUL would be a database error, never words", () => {
    expect(raceDayDecisionFrom("vine\u0000la\u00078:00")).toBe("vine la 8:00");
    expect(raceDayDecisionFrom("\u0000\u001b")).toBeNull();
  });

  it("reads nothing left as no decision", () => {
    expect(raceDayDecisionFrom("")).toBeNull();
    expect(raceDayDecisionFrom("   ")).toBeNull();
    expect(raceDayDecisionFrom(" \r\n\t ")).toBeNull();
  });

  it("refuses what is not text: a box that was never posted, a file, a number", () => {
    expect(raceDayDecisionFrom(undefined)).toBeUndefined();
    expect(raceDayDecisionFrom(null)).toBeUndefined();
    expect(raceDayDecisionFrom(42)).toBeUndefined();
    expect(raceDayDecisionFrom(["rezervă"])).toBeUndefined();
    expect(raceDayDecisionFrom(new File(["rezervă"], "decizie.txt"))).toBeUndefined();
  });

  it("refuses more than the limit and keeps exactly the limit — counted after the folding, in characters as the database counts them", () => {
    const whole = "a".repeat(VOLUNTEER_DECISION_MAX);
    expect(raceDayDecisionFrom(whole)).toBe(whole);
    expect(raceDayDecisionFrom(`${whole}b`)).toBeUndefined();
    // Trimmed and folded first: the spaces around and the doubled ones do not count against the limit.
    expect(raceDayDecisionFrom(`  ${whole}  `)).toBe(whole);
    expect(raceDayDecisionFrom(`${"ab ".repeat(99)}abc`.replaceAll(" ", "  "))).toHaveLength(VOLUNTEER_DECISION_MAX);
    // A letter with a diacritic is one character, and so is an emoji, though it is two units of a JavaScript string.
    expect(raceDayDecisionFrom("ș".repeat(VOLUNTEER_DECISION_MAX))).toHaveLength(VOLUNTEER_DECISION_MAX);
    const runners = "🏃".repeat(VOLUNTEER_DECISION_MAX);
    expect(runners.length).toBe(VOLUNTEER_DECISION_MAX * 2);
    expect(raceDayDecisionFrom(runners)).toBe(runners);
    expect(raceDayDecisionFrom(`${runners}🏃`)).toBeUndefined();
  });
});
