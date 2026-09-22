import { describe, expect, it } from "vitest";
import { classifySubmission, looksLikeSpam, refusesSubmission } from "@/modules/registrations/service";

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

/**
 * `DECISIONS.md` §282 — the two guesses may suspect a person, but they no longer get to refuse
 * one on their own. The owner, 2026-09-22: "we need to test with auto-fill properly" and "I also
 * want to give real people the option to fix it."
 *
 * What a password manager does to this form is fill every input it recognises, and an offscreen
 * input is still an input — so the trap comes back holding the person's own address or name,
 * spelled exactly as they typed it above. That is the signature these pin down; a bot has no
 * reason to put the submitted address in a field the form never showed.
 */
describe("§282 a trap filled by the browser is not a bot", () => {
  const person = { email: "ana.popescu@example.test", firstName: "Ana", lastName: "Popescu", renderedAt: at(30) };

  it("reads the person's own address in the trap as autofill", () => {
    expect(classifySubmission({ ...person, honeypot: "ana.popescu@example.test" }, NOW)).toBe("autofill");
  });

  it("reads their own name in the trap as autofill, whatever the case and spacing", () => {
    expect(classifySubmission({ ...person, honeypot: "  ana  " }, NOW)).toBe("autofill");
    expect(classifySubmission({ ...person, honeypot: "POPESCU" }, NOW)).toBe("autofill");
  });

  it("still calls somebody else's text a trap", () => {
    expect(classifySubmission({ ...person, honeypot: "https://cheap-seo.example" }, NOW)).toBe("trap");
    expect(classifySubmission({ ...person, honeypot: "xyzzy" }, NOW)).toBe("trap");
  });

  it("does not count autofill as spam on the shared check the other forms use", () => {
    expect(looksLikeSpam({ ...person, honeypot: "https://cheap-seo.example" }, NOW)).toBe(true);
    // The contact and interest forms pass no name or address, so nothing there can look like
    // autofill and their behaviour is unchanged.
    expect(looksLikeSpam({ honeypot: "x", renderedAt: at(30) }, NOW)).toBe(true);
  });
});

describe("§282 what is actually refused", () => {
  const base = { turnstile: "not_configured" as const, secondAttempt: false };

  it("refuses a suspected submission that has nothing else in its favour", () => {
    expect(refusesSubmission({ ...base, verdict: "trap" })).toBe(true);
    expect(refusesSubmission({ ...base, verdict: "too-fast" })).toBe(true);
  });

  it("lets Cloudflare's verdict outrank the hidden field", () => {
    // A measurement beats a guess, and a bot that can pass Turnstile was never going to be
    // stopped by an offscreen input.
    expect(refusesSubmission({ ...base, verdict: "trap", turnstile: "passed" })).toBe(false);
    expect(refusesSubmission({ ...base, verdict: "too-fast", turnstile: "passed" })).toBe(false);
  });

  it("lets the second attempt through, which is what stops the loop", () => {
    expect(refusesSubmission({ ...base, verdict: "trap", secondAttempt: true })).toBe(false);
  });

  it("suspects nothing from the trap once the club switches it off", () => {
    // §282: the field is still rendered and still logged — it simply stops refusing. The timing
    // guess and Cloudflare are untouched by that switch.
    expect(refusesSubmission({ ...base, verdict: "trap", honeypotOn: false })).toBe(false);
    expect(refusesSubmission({ ...base, verdict: "too-fast", honeypotOn: false })).toBe(true);
  });

  it("never refuses an ordinary submission, or one the browser filled", () => {
    expect(refusesSubmission({ ...base, verdict: "ok" })).toBe(false);
    expect(refusesSubmission({ ...base, verdict: "autofill" })).toBe(false);
  });

  it("still refuses a script that posts once with a token Cloudflare rejected", () => {
    expect(refusesSubmission({ verdict: "trap", turnstile: "failed", secondAttempt: false })).toBe(true);
  });

  it("does not let a second press undo a token Cloudflare rejected", () => {
    // The escape is for a person the guesses caught by accident, never a way past the one check
    // that measured this browser — a script posting twice would otherwise reach the "check your
    // email" screen and spend a message out of the club's allowance.
    expect(refusesSubmission({ verdict: "trap", turnstile: "failed", secondAttempt: true })).toBe(true);
  });
});
