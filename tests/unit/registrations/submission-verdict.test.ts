import { describe, expect, it } from "vitest";
import { classifySubmission, looksLikeSpam } from "@/modules/registrations/service";

/**
 * BR-REQ-031-01 criterion 3, `DECISIONS.md` §194 and §217 — what the two public-form defences
 * find, and how little they are now allowed to assume.
 *
 * The defect this exists against: both answers used to be discarded in the same silence, so a
 * person who posted the form quickly got the "we have sent you a confirmation link" page and no
 * registration, no outbox row and no log line. It happened to a real participant on QA, and
 * then to a second one on production, which was still running the older code.
 *
 * §217 loosened the timing check after that — the owner: "so the anti-spam/bot verification must
 * be way more loose" — and the shape of the loosening is what these cases pin down: one second
 * rather than three, and nothing to time is nothing to judge.
 */
const NOW = new Date("2026-09-20T18:00:00.000Z");
const at = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();

describe("§194, §217 what the public form's defences found", () => {
  it("passes an ordinary submission", () => {
    expect(classifySubmission({ honeypot: "", renderedAt: at(30) }, NOW)).toBe("ok");
  });

  it("calls a filled hidden field a trap", () => {
    // Still named separately, because the log should say which fired. Both are refused out
    // loud and with the same marker, so nothing outside can tell them apart (§217).
    expect(classifySubmission({ honeypot: "x", renderedAt: at(30) }, NOW)).toBe("trap");
  });

  it("calls a submission inside one second too-fast, not a trap", () => {
    // The distinction is the whole point: this one is a guess about a person.
    expect(classifySubmission({ honeypot: "", renderedAt: at(0.5) }, NOW)).toBe("too-fast");
  });

  it("passes a submission with no render time at all (§217)", () => {
    /*
      This used to be "too-fast", on the reasoning that a form which lost its timestamp was
      probably assembled by something other than the page. The things that actually lose it are
      a page restored from the back-forward cache, an extension that rewrites the DOM, a proxy
      that strips a hidden field and a tab left open since yesterday — all of them people.
      There is nothing to time, so there is nothing to judge.
    */
    expect(classifySubmission({ honeypot: "" }, NOW)).toBe("ok");
    expect(classifySubmission({ honeypot: "", renderedAt: "not a date" }, NOW)).toBe("ok");
  });

  it("puts the boundary at one second, and lets the boundary itself through", () => {
    // A person with autofill goes back inside three seconds, which is what cost two of them.
    expect(classifySubmission({ honeypot: "", renderedAt: at(2) }, NOW)).toBe("ok");
    expect(classifySubmission({ honeypot: "", renderedAt: at(0.9) }, NOW)).toBe("too-fast");
    expect(classifySubmission({ honeypot: "", renderedAt: at(1) }, NOW)).toBe("ok");
  });

  it("keeps the older single answer for the forms that still take it", () => {
    // The contact and interest forms read one boolean; they follow the same loosened rule.
    expect(looksLikeSpam({ honeypot: "x", renderedAt: at(30) }, NOW)).toBe(true);
    expect(looksLikeSpam({ honeypot: "", renderedAt: at(0.5) }, NOW)).toBe(true);
    expect(looksLikeSpam({ honeypot: "", renderedAt: at(30) }, NOW)).toBe(false);
    expect(looksLikeSpam({ honeypot: "" }, NOW)).toBe(false);
  });
});
