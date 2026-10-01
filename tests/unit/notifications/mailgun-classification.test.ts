import { describe, expect, it } from "vitest";
import { classifyMailgunFailure, MAILGUN_PAUSE_MS } from "@/infrastructure/email/mailgun-adapter";
import { nextAllowanceResetAt } from "@/modules/notifications/domain/retry";

/**
 * BR-REQ-080-02, BR-REQ-080-03 — which Mailgun refusals are final, which are the allowance, and
 * which are a pause.
 *
 * This mapping had a defect with a date on it. Mailgun refuses a send whose account allowance
 * is spent with the **same 400** it uses for a malformed message, and the adapter treated every
 * 400 as permanent — so on the one day the club most needs its email, a race opening entries
 * against a 100/day allowance (`docs/PLATFORM.md`, limit 1), every message queued after the cap
 * would have been marked BOUNCED and thrown away. The tests below are the fence around that.
 *
 * And a second (§605): Mailgun's probation — a hundred messages an hour on a new or newly paid
 * account — answers past the hour with a 429, or with a 400 saying the account is "temporarily
 * disabled". The first was retried six times in an hour and FAILED; the second was a bounce. Both
 * are pauses now: throttled, `paced` (the attempt given back), due again when Mailgun says.
 *
 * The two directions are not symmetric and the tests say so. Calling an allowance refusal
 * permanent loses a participant's confirmation. Calling a genuine rejection throttled retries a
 * refused message once a day forever, which is how a sending domain's reputation is spent
 * (§16.1, §16.5). Both halves are asserted; neither may be relaxed to make the other pass.
 */
const NOW = new Date("2026-10-01T09:30:00.000Z");
const outcomeOf = (status: number, body: string) => classifyMailgunFailure(status, body, undefined, NOW).outcome;

describe("BR-REQ-080-03 Mailgun failure classification", () => {
  describe("the allowance is spent — retry when it resets", () => {
    it("maps Mailgun's own 420 for a refused send", () => {
      expect(
        classifyMailgunFailure(420, "Domain example.test is not allowed to send: recipient limit exceeded", undefined, NOW),
      ).toEqual({ outcome: "throttled" });
    });

    it("maps a 402, which the account owes money rather than the message being bad", () => {
      expect(classifyMailgunFailure(402, "Payment Required", undefined, NOW)).toEqual({ outcome: "throttled" });
    });

    it("maps a 400 whose body says the limit is what refused it", () => {
      // The case the old mapping got wrong: a 400, and not the caller's fault. The day's limit,
      // not a pause: no `paced`, no `retryAfter` — the outbox defers it to the reset.
      expect(
        classifyMailgunFailure(400, "Domain example.test is not allowed to send: recipient limit exceeded", undefined, NOW),
      ).toEqual({ outcome: "throttled" });
    });

    it("matches the daily-limit wording too", () => {
      expect(outcomeOf(400, "you have exceeded your daily limit")).toBe("throttled");
    });
  });

  describe("the message is refused — never retried", () => {
    it("keeps an unauthorized sandbox recipient permanent", () => {
      // No amount of waiting authorizes a recipient. This must not drift into `throttled`
      // when the limit pattern is next widened.
      expect(outcomeOf(400, "'ana@example.org' is not among the authorized recipients")).toBe("permanent_failure");
    });

    it("keeps the sandbox refusal permanent", () => {
      expect(
        outcomeOf(
          400,
          "Sandbox subdomains are for test purposes only. Please add your own domain or add the address to authorized recipients in Account Settings.",
        ),
      ).toBe("permanent_failure");
    });

    it("keeps the sandbox refusal permanent when Mailgun says it is not allowed to send (§605)", () => {
      // "not allowed to send" alone is not a pause: the probation's words must be there too.
      expect(outcomeOf(400, "Domain sandbox.example.test is not allowed to send: Sandbox subdomains are for test purposes only")).toBe(
        "permanent_failure",
      );
      expect(outcomeOf(400, "Domain example.test is not allowed to send: domain is not verified")).toBe("permanent_failure");
    });

    it("keeps a malformed message permanent", () => {
      expect(outcomeOf(400, "to parameter is not a valid address")).toBe("permanent_failure");
    });

    it("keeps bad credentials and an unverified domain permanent", () => {
      expect(outcomeOf(401, "Forbidden")).toBe("permanent_failure");
      expect(outcomeOf(403, "Forbidden")).toBe("permanent_failure");
      // Even with the probation's words: a 401/403 is the key or the domain, never the rate.
      expect(outcomeOf(403, "account temporarily disabled")).toBe("permanent_failure");
    });
  });

  describe("Mailgun asks us to wait — a pause, never an attempt spent (§605)", () => {
    it("pauses a 429 for exactly the seconds its Retry-After names", () => {
      expect(classifyMailgunFailure(429, "Too Many Requests", new Headers({ "Retry-After": "847" }), NOW)).toEqual({
        outcome: "throttled",
        paced: true,
        rateRefused: true,
        retryAfter: new Date(NOW.getTime() + 847_000),
      });
    });

    it("reads a Retry-After given as an HTTP date", () => {
      const result = classifyMailgunFailure(429, "Too Many Requests", new Headers({ "Retry-After": "Thu, 01 Oct 2026 10:05:00 GMT" }), NOW);
      expect(result).toEqual({ outcome: "throttled", paced: true, rateRefused: true, retryAfter: new Date("2026-10-01T10:05:00.000Z") });
    });

    it("pauses a 429 for fifteen minutes when Mailgun says nothing, or nothing readable", () => {
      const fifteen = new Date(NOW.getTime() + 15 * 60_000);
      expect(MAILGUN_PAUSE_MS).toBe(15 * 60_000);
      expect(classifyMailgunFailure(429, "Too Many Requests", undefined, NOW)).toMatchObject({ outcome: "throttled", paced: true, retryAfter: fifteen });
      expect(classifyMailgunFailure(429, "", new Headers(), NOW)).toMatchObject({ retryAfter: fifteen });
      expect(classifyMailgunFailure(429, "", new Headers({ "Retry-After": "soon" }), NOW)).toMatchObject({ retryAfter: fifteen });
    });

    it("never pauses into the past, and never longer than a day", () => {
      expect(classifyMailgunFailure(429, "", new Headers({ "Retry-After": "Thu, 01 Jan 2026 00:00:00 GMT" }), NOW)).toMatchObject({ retryAfter: NOW });
      expect(classifyMailgunFailure(429, "", new Headers({ "Retry-After": "9999999" }), NOW)).toMatchObject({
        retryAfter: new Date(NOW.getTime() + 24 * 3_600_000),
      });
    });

    it("pauses the probation's 400 — the account temporarily disabled — for fifteen minutes, never a bounce", () => {
      expect(
        classifyMailgunFailure(400, "Domain mail.example.test is not allowed to send: The account is temporarily disabled", undefined, NOW),
      ).toEqual({ outcome: "throttled", paced: true, rateRefused: true, retryAfter: new Date(NOW.getTime() + 15 * 60_000) });
      for (const words of ["account on probation", "sending too fast", "rate limit exceeded"]) {
        expect(classifyMailgunFailure(400, `Domain x is not allowed to send: ${words}`, undefined, NOW)).toMatchObject({ outcome: "throttled", paced: true });
      }
      // A domain Mailgun has closed for good is not the probation: waiting would retry it forever.
      expect(outcomeOf(400, "Domain x is not allowed to send: domain disabled")).toBe("permanent_failure");
    });
  });

  describe("try again shortly", () => {
    it("keeps outages and unrecognised statuses transient", () => {
      expect(outcomeOf(500, "Internal Server Error")).toBe("transient_failure");
      expect(outcomeOf(503, "")).toBe("transient_failure");
      expect(outcomeOf(404, "Not Found")).toBe("transient_failure");
    });
  });
});

describe("BR-REQ-080-02 when a throttled message is tried again", () => {
  it("waits for the next UTC day, not for the ordinary backoff", () => {
    const afternoon = new Date("2026-09-05T14:22:00.000Z");
    const next = nextAllowanceResetAt(afternoon);

    expect(next.toISOString()).toBe("2026-09-06T00:05:00.000Z");
  });

  it("crosses a month boundary", () => {
    expect(nextAllowanceResetAt(new Date("2026-09-30T23:59:00.000Z")).toISOString()).toBe(
      "2026-10-01T00:05:00.000Z",
    );
  });

  it("outlasts the whole ordinary retry schedule", () => {
    // The point of the distinction: six attempts of exponential backoff are spent in about an
    // hour, so a daily cap would mark a good message FAILED before the allowance ever reset.
    const now = new Date("2026-09-05T14:22:00.000Z");
    const oneHourLater = now.getTime() + 60 * 60_000;

    expect(nextAllowanceResetAt(now).getTime()).toBeGreaterThan(oneHourLater);
  });
});
