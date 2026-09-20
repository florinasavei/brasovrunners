import { describe, expect, it } from "vitest";
import { classifySubmission, looksLikeSpam } from "@/modules/registrations/service";

/**
 * BR-REQ-031-01 criterion 3 and `DECISIONS.md` §194 — the two public-form defences answer
 * separately, because they are not equally certain.
 *
 * The defect this exists against: both answers were discarded in the same silence, so a person
 * who posted the form quickly got the "we have sent you a confirmation link" page and no
 * registration, no outbox row and no log line. That happened to a real participant on QA, and
 * finding it meant reading the code and eliminating every other path.
 */
const NOW = new Date("2026-09-20T18:00:00.000Z");
const at = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();

describe("§194 what the public form's defences found", () => {
  it("passes an ordinary submission", () => {
    expect(classifySubmission({ honeypot: "", renderedAt: at(30) }, NOW)).toBe("ok");
  });

  it("calls a filled hidden field a trap — the one a machine alone trips", () => {
    expect(classifySubmission({ honeypot: "x", renderedAt: at(30) }, NOW)).toBe("trap");
  });

  it("calls a quick submission too-fast, not a trap", () => {
    // The distinction is the whole point: this one is a guess about a person, and a guess must
    // not be answered by throwing the submission away.
    expect(classifySubmission({ honeypot: "", renderedAt: at(1) }, NOW)).toBe("too-fast");
  });

  it("treats a missing or unreadable render time as too-fast rather than as a trap", () => {
    expect(classifySubmission({ honeypot: "" }, NOW)).toBe("too-fast");
    expect(classifySubmission({ honeypot: "", renderedAt: "not a date" }, NOW)).toBe("too-fast");
  });

  it("puts the boundary where the constant says, and lets the boundary itself through", () => {
    expect(classifySubmission({ honeypot: "", renderedAt: at(2.9) }, NOW)).toBe("too-fast");
    expect(classifySubmission({ honeypot: "", renderedAt: at(3) }, NOW)).toBe("ok");
  });

  it("keeps the older single answer for the forms that still take it", () => {
    // The contact and interest forms read one boolean; nothing about them changed.
    expect(looksLikeSpam({ honeypot: "x", renderedAt: at(30) }, NOW)).toBe(true);
    expect(looksLikeSpam({ honeypot: "", renderedAt: at(1) }, NOW)).toBe(true);
    expect(looksLikeSpam({ honeypot: "", renderedAt: at(30) }, NOW)).toBe(false);
  });
});
